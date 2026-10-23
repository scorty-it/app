FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Il nome del titolare per la pagina Privacy: dal file .env del server, non dal codice (vedi compose.yml).
ARG TITOLARE=""
ENV VITE_TITOLARE=$TITOLARE
# Il dominio per gli indirizzi assoluti delle anteprime dei link e della sitemap (vite.config.ts).
ARG DOMINIO=""
RUN npm run build

FROM caddy:2.10-alpine
COPY --from=build /app/dist /srv
