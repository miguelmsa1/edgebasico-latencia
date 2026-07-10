FROM node:22-alpine

ENV EDGE_REGION=Bilbao
ENV PORT=80

WORKDIR /app

COPY src/ ./src/
COPY public/ ./public/

RUN chmod -R a+rX /app

EXPOSE 80

CMD ["node", "src/server.js"]
