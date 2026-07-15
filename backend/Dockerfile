FROM node:22-alpine

ENV BACKEND_PORT=8080
WORKDIR /app
COPY src/ ./src/
COPY public/ ./public/
RUN chmod -R a+rX /app

EXPOSE 8080
CMD ["node", "src/server.js"]
