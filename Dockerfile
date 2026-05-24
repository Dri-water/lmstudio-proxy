FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV PROXY_PORT=1235
ENV ADMIN_PORT=8090
ENV LMSTUDIO_URL=http://localhost:1234
ENV DOCKER=true
ENV CONFIG_DIR=/data

RUN mkdir -p /data

EXPOSE 1235 8090

VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
