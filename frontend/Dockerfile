FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN sed -i 's/worker_connections  1024;/worker_connections 8192;/' /etc/nginx/nginx.conf 2>/dev/null || \
    sed -i 's/worker_connections 1024;/worker_connections 8192;/' /etc/nginx/nginx.conf
EXPOSE 80
