FROM node:22-alpine

ENV REGION=Bilbao
ENV PORT=80
ENV LOCAL_BACKEND_PORT=8080

WORKDIR /app
COPY src/ ./src/
COPY public/ ./public/
RUN chmod -R a+rX /app

EXPOSE 80
CMD ["node", "src/server.js"]
