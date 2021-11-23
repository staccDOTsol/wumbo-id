import { NAME_PROGRAM_ID } from '@bonfida/spl-name-service';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import Fastify from 'fastify';
import redis from "redis";
import { auth0 } from './auth0';
import { createVerifiedTwitterRegistry } from './nameServiceTwitter';
import { twitterClient } from './twitter';

const connection = new Connection(process.env.SOLANA_URL!);
const twitterServiceAccount = Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.TWITTER_SERVICE_ACCOUNT!)));
const twitterTld = new PublicKey(process.env.TWITTER_TLD!)

export const redisClient = redis.createClient({
  host: process.env["REDIS_HOST"] || "localhost",
  port: Number(process.env["REDIS_PORT"] || "6379")
})

export const app = Fastify()

app.register(require('fastify-cors'), {
  origin: (origin: any, cb: any) => {
    cb(null, true)
  }
})

app.post<{ Body: { pubkey: string, code: string, redirectUri: string, twitterHandle: string } }>('/registrar/twitter-oauth', async (req) => {
  const { pubkey, code, redirectUri, twitterHandle } = req.body;

  const { access_token: accessToken } =
    (await auth0.oauth?.authorizationCodeGrant({
      code,
      redirect_uri: redirectUri,
    }) || {});
  const user = await auth0.users?.getInfo(accessToken!);
  // @ts-ignore
  const { sub } = user;
  const twitterUser: any = await twitterClient.get("users/show", {
    user_id: sub.replace("twitter|", ""),
  });

  if (twitterUser.screen_name != twitterHandle) {
    throw new Error(`Screen name does ${twitterUser.screen_name} not match the screen name provided ${twitterHandle}`);
  }

  const pubKey = new PublicKey(pubkey)
  const instructions = await createVerifiedTwitterRegistry(
    connection,
    twitterHandle,
    pubKey,
    1000,
    pubKey,
    NAME_PROGRAM_ID,
    twitterServiceAccount.publicKey,
    twitterTld
  );

  const transaction = new Transaction({ recentBlockhash: (await connection.getRecentBlockhash()).blockhash, feePayer: pubKey })
  transaction.add(...instructions);
  transaction.partialSign(twitterServiceAccount);

  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toJSON()
})

app.get('/', async () => {
  return { healthy: 'true' }
})

app.listen(Number(process.env["PORT"] || "8080"), '0.0.0.0')
