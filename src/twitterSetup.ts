import Twitter from "twitter";

const TWITTER_KEY = process.env.TWITTER_KEY;
const TWITTER_SECRET = process.env.TWITTER_SECRET;
const TWITTER_ACCESS_TOKEN_KEY = process.env.TWITTER_ACCESS_TOKEN_KEY;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
if (
  !process.env.IS_DEV &&
  (!TWITTER_KEY ||
  !TWITTER_SECRET ||
  !TWITTER_ACCESS_TOKEN_KEY ||
  !TWITTER_ACCESS_TOKEN_SECRET)
) {
  throw new Error("Missing Twitter credentials");
}

export const twitterClient = new Twitter({
  consumer_key: TWITTER_KEY || "",
  consumer_secret: TWITTER_SECRET || "",
  access_token_key: TWITTER_ACCESS_TOKEN_KEY || "",
  access_token_secret: TWITTER_ACCESS_TOKEN_SECRET || "",
});
