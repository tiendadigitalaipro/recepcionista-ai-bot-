FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY bot.js perfil_negocio.json ./

EXPOSE 3000

CMD ["node", "bot.js"]
