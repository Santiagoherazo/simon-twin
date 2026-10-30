# Firmware de prueba (ESP32)

`esp32_telemetria/` publica telemetría simulada cada 10 s a `simon/esp32-01/telemetry` y su estado en `simon/esp32-01/status`.

1. WiFi y contraseña MQTT van en texto plano al inicio del sketch (solo pruebas; `mqtt_password` = `MQTT_ESP32_PASSWORD` del broker).
2. Librerías: PubSubClient, ArduinoJson (v6), WiFi/HTTPClient del core ESP32.
3. El sketch pregunta la dirección del broker a `config_url` (`GET /mqtt-config`, que sirve el backend con `MQTT_PUBLIC_HOST`/`MQTT_PUBLIC_PORT`). Debe ser un puerto **TCP** del broker (en Railway, un TCP Proxy al 1883).
4. El estado se manda como texto plano `online`/`offline` (el backend también acepta JSON `{"status":"online"}`).

## Qué pasa cuando el puerto del broker cambia o se cae la conexión
- Cada lectura (cada 10 s, con hora NTP) entra primero a una **cola en RAM** de 120 lecturas (20 min). Si no hay conexión MQTT, se acumula; al reconectar se envía en orden, una cada 150 ms.
- El backend acepta lecturas con hasta **1 h** de atraso para dispositivos reales (`DEVICE_BACKDATE_MAX_S`). Pasado eso, usa la hora de llegada.
- El monitor consulta `/mqtt-config` cada 30 s (cada 8 s si no hay conexión) y solo cambia de puerto si el valor nuevo se repite 2 veces.
- `keepalive` de 15 s para notar una conexión muerta en ~20 s.
- Límite: PubSubClient no tiene QoS 1 al publicar. Si el túnel muere sin cerrar el socket, las lecturas enviadas en esos ~15–30 s hasta que el keepalive lo detecta pueden perderse. Un cambio de puerto ordenado (el sketch se desconecta él mismo) no pierde nada.
- La cola vive en RAM: si el ESP32 se reinicia, se pierde lo que no se haya enviado.
