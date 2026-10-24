FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://127.0.0.1:8000
ARG VITE_MQTT_URL=ws://127.0.0.1:9001
ARG VITE_MQTT_USER=viewer
ARG VITE_MQTT_PASS
ARG VITE_DEFAULT_DEVICE=sim-01
ENV VITE_API_URL=$VITE_API_URL VITE_MQTT_URL=$VITE_MQTT_URL VITE_MQTT_USER=$VITE_MQTT_USER \
    VITE_MQTT_PASS=$VITE_MQTT_PASS VITE_DEFAULT_DEVICE=$VITE_DEFAULT_DEVICE
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["sh", "-c", "sed -i 's/\\$PORT/'$PORT'/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
