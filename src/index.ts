import { NameRegistryState, NAME_PROGRAM_ID } from "@bonfida/spl-name-service";
import {
  Account,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ICreateSocialTokenArgs,
  SplTokenCollective,
} from "@strata-foundation/spl-token-collective";
import {
  SplTokenBonding,
} from "@strata-foundation/spl-token-bonding";
import {
  SplTokenMetadata
} from "@strata-foundation/spl-utils";
import { deserializeUnchecked } from "borsh";
import Fastify, { fastify } from "fastify";
import { auth0 } from "./auth0Setup";
import {
  createVerifiedTwitterRegistry,
  getTwitterRegistryKey,
  createReverseTwitterRegistry
} from "./nameServiceTwitter";
import { twitterClient } from "./twitterSetup";
import { Wallet, Provider } from "@project-serum/anchor";
import { BigInstructionResult } from "@strata-foundation/spl-utils";
import { deleteInstruction, transferNameOwnership, getHashedName, getNameAccountKey, ReverseTwitterRegistryState } from "@solana/spl-name-service";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const MIN_LAMPORTS = process.env.MIN_LAMPORTS ? Number(process.env.MIN_LAMPORTS) : 500_000_000 // 0.5 SOL
const connection = new Connection(process.env.SOLANA_URL!);
const twitterServiceAccount = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.TWITTER_SERVICE_ACCOUNT!))
);
const payerServiceAccount = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.PAYER_SERVICE_ACCOUNT!))
);
const provider = new Provider(connection, new Wallet(payerServiceAccount), {
  commitment: "confirmed",
});
const twitterTld = new PublicKey(process.env.TWITTER_TLD!);
const feeWallet = new PublicKey(process.env.FEE_WALLET!);
const goLiveUnixTime = Number(process.env.GO_LIVE!);

console.log("Using payer: ", payerServiceAccount.publicKey.toBase58());
export const app = Fastify({
  logger: true
});

app.setErrorHandler((error, req, reply) => {
  if (error) {
    console.error(error.stack);
    reply.code(error.statusCode || 500).type("application/json").send({
      message: error.message
    });
    return;
  }
  reply.send(error);
});

app.register(require("fastify-cors"), {
  origin: (origin: any, cb: any) => {
    cb(null, true);
  },
});

app.get("/config", async () => {
  return {
    tlds: {
      twitter: twitterTld.toBase58(),
    },
    verifiers: {
      twitter: twitterServiceAccount.publicKey.toBase58(),
    },
    feeWallet: feeWallet.toBase58(),
    goLiveUnixTime
  };
});

interface IClaimHandleArgs {
  pubkey: string;
  code?: string;
  redirectUri?: string;
  twitterHandle: string;
}

interface IRelinkArgs {
  newWallet: string;
  prevWallet: string;
}

async function hasEnoughFunds(publicKey: PublicKey): Promise<boolean> {
  const lamports = (await connection.getAccountInfo(publicKey))?.lamports;

  return (lamports || 0) >= MIN_LAMPORTS
}

async function claimHandleInstructions({
  pubkey,
  code,
  redirectUri,
  twitterHandle,
}: IClaimHandleArgs): Promise<{
  instructions: TransactionInstruction[];
  signers: Signer[];
}> {
  const name = await getTwitterRegistry(twitterHandle);
  if (name) {
    return {
      instructions: [],
      signers: [],
    };
  }

  if (!process.env.IS_DEV) {
    const { access_token: accessToken } =
      (await auth0.oauth?.authorizationCodeGrant({
        code: code!,
        redirect_uri: redirectUri!,
      })) || {};
    const user = await auth0.users?.getInfo(accessToken!);
    // @ts-ignore
    const { sub } = user;
    const twitterUser: any = await twitterClient.get("users/show", {
      user_id: sub.replace("twitter|", ""),
    });

    if (twitterUser.screen_name != twitterHandle) {
      throw new Error(
        `Screen name ${twitterUser.screen_name} does not match the screen name provided ${twitterHandle}`
      );
    }
  }

  const pubKey = new PublicKey(pubkey);
  const hasFunds = await hasEnoughFunds(payerServiceAccount.publicKey);
  const payer = hasFunds ? payerServiceAccount.publicKey : pubKey;

  const instructions = await createVerifiedTwitterRegistry(
    connection,
    twitterHandle,
    pubKey,
    32,
    payer,
    NAME_PROGRAM_ID,
    twitterServiceAccount.publicKey,
    twitterTld
  );

  return {
    instructions,
    signers: [twitterServiceAccount],
  };
}

app.post<{ Body: IClaimHandleArgs }>("/twitter/oauth", async (req) => {
  const { instructions, signers } = await claimHandleInstructions(req.body);
  const hasFunds = await hasEnoughFunds(payerServiceAccount.publicKey);
  if (!hasFunds) {
    console.warn("Payer service account is out of funds, having caller pay");
  }

  const transaction = new Transaction({
    recentBlockhash: (await connection.getRecentBlockhash()).blockhash,
    feePayer: hasFunds ? payerServiceAccount.publicKey : new PublicKey(req.body.pubkey),
  });
  transaction.add(...instructions);
  // Signatures is empty if we don't do this
  const fixedTx = Transaction.from(transaction.serialize({ verifySignatures: false, requireAllSignatures: false }));
  if (fixedTx.signatures.some(sig => sig.publicKey.equals(twitterServiceAccount.publicKey))) {
    fixedTx.partialSign(twitterServiceAccount);
  }

  if (signers.length > 0) {
    fixedTx.partialSign(...signers);
  }
  if (fixedTx.signatures.some(sig => sig.publicKey.equals(payerServiceAccount.publicKey))) {
    fixedTx.partialSign(payerServiceAccount);
  }
  return fixedTx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toJSON();
});

async function getTwitterRegistry(
  twitterHandle: string
): Promise<NameRegistryState | undefined> {
  const name = await getTwitterRegistryKey(twitterHandle, twitterTld);
  const acct = await connection.getAccountInfo(name);

  if (acct) {
    return deserializeUnchecked(
      NameRegistryState.schema,
      NameRegistryState,
      acct.data
    );
  }
}

type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T; // from lodash

function truthy<T>(value: T): value is Truthy<T> {
  return !!value;
}

async function getTwitterReverse(
  connection: Connection,
  owner: PublicKey
): Promise<ReverseTwitterRegistryState> {
  const hashedName = await getHashedName(owner.toString());

  const key = await getNameAccountKey(
    hashedName,
    twitterServiceAccount.publicKey,
    twitterTld
  );

  const reverseTwitterAccount = await connection.getAccountInfo(key);
  if (!reverseTwitterAccount) {
    throw new Error("Invalid reverse Twitter account provided");
  }
  return deserializeUnchecked(
    ReverseTwitterRegistryState.schema,
    ReverseTwitterRegistryState,
    reverseTwitterAccount.data.slice(NameRegistryState.HEADER_LEN)
  );
}

app.post<{Body: IRelinkArgs }>(
  "/relink",
  async (req, reply) => {
    const { newWallet: newWalletRaw, prevWallet: prevWalletRaw } = req.body;
    const newWallet = new PublicKey(newWalletRaw);
    const prevWallet = new PublicKey(prevWalletRaw);
    const tokenCollectiveSdk = await SplTokenCollective.init(provider);
    const tokenBondingSdk = await SplTokenBonding.init(provider);
    const tokenMetadataSdk = await SplTokenMetadata.init(provider);

    const claimedTokenRef = (await SplTokenCollective.ownerTokenRefKey({
      isPrimary: true,
      owner: prevWallet
    }))[0];
    const tokenRefAcct = await tokenCollectiveSdk.getTokenRef(claimedTokenRef);
    const connection = tokenCollectiveSdk.provider.connection;
  
    const reverseTwitterHashedName = await getHashedName(prevWallet.toString());
    const reverseTwitterName = await getNameAccountKey(
      reverseTwitterHashedName,
      twitterServiceAccount.publicKey,
      twitterTld
    );
  
    const instructions: TransactionInstruction[][] = [[], [], []];
    const signers: Signer[][] = [[], [], []];
    if (tokenRefAcct) {
      const tokenBondingAcct = (await tokenBondingSdk.getTokenBonding(tokenRefAcct.tokenBonding!))!;
      const mintTokenRef = (await SplTokenCollective.mintTokenRefKey(tokenRefAcct.mint))[0];
      const { instructions: updateOwnerInstrs, signers: updateOwnerSigners, output: { ownerTokenRef } } = await tokenCollectiveSdk.updateOwnerInstructions({
        payer: prevWallet,
        tokenRef: claimedTokenRef,
        newOwner: newWallet
      });
      const { instructions: updateAuthorityInstrs, signers: updateAuthoritySigners } = await tokenCollectiveSdk.updateAuthorityInstructions({
        payer: prevWallet,
        tokenRef: mintTokenRef,
        owner: newWallet,
        newAuthority: newWallet
      });
      const { instructions: updateMetadataInstrs, signers: updateMetadataSigners } = await tokenMetadataSdk.updateMetadataInstructions({
        metadata: tokenRefAcct.tokenMetadata,
        authority: newWallet
      });

      const defaultBaseRoyalties = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenBondingAcct?.baseMint,
        newWallet
      );
      const defaultTargetRoyalties = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenBondingAcct.targetMint,
        newWallet
      );
  
      if (
        !(await tokenBondingSdk.accountExists(defaultTargetRoyalties))
      ) {
        console.log(`Creating target royalties ${defaultTargetRoyalties}...`);
        instructions[0].push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenBondingAcct.targetMint,
            defaultTargetRoyalties,
            newWallet,
            prevWallet
          )
        );
      }
  
      if (
        !(await tokenBondingSdk.accountExists(defaultBaseRoyalties))
      ) {
        console.log(`Creating base royalties ${defaultBaseRoyalties}...`);
        instructions[0].push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenBondingAcct.baseMint,
            defaultBaseRoyalties,
            newWallet,
            prevWallet
          )
        );
      }

      const { instructions: updateBondingInstrs, signers: updateBondingSigners } = await tokenCollectiveSdk.updateTokenBondingInstructions({
        tokenRef: mintTokenRef,
        buyBaseRoyalties: defaultBaseRoyalties,
        buyTargetRoyalties: defaultTargetRoyalties,
        sellBaseRoyalties: defaultBaseRoyalties,
        sellTargetRoyalties: defaultTargetRoyalties
      });
    
      instructions[1].push(
        ...updateBondingInstrs
      )
      signers[1].push(
        ...updateBondingSigners
      )

      instructions[2].push(
        ...updateMetadataInstrs,
        ...updateOwnerInstrs,
        ...updateAuthorityInstrs,
      );
      signers[2].push(
        ...updateMetadataSigners,
        ...updateOwnerSigners,
        ...updateAuthoritySigners,
      )
    }
  
    if (await connection.getAccountInfo(reverseTwitterName)) {
      signers[2].push(twitterServiceAccount);
      const reverseRegistry = await getTwitterReverse(connection, prevWallet);
      const handle = reverseRegistry.twitterHandle;
      instructions[2].push(
        await deleteInstruction(
          NAME_PROGRAM_ID,
          reverseTwitterName,
          prevWallet,
          prevWallet
        )
      )
      const hashedTwitterHandle = await getHashedName(handle);
      const twitterHandleRegistryKey = await getNameAccountKey(
        hashedTwitterHandle,
        undefined,
        twitterTld
      );
    
      instructions[2].push(
        ...await createReverseTwitterRegistry(
          connection,
          handle,
          twitterHandleRegistryKey,
          newWallet,
          prevWallet,
          NAME_PROGRAM_ID,
          twitterServiceAccount.publicKey,
          twitterTld
        )
      )
      instructions[2].push(
        await transferNameOwnership(
          connection,
          handle,
          newWallet,
          undefined,
          twitterTld
        )
      )
    }

    if (instructions[2].length == 0) {
      return reply.code(404).send({message: `No token found for wallet ${prevWallet.toBase58()}`})
    }

    const recentBlockhash = (
      await provider.connection.getRecentBlockhash("confirmed")
    ).blockhash;

    return instructions.map((instructions, index) => {
      const sigs = signers[index];
      if (instructions.length > 0) {
        const tx = new Transaction({
          recentBlockhash,
          feePayer: prevWallet
        });
    
        tx.add(...instructions);
    
        // https://github.com/solana-labs/solana/issues/21722
        // I wouldn't wish this bug on my worst enemies. If we don't do this hack, any time our txns are signed, then serialized, then deserialized,
        // then reserialized, they will break.
        const fixedTx = Transaction.from(
          tx.serialize({ requireAllSignatures: false })
        );
        if (sigs.length > 0) {
          fixedTx.partialSign(...sigs);
        }
    
        return fixedTx
        .serialize({ requireAllSignatures: false, verifySignatures: true })
        .toJSON()
      }
    }).filter(truthy)
  }
)

app.post<{ Body: IClaimHandleArgs }>(
  "/twitter/claim-or-create",
  async (req) => {
    const { pubkey, twitterHandle } = req.body;
    const owner = new PublicKey(pubkey);
    const { instructions: handleInstructions, signers: handleSigners } =
      await claimHandleInstructions(req.body);
    const tokenCollectiveSdk = await SplTokenCollective.init(provider);

    const hasFunds = await hasEnoughFunds(payerServiceAccount.publicKey);
    if (!hasFunds) {
      console.warn("Payer service account is out of funds, having caller pay");
    }

    const name = await getTwitterRegistryKey(twitterHandle, twitterTld);
    const claimedTokenRefKey = (
      await SplTokenCollective.ownerTokenRefKey({ owner })
    )[0];
    const unclaimedTokenRefKey = (
      await SplTokenCollective.ownerTokenRefKey({
        name,
        mint: SplTokenCollective.OPEN_COLLECTIVE_MINT_ID,
      })
    )[0];
    const claimedTokenRef = await tokenCollectiveSdk.getTokenRef(
      claimedTokenRefKey
    );
    const unclaimedTokenRef = await tokenCollectiveSdk.getTokenRef(
      unclaimedTokenRefKey
    );

    let instructionResult: BigInstructionResult<any> = {
      instructions: [],
      signers: [],
      output: null,
    };
    const symbol = twitterHandle.slice(0, 10);
    // Need to create from scratch
    if (!claimedTokenRef && !unclaimedTokenRef) {
      const goLiveDate = new Date(0);
      goLiveDate.setUTCSeconds(goLiveUnixTime);
      const args: ICreateSocialTokenArgs = {
        owner,
        authority: owner,
        metadata: {
          name: twitterHandle,
          symbol,
        },
        tokenBondingParams: {
          goLiveDate,
          buyBaseRoyaltyPercentage: 0,
          buyTargetRoyaltyPercentage: 5,
          sellBaseRoyaltyPercentage: 0,
          sellTargetRoyaltyPercentage: 0,
          buyBaseRoyaltiesOwner: owner,
          sellBaseRoyaltiesOwner: owner,
          buyTargetRoyaltiesOwner: owner,
          sellTargetRoyaltiesOwner: owner
        },
      };

      instructionResult =
        await tokenCollectiveSdk!.createSocialTokenInstructions(args);
    } else if (!claimedTokenRef) {
      const regularInstructionResult =
        await tokenCollectiveSdk!.claimSocialTokenInstructions({
          owner,
          authority: owner,
          tokenRef: unclaimedTokenRefKey,
          symbol,
          ignoreMissingName: true
        });
      instructionResult = {
        instructions: [regularInstructionResult.instructions],
        signers: [regularInstructionResult.signers],
        output: null,
      };
    }
    const instructionGroups = [
      handleInstructions,
      ...instructionResult.instructions,
    ];
    const signerGroups = [handleSigners, ...instructionResult.signers];

    const recentBlockhash = (
      await provider.connection.getRecentBlockhash("confirmed")
    ).blockhash;
    const txns = instructionGroups
      .map((instructions, index) => {
        const signers = signerGroups[index];
        if (instructions.length > 0) {
          const tx = new Transaction({
            feePayer: hasFunds ? payerServiceAccount.publicKey : owner,
            recentBlockhash,
          });
          tx.add(...instructions);
          // Signatures is empty if we don't do this
          const fixedTx = Transaction.from(tx.serialize({ verifySignatures: false, requireAllSignatures: false }))
          if (signers.length > 0) {
            fixedTx.partialSign(...signers);
          }
          if (fixedTx.signatures.some(sig => sig.publicKey.equals(payerServiceAccount.publicKey))) {
            fixedTx.partialSign(payerServiceAccount);
          }
          return fixedTx;
        }
      })
      .filter(truthy);

    return txns.map((transaction) =>
      transaction
        .serialize({ requireAllSignatures: false, verifySignatures: true })
        .toJSON()
    );
  }
);

app.get("/", async () => {
  return { healthy: "true" };
});

app.listen(Number(process.env["PORT"] || "8080"), "0.0.0.0").catch((e) => {
  console.error(e);
  console.error(e.stack);
  process.exit(1);
});
