FROM node:14
ARG NPM_TOKEN  

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./

RUN yarn install
RUN rm -f .npmrc

COPY . .
COPY tsconfig.json tsconfig.json

RUN yarn run build

CMD ["node", "dist/index.js"]
