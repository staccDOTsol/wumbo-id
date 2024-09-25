import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { Connection, Transaction, Keypair as kp } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import { keypairIdentity, PublicKey, publicKey } from "@metaplex-foundation/umi";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';

export type Keypair = {
  publicKey: PublicKey;
  secretKey: Uint8Array;
};
export async function uploadFiles(
  provider: AnchorProvider | undefined,
  files: File[],
  delegateWallet: Wallet,
  tries: number = 5
): Promise<string[] | undefined> {
  if (files.length == 0) {
    return [];
  }

  if (provider) {
    const umi = createUmi(provider.connection.rpcEndpoint)
      .use(walletAdapterIdentity(delegateWallet))
      .use(irysUploader());

    const res = await withRetries(async () => {
      const uploaded = (
        await umi.uploader.upload(files.map((file) => ({
          buffer: Buffer.from([]),
          fileName: file.name,
          displayName: file.name,
          uniqueName: file.name,
          contentType: file.type,
          extension: file.name.split(".").pop(),
          tags: [],
        })))
      )
      if (uploaded.length !== files.length) {
        throw new Error("Upload failed");
      }
      return uploaded;
    }, tries);

    return res;
  }
}

export function randomizeFileName(file: File): void {
  const ext = file.name.split(".").pop();
  const name = randomIdentifier() + (ext ? `.${ext}` : "");

  Object.defineProperty(file, "name", {
    writable: true,
    value: name,
  });
}

function randomIdentifier(): string {
  return Math.random().toString(32).slice(2);
}

// docusaurus SSR has issues with Keypair.fromSecretKey running, not sure why.
const getDevnetWallet = () => {
  try {
    return kp.fromSecretKey(
      new Uint8Array([
        17, 83, 103, 136, 230, 98, 37, 214, 218, 31, 168, 218, 184, 30, 163, 18,
        164, 101, 117, 232, 151, 205, 200,
      ])
    );
  } catch (e: any) {
    //ignore
  }
};
// A devnet wallet loaded with 1 SHDW for testing in devnet. Yes, anyone can mess with this wallet.
// If they do, devnet shdw things will not continue working. That's life. If you find this,
// please don't be an asshole.
const DEVNET_WALLET = getDevnetWallet();
function maybeUseDevnetWallet(
  connection: Connection,
  delegateWallet: Keypair | undefined
): Keypair | undefined {
  // @ts-ignore
  if (connection._rpcEndpoint.includes("dev") || connection._rpcEndpoint.includes("localhost")) {
    return {
      publicKey: publicKey(DEVNET_WALLET.publicKey.toString()),
      secretKey: DEVNET_WALLET.secretKey,
    };
  }
  return delegateWallet;
}

async function withRetries<T>(
  arg0: () => Promise<T>,
  tries: number = 3
): Promise<T> {
  try {
    return await arg0();
  } catch (e: any) {
    if (tries > 0) {
      console.warn(`Failed tx, retrying up to ${tries} more times.`, e);
      await sleep(1000);
      return withRetries(arg0, tries - 1);
    }
    throw e;
  }
}