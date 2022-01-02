import { createNameRegistry, getNameAccountKey, getHashedName, NameRegistryState } from "@bonfida/spl-name-service"
import { Connection, Keypair, sendAndConfirmRawTransaction, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';

const serviceAccount = Keypair.fromSecretKey(
  Buffer.from(
    JSON.parse(
      require("fs").readFileSync(
        process.env.ANCHOR_WALLET!,
        {
          encoding: "utf-8",
        }
      )
    )
  )
);

async function run(): Promise<void> {
  const connection = new Connection(process.env.SOLANA_URL!);
  const name = `wumbo-twitter-test`;
  const nameTld = await getNameAccountKey(await getHashedName(name));
  console.log("Using wallet", serviceAccount.publicKey.toBase58());
  console.log(`Going to create tld ${name} at ${nameTld.toBase58()}`);
  const existing = await connection.getAccountInfo(nameTld);
  if (!existing) {
    console.log(`Creating tld ${name} at ${nameTld.toBase58()}`);
    const nameTx = new Transaction({
      recentBlockhash: (await connection.getRecentBlockhash()).blockhash
    })
    nameTx.instructions.push(
      await createNameRegistry(
        connection,
        name,
        NameRegistryState.HEADER_LEN,
        serviceAccount.publicKey, // Payer
        serviceAccount.publicKey // Owner
      )
    )
    await sendAndConfirmTransaction(connection, nameTx, [serviceAccount]);
  } else {
    const nameDes = await NameRegistryState.retrieve(connection, nameTld);
    console.log("Name already exists, owner is", nameDes.owner.toBase58());
  }
}
run().catch(console.error)