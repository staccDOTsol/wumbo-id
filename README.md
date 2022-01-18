# Wum.bo Identity Service

Verifies social media and oauth handles via the solana name service

## Creating a custom dev tld

Run 
```
ANCHOR_WALLET=<PATH TO WALLET> SOLANA_URL=https://api.devnet.solana.com yarn run bootstrap
```

Then be sure to set TWITTER_TLD to the one mentioned in the logs, and TWITTER_SERVICE_ACCOUNT to the id.json used when running bootstrap.
