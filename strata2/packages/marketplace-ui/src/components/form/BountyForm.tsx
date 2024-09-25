// @ts-nocheck
import { Alert, Button, Flex, Input, VStack } from "@chakra-ui/react";
import { yupResolver } from "@hookform/resolvers/yup";
import { DataV2 } from "@metaplex-foundation/mpl-token-metadata";
import { NATIVE_MINT } from "@solana/spl-token";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MarketplaceSdk } from "@strata-foundation/marketplace-sdk";
import {
  useMintTokenRef,
  usePrimaryClaimedTokenRef,
  useProvider,
  usePublicKey,
} from "@strata-foundation/react";
import React, { useEffect, useState } from "react";
import { useAsyncCallback } from "react-async-hook";
import { DefaultValues, FormProvider, useForm } from "react-hook-form";
import * as yup from "yup";
import { useMarketplaceSdk } from "../../contexts/marketplaceSdkContext";
import { FormControlWithError } from "./FormControlWithError";
import { MintSelect } from "./MintSelect";
import { Recipient } from "./Recipient";
import { IMetadataFormProps, TokenMetadataInputs } from "./TokenMetadataInputs";
import { Wallet } from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";

interface IBountyFormProps extends IMetadataFormProps {
  mint: string;
  shortName: string;
  contact: string;
  discussion: string;
  authority: string;
}

const validationSchema = yup.object({
  mint: yup.string().required(),
  image: yup.mixed(),
  name: yup.string().required().min(2),
  description: yup.string(),
  shortName: yup.string().min(2).max(10),
  contact: yup.string(),
  discussion: yup.string(),
  authority: yup.string().required(),
});

async function createBounty(
  marketplaceSdk: MarketplaceSdk,
  values: IBountyFormProps,
  anchorWallet: Wallet
): Promise<PublicKey> {
  console.log("Creating bounty with values:", values);

  const mint = new PublicKey(values.mint);
  console.log("Mint public key:", mint.toBase58());

  const authority = new PublicKey(values.authority);
  console.log("Authority public key:", authority.toBase58());

  const targetMintKeypair = Keypair.generate();
  console.log("Generated target mint keypair:", targetMintKeypair.publicKey.toBase58());

  const uri = await marketplaceSdk.tokenMetadataSdk.uploadMetadata({
    name: values.name,
    symbol: values.shortName,
    description: values.description,
    image: values.image,
    mint: targetMintKeypair.publicKey,
    attributes: MarketplaceSdk.bountyAttributes({
      mint,
      discussion: values.discussion,
      contact: values.contact,
    }),
    // @sts-ignore
  }, anchorWallet);
  console.log("Uploaded metadata URI:", uri);

  const { targetMint } = await marketplaceSdk.createBounty({
    targetMintKeypair,
    authority,
    metadataUpdateAuthority: marketplaceSdk.provider.wallet.publicKey,
    metadata: ({
      // Max name len 32
      name: values.name.substring(0, 32),
      symbol: values.shortName.substring(0, 10),
      uri,
      sellerFeeBasisPoints: 0,
      // @ts-ignore
      creators: null,
      // @ts-ignore
      collection: null,
      // @ts-ignore
      uses: null,
    }),
    baseMint: mint,
  });
  console.log("Created bounty with target mint:", targetMint.toBase58());

  return targetMint;
}

export const BountyForm = ({
  defaultValues = {},
  onComplete,
  hide = new Set(),
}: {
  defaultValues?: DefaultValues<IBountyFormProps>;
  onComplete?: (mintKey: PublicKey) => void;
  hide?: Set<string>;
}) => {
  const formProps = useForm<IBountyFormProps>({
    resolver: yupResolver(validationSchema),
    defaultValues,
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = formProps;
  const { publicKey, connected } = useWallet();
  const { visible, setVisible } = useWalletModal();
  const { info: tokenRef } = usePrimaryClaimedTokenRef(publicKey);
  const { awaitingApproval } = useProvider();
  const { execute, loading, error } = useAsyncCallback(createBounty);
  const [marketplaceSdk, setMarketplaceSdk] = useState<MarketplaceSdk | null>(null);
  
  const { authority, mint } = watch();
  const mintKey = usePublicKey(mint);
  const { info: mintTokenRef } = useMintTokenRef(mintKey);
const anchorWallet = useWallet();
const { connection } = useConnection();
useEffect(() => {
  async function getSdk() {
  const provider = new AnchorProvider(connection, anchorWallet, {});
  const sdk = await MarketplaceSdk.init(provider);
  setMarketplaceSdk(sdk);
  }
  getSdk();
}, [connection, anchorWallet]);
  // Social tokens should default bounties to the owner of the social token
  // as the authority. This is generally better because if the owner acts in
  // bad faith, they'll collapse the value of their own token. Vs a fan who can
  // easily not give money to the creator
  useEffect(() => {
    if (!authority && mintTokenRef) {
      const owner = mintTokenRef.owner as PublicKey | undefined;
      if (owner) {
        setValue("authority", owner.toBase58());
      } else {
        setValue("authority", mintTokenRef.publicKey.toBase58());
      }
    }
  }, [mintTokenRef, authority, setValue]);

  const onSubmit = async (values: IBountyFormProps) => {
    const mintKey = await execute(marketplaceSdk!, values, anchorWallet! as any);
    onComplete && onComplete(mintKey);
  };

  const authorityRegister = register("authority");

  return (
    <Flex position="relative">
      {!connected && (
        <Flex
          position="absolute"
          w="full"
          h="full"
          zIndex="1"
          flexDirection="column"
        >
          <Flex justifyContent="center">
            <Button
              colorScheme="orange"
              variant="outline"
              onClick={() => setVisible(!visible)}
            >
              Connect Wallet
            </Button>
          </Flex>
          <Flex w="full" h="full" bg="white" opacity="0.6" />
        </Flex>
      )}
      <FormProvider {...formProps}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <VStack spacing={8} mt={!connected ? 12 : 0}>
            <TokenMetadataInputs />
            <FormControlWithError
              id="shortName"
              help="A less than 10 character name for this bounty. This will be the bounty token's symbol."
              label="Short Name"
              errors={errors}
            >
              <Input {...register("shortName")} />
            </FormControlWithError>

            {!hide.has("mint") && (
              <FormControlWithError
                id="mint"
                help={`The mint that should be used on this bounty, example BQpGv6LVWG1JRm1NdjerNSFdChMdAULJr3x9t2Swpump for Fomo3d.fun`}
                label="Mint"
                errors={errors}
              >
                {tokenRef && (
                  <Button
                    variant="link"
                    onClick={() => setValue("mint", tokenRef.mint.toBase58())}
                  >
                    Use my Social Token
                  </Button>
                )}
                <MintSelect
                  value={watch("mint")}
                  onChange={(s) => setValue("mint", s)}
                />
              </FormControlWithError>
            )}

            {!hide.has("authority") && (
              <FormControlWithError
                id="authority"
                help="The wallet that signs to disburse the funds of this bounty when it is completed. 
            For social tokens, this defaults to the wallet associated with the social token. This
            can also be an SPL Governance address or a multisig."
                label="Approver"
                errors={errors}
              >
                {publicKey && (
                  <Button
                    variant="link"
                    onClick={() => setValue("authority", publicKey.toBase58())}
                  >
                    Set to My Wallet
                  </Button>
                )}
                <Recipient
                  name={authorityRegister.name}
                  value={authority}
                  onChange={authorityRegister.onChange}
                />
              </FormControlWithError>
            )}
            {!hide.has("contact") && (
              <FormControlWithError
                id="contact"
                help="Who to contact regarding the bounty. This can be an email address, twitter handle, etc."
                label="Contact Information"
                errors={errors}
              >
                <Input {...register("contact")} />
              </FormControlWithError>
            )}
            {!hide.has("discussion") && (
              <FormControlWithError
                id="discussion"
                help="A link to where this bounty is actively being discussed. This can be a github issue, forum link, etc. Use this to coordinate the bounty."
                label="Discussion"
                errors={errors}
              >
                <Input {...register("discussion")} />
              </FormControlWithError>
            )}

            {error && <Alert status="error">{error.toString()}</Alert>}

            <Button
              type="submit"
              alignSelf="flex-end"
              colorScheme="primary"
              isLoading={isSubmitting || loading}
              loadingText={awaitingApproval ? "Awaiting Approval" : "Loading"}
            >
              Send Bounty
            </Button>
          </VStack>
        </form>
      </FormProvider>
    </Flex>
  );
};
