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


## Modo local y sin nube (v1.4)

El ESP32 funciona solo; la nube es un extra.

- **Servidor local** en el puerto 80: `http://<ip>/` (página con datos, gráfica y botón de bomba), `GET /api/state`, `GET /api/history?n=120`, `POST /api/pump?s=15` (`s=0` para parar). Con CORS y `Access-Control-Allow-Private-Network`.
- **mDNS**: `http://simon-esp32-01.local` (en Android a veces no resuelve `.local`; usa la IP).
- **Red propia de respaldo**: si el WiFi lleva más de 30 s caído, levanta `Simon-esp32-01` (clave `simon1234`) → `http://192.168.4.1`. Se apaga tras 60 s de WiFi estable.
- **Anuncio de IP**: al conectar a MQTT publica (retenido) `simon/esp32-01/info` = `{"ip","host","fw"}`. El backend lo guarda en `devices.local_ip/local_host` y la app lo aprende. Se vuelve a publicar si cambia la IP.
- **Cola de lecturas**: 120 en RAM; al llenarse pasan a `/spill.log` en flash (tope ~400 KB ≈ 2000 lecturas ≈ 5,5 h a 10 s) y se envían en orden al reconectar. Lo que está solo en RAM se pierde si el equipo se reinicia. El backend acepta atrasos de hasta 24 h (`DEVICE_BACKDATE_MAX_S`).
- **Riego autónomo**: umbrales `PUMP_ON_BELOW`/`PUMP_OFF_ABOVE`, tope `PUMP_MAX_S`, enfriamiento de 10 min. Configura `PUMP_PIN` (por defecto -1 = solo simulado).
- Requiere el core ESP32 de Arduino (WebServer, ESPmDNS, LittleFS) y activar un esquema de particiones con SPIFFS/LittleFS (el por defecto sirve).
- Permite ACL `simon/%u/info` en el broker (ya está en `mosquitto/acl`).

**Sin probar en hardware.** La lógica de cola/flash se verificó en C++ de escritorio con mocks.


## Respaldo directo en Supabase (v1.5)
Si MQTT lleva más de 45 s caído pero hay WiFi, las lecturas pendientes (flash primero, luego RAM) se envían en lotes de 10 por HTTPS a
la tabla `simon_inbox` de Supabase; el backend las valida y las trae. Se confirman (se quitan de la cola) solo si Supabase respondió
200/201/204. Rellena `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `INGEST_KEY`; vacío = desactivado. Ver `docs/respaldo-supabase.md`.
**Sin probar en hardware** (la lógica de cola peek/ack sí se probó en C++ de escritorio, incluyendo un envío fallido y el paso flash→RAM).
