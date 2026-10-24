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

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 80
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-80}"]
