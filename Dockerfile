FROM node

WORKDIR /app

RUN npm install nodemon -g

ADD . .

RUN chown -R node:node /app
USER node

RUN yarn --ignore-engines install

EXPOSE 8080
CMD [ "yarn", "start" ]
