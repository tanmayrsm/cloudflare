FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8787

CMD ["npm", "run", "dev", "--", "--ip", "0.0.0.0"]
