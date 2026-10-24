#!/bin/sh
# Genera el archivo de contraseñas desde variables de entorno y arranca Mosquitto.
set -e
: "${MQTT_BACKEND_PASSWORD:?falta MQTT_BACKEND_PASSWORD}"
: "${MQTT_SIM_PASSWORD:?falta MQTT_SIM_PASSWORD}"
: "${MQTT_ESP32_PASSWORD:?falta MQTT_ESP32_PASSWORD}"
: "${MQTT_VIEWER_PASSWORD:?falta MQTT_VIEWER_PASSWORD}"

mkdir -p /mosquitto/data /mosquitto/log
rm -f /tmp/passwd
mosquitto_passwd -b -c /tmp/passwd backend "$MQTT_BACKEND_PASSWORD"
mosquitto_passwd -b    /tmp/passwd viewer  "$MQTT_VIEWER_PASSWORD"
mosquitto_passwd -b    /tmp/passwd sim-01  "$MQTT_SIM_PASSWORD"
mosquitto_passwd -b    /tmp/passwd esp32-01 "$MQTT_ESP32_PASSWORD"
chown mosquitto:mosquitto /tmp/passwd /mosquitto/data /mosquitto/log 2>/dev/null || true
chmod 0700 /tmp/passwd

exec su-exec mosquitto /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
