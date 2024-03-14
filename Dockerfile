FROM node
COPY . /app
WORKDIR /app
RUN yarn

CMD yarn test