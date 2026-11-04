#!/bin/sh
# Genera el archivo de contraseñas desde variables de entorno y arranca Mosquitto.
# Así no hay contraseñas guardadas en el repositorio.
set -eu

PW=/tmp/passwd
: > "$PW"
mosquitto_passwd -b "$PW" backend "$MQTT_BACKEND_PASSWORD"
mosquitto_passwd -b "$PW" sim-01  "$MQTT_SIM_PASSWORD"
mosquitto_passwd -b "$PW" esp32-01 "$MQTT_ESP32_PASSWORD"
mosquitto_passwd -b "$PW" viewer  "$MQTT_VIEWER_PASSWORD"
chown mosquitto:mosquitto "$PW"
chmod 0600 "$PW"

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
