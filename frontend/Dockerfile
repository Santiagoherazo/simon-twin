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
ENV PORT=80
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
CMD sh -c "envsubst '\${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"
EXPOSE 80
