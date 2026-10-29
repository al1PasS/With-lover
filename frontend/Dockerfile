FROM node:24.11.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_DEMO=false
ENV VITE_DEMO=$VITE_DEMO
RUN npm run build
FROM nginx:1.28.0-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
