FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js schema.sql ./

EXPOSE 3001
CMD ["node", "index.js"]
