import { AuthenticationClient } from "auth0";

export const auth0 = process.env.IS_DEV ? {} as AuthenticationClient : new AuthenticationClient({
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  domain: process.env.AUTH0_DOMAIN!,
});
