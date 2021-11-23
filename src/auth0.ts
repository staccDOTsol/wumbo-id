import { AuthenticationClient } from "auth0";

export const auth0 = new AuthenticationClient({
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  domain: process.env.AUTH0_DOMAIN!,
});
