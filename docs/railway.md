# Despliegue en Railway

El repositorio es un monorepo: **en la raíz no hay nada que construir**. Si un servicio apunta a la raíz,
Railpack falla con "Railpack failed to prepare the build". Cada servicio necesita su *Root Directory*
(Settings → Source) y trae su propio `railway.json` + `Dockerfile`.

| Servicio | Origen / Root Directory | Variables principales |
|---|---|---|
| Postgres | plantilla **TimescaleDB** de Railway (recomendado) o Postgres normal | — |
| mosquitto | `/mosquitto` | `MQTT_BACKEND_PASSWORD`, `MQTT_SIM_PASSWORD`, `MQTT_ESP32_PASSWORD`, `MQTT_VIEWER_PASSWORD` |
| backend | `/backend` | `MQTT_PUBLIC_HOST` + `MQTT_PUBLIC_PORT` (dirección pública del broker; la sirve `GET /mqtt-config` a los ESP32), `DATABASE_URL`, `MQTT_HOST=mosquitto.railway.internal`, `MQTT_PORT=1883`, `MQTT_USER=backend`, `MQTT_PASSWORD`, `API_KEY`, `CORS_ORIGINS` |
| frontend | `/frontend` | `VITE_API_URL`, `VITE_MQTT_URL`, `VITE_MQTT_USER=viewer`, `VITE_MQTT_PASS`, `VITE_DEFAULT_DEVICE=sim-01` |
| simulator (opcional) | `/simulator` | `MQTT_HOST=mosquitto.railway.internal`, `MQTT_PASSWORD` (= `MQTT_SIM_PASSWORD`), `DEVICE_ID=sim-01` |

Notas
- **Esquema:** el backend crea las tablas solo al arrancar (`app/schema.sql`). Con la plantilla TimescaleDB además activa la hypertable, el agregado continuo y la retención; con Postgres normal funciona igual, sin eso.
- `DATABASE_URL`: usa la referencia de Railway, p. ej. `${{Postgres.DATABASE_URL}}`.
- `CORS_ORIGINS` es una lista JSON con la URL pública del frontend: `["https://tu-frontend.up.railway.app"]`.
- Los `VITE_*` se incrustan al **compilar**: si los cambias hay que volver a desplegar el frontend. `VITE_MQTT_PASS` queda visible en el navegador (el usuario `viewer` solo puede leer, ver `mosquitto/acl`).
- `VITE_MQTT_URL` debe ser `wss://…` hacia un dominio público de Mosquitto con *target port* 9001 (WebSocket). Para ESP32 reales usa un *TCP Proxy* al puerto 1883.
- Backend y frontend usan el `PORT` que da Railway.
- No subas archivos `.env.*` con contraseñas al repositorio.
