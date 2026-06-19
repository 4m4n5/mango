FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app
RUN git clone --depth 1 https://github.com/SebastianMorel/AIOLists.git . \
  && npm ci --omit=dev

ENV NODE_ENV=production
ENV PORT=7000
EXPOSE 7000

CMD ["npm", "start"]
