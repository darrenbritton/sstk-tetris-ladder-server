FROM node:10-alpine

WORKDIR /app

RUN npm install nodemon -g

ADD . .

RUN chown -R node:node /app
USER node

RUN yarn install

EXPOSE 8080
CMD [ "yarn", "start" ]
