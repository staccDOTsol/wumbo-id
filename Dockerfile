FROM node:latest
ARG NPM_TOKEN  

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./
COPY strata/packages/spl-token-bonding ./strata/packages/spl-token-bonding
COPY strata/packages/spl-token-collective ./strata/packages/spl-token-collective
RUN yarn install
RUN rm -f .npmrc

COPY src src
COPY tsconfig.json tsconfig.json

RUN yarn run build

CMD ["node", "dist/index.js"]
