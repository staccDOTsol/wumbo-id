import Twitter from "twitter";

const TWITTER_KEY = process.env.TWITTER_KEY;
const TWITTER_SECRET = process.env.TWITTER_SECRET;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
if (
  !process.env.IS_DEV &&
  (!TWITTER_KEY ||
  !TWITTER_SECRET ||
  !TWITTER_BEARER_TOKEN)
) {
  throw new Error("Missing Twitter credentials");
}

export const twitterClient = new Twitter({
  consumer_key: TWITTER_KEY || "",
  consumer_secret: TWITTER_SECRET || "",
  bearer_token: TWITTER_BEARER_TOKEN || ""
});
