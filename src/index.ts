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
import { deserializeUnchecked } from "borsh";
import Fastify from "fastify";
import { auth0 } from "./auth0Setup";
import {
  createVerifiedTwitterRegistry,
  getTwitterRegistryKey,
} from "./nameServiceTwitter";
import { twitterClient } from "./twitterSetup";
import { Wallet, Provider } from "@project-serum/anchor";
import { BigInstructionResult } from "@strata-foundation/spl-utils";

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
export const app = Fastify();

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
    payer,
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
  transaction.partialSign(twitterServiceAccount);

  // https://github.com/solana-labs/solana/issues/21722
  // I wouldn't wish this bug on my worst enemies. If we don't do this hack, any time our txns are signed, then serialized, then deserialized,
  // then reserialized, they will break.
  const fixedTx = Transaction.from(
    transaction.serialize({ requireAllSignatures: false })
  );
  if (signers.length > 0) {
    fixedTx.partialSign(...signers);
  }
  if (transaction.signatures.some(sig => sig.publicKey.equals(payerServiceAccount.publicKey))) {
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
          // https://github.com/solana-labs/solana/issues/21722
          // I wouldn't wish this bug on my worst enemies. If we don't do this hack, any time our txns are signed, then serialized, then deserialized,
          // then reserialized, they will break.
          const fixedTx = Transaction.from(
            tx.serialize({ requireAllSignatures: false })
          );
          if (signers.length > 0) {
            fixedTx.partialSign(...signers);
          }
          if (tx.signatures.some(sig => sig.publicKey.equals(payerServiceAccount.publicKey))) {
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
