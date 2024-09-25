import {
  Creator,
  DataV2,
  Edition,
  MasterEdition,
  Metadata,
  createMetadataAccountV3
} from "@metaplex-foundation/mpl-token-metadata";
import { Pda, publicKey } from '@metaplex-foundation/umi';

import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { AccountInfo as TokenAccountInfo, MintInfo } from "@solana/spl-token";
import { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";
import { getMintInfo, InstructionResult, sendInstructions, truthy } from ".";
import {
  ARWEAVE_UPLOAD_URL,
  getFilesWithMetadata,
  prePayForFilesInstructions,
  uploadToArweave,
  ArweaveEnv,
} from "./arweave";
// @ts-ignore
import localStorageMemory from "localstorage-memory";
import {  uploadFiles } from "./shdw";
import { createGenericFile } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { TransactionMessage } from "@solana/web3.js";
import { VersionedMessage } from "@solana/web3.js";

export interface IUploadMetadataArgs {
  payer?: PublicKey;
  name: string;
  symbol: string;
  description?: string;
  image?: File;
  creators?: Creator[];
  attributes?: Attribute[];
  animationUrl?: string;
  externalUrl?: string;
  extraMetadata?: any;
  mint?: PublicKey;
}

export interface ICreateArweaveUrlArgs {
  payer?: PublicKey;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  creators?: Creator[];
  files?: File[];
  existingFiles?: FileOrString[];
  attributes?: Attribute[];
  animationUrl?: string;
  externalUrl?: string;
  extraMetadata?: any;
}

export type Attribute = {
  trait_type?: string;
  display_type?: string;
  value: string | number;
};

export type MetadataFile = {
  uri: string;
  type: string;
};

export type FileOrString = MetadataFile | string;

export interface IMetadataExtension {
  name: string;
  symbol: string;

  creators: Creator[] | null;
  description: string;
  // preview image absolute URI
  image: string;
  animation_url?: string;

  attributes?: Attribute[];

  // stores link to item on meta
  external_url: string;

  seller_fee_basis_points: number;

  properties: {
    files?: FileOrString[];
    category: MetadataCategory;
    maxSupply?: number;
    creators?: {
      address: string;
      shares: number;
    }[];
  };
}

export interface ICreateMasterEditionInstructionsArgs {
  mint: PublicKey;
  mintAuthority?: PublicKey;
  payer?: PublicKey;
}

export interface IVerifyCollectionInstructionsArgs {
  collectionMint: PublicKey;
  nftMint: PublicKey;
  payer?: PublicKey;
}

export interface ICreateMetadataInstructionsArgs {
  data: any;
  authority?: PublicKey;
  mintAuthority?: any;
  mint: PublicKey;
  payer?: any;
}

export interface IUpdateMetadataInstructionsArgs {
  data?: any | null;
  newAuthority?: PublicKey | null;
  metadata: PublicKey;
  payer?: PublicKey;
  /** The update authority to use when updating the metadata. **Default:** Pulled from the metadata object. This can be useful if you're chaining transactions */
  updateAuthority?: PublicKey;
}

export enum MetadataCategory {
  Audio = "audio",
  Video = "video",
  Image = "image",
  VR = "vr",
}

export interface ITokenWithMeta {
  displayName?: string;
  metadataKey?: PublicKey;
  metadata?: any;
  mint?: MintInfo;
  edition?: any;
  masterEdition?: any;
  data?: IMetadataExtension;
  image?: string;
  description?: string;
}

const USE_CDN = false; // copied from metaplex. Guess support isn't there yet?
const routeCDN = (uri: string) => {
  let result = uri;
  if (USE_CDN) {
    result = uri.replace(
      "https://arweave.net/",
      "https://coldcdn.com/api/cdn/bronil/"
    );
  }

  return result;
};

export function getImageFromMeta(meta?: any): string | undefined {
  if (meta?.image) {
    return meta?.image;
  } else {
    const found = (meta?.properties?.files || []).find(
      (f: any) => typeof f !== "string" && f.type === "Ima"
    )?.uri;
    return found;
  }
}

const imageFromJson = (newUri: string, extended: any) => {
  const image = getImageFromMeta(extended);
  if (image) {
    const file = image.startsWith("http")
      ? extended.image
      : `${newUri}/${extended.image}`;
    return routeCDN(file);
  }
};

//@ts-ignore
const localStorage = (typeof global !== "undefined" && global.localStorage) || localStorageMemory;

export class SplTokenMetadata {
  provider: AnchorProvider;

  static async init(provider: AnchorProvider): Promise<SplTokenMetadata> {
    return new this({
      provider,
    });
  }

  constructor(opts: { provider: AnchorProvider }) {
    this.provider = opts.provider;
  }

  static attributesToRecord(
    attributes: Attribute[] | undefined
  ): Record<string, string | number> | undefined {
    if (!attributes) {
      return undefined;
    }

    return attributes?.reduce((acc, att) => {
      if (att.trait_type) acc[att.trait_type] = att.value;
      return acc;
    }, {} as Record<string, string | number>);
  }

  static async getArweaveMetadata(
    uri: string | undefined
  ): Promise<IMetadataExtension | undefined> {
    if (uri && uri.length > 0) {
      const newUri = routeCDN(uri);

      const cached = localStorage.getItem(newUri);
      if (cached) {
        return JSON.parse(cached);
      } else {
        try {
          // TODO: BL handle concurrent calls to avoid double query
          const result = await fetch(newUri) ;
          let data = await result.json() as any;
          if (data.uri) {
            data = {
              ...data,
              ...(await SplTokenMetadata.getArweaveMetadata(data.uri)),
            };
          }
          try {
            localStorage.setItem(newUri, JSON.stringify(data));
          } catch (e) {
            // ignore
          }
          return data;
        } catch (e) {
          console.log(`Could not fetch from ${uri}`, e);
          return undefined;
        }
      }
    }
  }

  static async getImage(uri: string | undefined): Promise<string | undefined> {
    if (uri) {
      const newUri = routeCDN(uri);
      const metadata = await SplTokenMetadata.getArweaveMetadata(uri);
      // @ts-ignore
      if (metadata?.uri) {
        // @ts-ignore
        return SplTokenMetadata.getImage(metadata?.uri);
      }

      return imageFromJson(newUri, metadata);
    }
  }

  async getEditionInfo(metadata: any | undefined): Promise<{
    edition?: any;
    masterEdition?: any;
  }> {
    if (!metadata) {
      return {};
    }

    return {
      edition: undefined,
      masterEdition: undefined,
    };
  }

  async getTokenMetadata(metadataKey: PublicKey): Promise<ITokenWithMeta> {
    const url = `https://mainnet.helius-rpc.com/?api-key=0d4b4fd6-c2fc-4f55-b615-a23bab1ffc85`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getAsset',
          params: {
            id: metadataKey.toString(),
          },
        }),
      });

      const { result } = await response.json();
      console.log("Asset Data: ", result);
      
      if (result) {
        return {
          displayName: result.content.metadata.name,
          metadata: result,
          metadataKey,
          image: result.content.links.image,
          mint: publicKey(result.mint),
          data: result.content.metadata,
          description: result.content.metadata.description,
        };
      }
    } catch (error) {
      console.error('Error fetching asset:', error);
    }

  }

  sendInstructions(
    instructions: TransactionInstruction[],
    signers: Signer[],
    payer?: PublicKey
  ): Promise<string> {
    return sendInstructions(
      new Map<number, string>(),
      this.provider,
      instructions,
      signers,
      payer
    );
  }


  async uploadMetadata(args: IUploadMetadataArgs, wallet: any): Promise<string> {

    let randomId = Math.floor(Math.random()*(999-100+1)+100);
    // Upload image first
    const imageBuffer = await args.image.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);
    const genericImage = createGenericFile(uint8Array, `${args.image.name}`);
    const imageUrl = await uploadFiles(this.provider, [genericImage], wallet);
    
    // Use the uploaded image URL in the metadata
    const imageUri = imageUrl[0];
    const metadata = {
      name: args.name,
      symbol: args.symbol,
      description: args.description,
      image: imageUri,
      attributes: args.attributes,
      external_url: args.externalUrl || "",
      animation_rl: args.animationUrl,
      creators: args.creators ? args.creators : null,
      seller_fee_basis_points: 0,
      ...(args.extraMetadata || {}),
    };
    const metadataBuffer = new TextEncoder().encode(JSON.stringify(metadata));
    const genericMetadata = createGenericFile(metadataBuffer, `${args.mint}-${randomId}.json`);
    const urls = await uploadFiles(this.provider, [genericMetadata], wallet);

    return urls[0];
  }


  /**
   * Wrapper function that prepays for arweave metadata files in SOL, then uploads them to arweave and returns the url
   *
   * @param args
   * @returns
   */
  async createArweaveMetadata(
    args: ICreateArweaveUrlArgs & {
      env?: ArweaveEnv;
      uploadUrl?: string;
      mint: PublicKey;
    }
  ): Promise<string> {
    const { txid, files } = await this.presignCreateArweaveUrl(args);
    let env = args.env;
    if (!env) {
      // @ts-ignore
      const url: string = this.provider.connection._rpcEndpoint;
      if (url.includes("devnet")) {
        env = "devnet";
      } else {
        env = "mainnet-beta";
      }
    }

    const uri = await this.getArweaveUrl({
      txid,
      mint: args.mint,
      files,
      env,
      uploadUrl: args.uploadUrl || ARWEAVE_UPLOAD_URL,
    });

    return uri;
  }

  async presignCreateArweaveUrlInstructions({
    name,
    symbol,
    description = "",
    image,
    creators,
    files = [],
    payer = this.provider.wallet.publicKey,
    existingFiles,
    attributes,
    externalUrl,
    animationUrl,
    extraMetadata,
  }: ICreateArweaveUrlArgs): Promise<InstructionResult<{ files: File[] }>> {
    const metadata = {
      name,
      symbol,
      description,
      image,
      attributes,
      externalUrl: externalUrl || "",
      animationUrl,
      properties: {
        category: MetadataCategory.Image,
        files: [...(existingFiles || []), ...files],
      },
      creators: creators ? creators : null,
      sellerFeeBasisPoints: 0,
      ...(extraMetadata || {}),
    };

    const realFiles = await getFilesWithMetadata(files, metadata);

    const prepayTxnInstructions = await prePayForFilesInstructions(
      payer,
      realFiles
    );

    return {
      instructions: prepayTxnInstructions,
      signers: [],
      output: {
        files: realFiles,
      },
    };
  }

  async presignCreateArweaveUrl(
    args: ICreateArweaveUrlArgs
  ): Promise<{ files: File[]; txid: string }> {
    const {
      output: { files },
      instructions,
      signers,
    } = await this.presignCreateArweaveUrlInstructions(args);
    const txid = await this.sendInstructions(instructions, signers);

    return {
      files,
      txid,
    };
  }

  async getArweaveUrl({
    txid,
    mint,
    files = [],
    uploadUrl = ARWEAVE_UPLOAD_URL,
    env = "mainnet-beta",
  }: {
    env: ArweaveEnv;
    uploadUrl?: string;
    txid: string;
    mint: PublicKey;
    files?: File[];
  }): Promise<string> {
    const result = await uploadToArweave(txid, mint, files, uploadUrl, env);

    const metadataFile = result.messages?.find(
      (m) => m.filename === "manifest.json"
    );

    if (!metadataFile) {
      throw new Error("Metadata file not found");
    }

    // Use the uploaded arweave files in token metadata
    return `https://arweave.net/${metadataFile.transactionId}`;
  }

  async createMasterEditionInstructions({
    mint,
    mintAuthority = this.provider.wallet.publicKey,
    payer = this.provider.wallet.publicKey,
  }: ICreateMasterEditionInstructionsArgs): Promise<
    InstructionResult<{ metadata: PublicKey }>
  > {

    return {
      instructions: [],
      signers: [],
      output: {
        metadata: undefined,
      }
    };
  }

  async createMasterEdition(
    args: ICreateMasterEditionInstructionsArgs
  ): Promise<{ metadata: PublicKey }> {
    const { instructions, signers, output } =
      await this.createMasterEditionInstructions(args);

    await this.sendInstructions(instructions, signers, args.payer);

    return output
  }

  async verifyCollectionInstructions({
    nftMint,
    collectionMint,
    payer = this.provider.wallet.publicKey,
  }: IVerifyCollectionInstructionsArgs): Promise<
    InstructionResult<{ metadata: PublicKey }>
  > {
      
      return {
        instructions: [],
        signers: [],
        output: {
          metadata: undefined,
        }
      };
  }

  async verifyCollection(
    args: IVerifyCollectionInstructionsArgs
  ): Promise<{ metadata: PublicKey }> {
    const { instructions, signers, output } =
      await this.verifyCollectionInstructions(args);

    await this.sendInstructions(instructions, signers, args.payer);

    return output
  }

  async createMetadataInstructions({
    data,
    authority = this.provider.wallet.publicKey,
    mint,
    mintAuthority = this.provider.wallet,
    payer = this.provider.wallet,
  }: ICreateMetadataInstructionsArgs): Promise<
    InstructionResult<{ metadata: PublicKey }>
    > {
      
      const umi = createUmi(this.provider.connection.rpcEndpoint).use(walletAdapterIdentity(payer as Wallet) )
      const transactionBuilder = (await createMetadataAccountV3(umi, {
        data,
        mint:publicKey(mint),
        updateAuthority: publicKey(authority) ,
        mintAuthority: (mintAuthority),
        isMutable: true,
        collectionDetails: null
      }))
      let compiled = await transactionBuilder.buildWithLatestBlockhash(umi)

const metadataPubkey = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
    mint.toBuffer(),
  ],
  new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
)[0]
    const lookupTableAccounts: any = []
for (const table of compiled.message.addressLookupTables) {
// @ts-ignore
  lookupTableAccounts.push(await new Connection(umi.rpc.getEndpoint()).getAddressLookupTable(table.publicKey).value)
}
    const txMessageDecompiled = TransactionMessage.decompile(VersionedMessage.deserialize(compiled.serializedMessage), {
      addressLookupTableAccounts: lookupTableAccounts
    });
    return {
      instructions: txMessageDecompiled.instructions,
      signers: [],
      output: {
        metadata: metadataPubkey,
      },
    };
  }

  async getMetadata(metadataKey: PublicKey): Promise<any | null> {
    const url = `https://mainnet.helius-rpc.com/?api-key=0d4b4fd6-c2fc-4f55-b615-a23bab1ffc85`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getAsset',
          params: {
            id: metadataKey.toString(),
          },
        }),
      });

      const { result } = await response.json();
      
      if (result) {
        return {
          mint: result.mint,
          name: result.content.metadata.name,
          symbol: result.content.metadata.symbol,
          description: result.content.metadata.description,
          image: result.content.links.image,
          decimals: result.token_info.decimals,
          supply: result.token_info.supply,
        };
      }
    } catch (error) {
      console.error('Error fetching asset:', error);
    }
    return null;
  }

  async createMetadata(
    args: ICreateMetadataInstructionsArgs
  ): Promise<{ metadata: PublicKey }> {
    const { instructions, signers, output } =
      await this.createMetadataInstructions(args);

    await this.sendInstructions(instructions, signers, args.payer);

    return output;
  }

  async updateMetadataInstructions({
    data,
    newAuthority,
    metadata,
    updateAuthority,
  }: IUpdateMetadataInstructionsArgs): Promise<
    InstructionResult<{ metadata: PublicKey }>
  > {
    return {
      instructions: [],
      signers: [],
      output: {
        metadata,
      },
    };
  }

  async updateMetadata(
    args: IUpdateMetadataInstructionsArgs
  ): Promise<{ metadata: PublicKey }> {
    const { instructions, signers, output } =
      await this.updateMetadataInstructions(args);

    await this.sendInstructions(instructions, signers, args.payer);

    return output;
  }
}
