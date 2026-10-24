# Despliegue en Railway

El repo es un monorepo: **no hay nada que construir en la raíz**. Si un servicio de Railway apunta a la raíz, Railpack falla con
"Railpack failed to prepare the build". Cada servicio necesita su *Root Directory*:

| Servicio | Root Directory | Notas |
|---|---|---|
| timescaledb | (imagen `timescale/timescaledb:latest-pg16`) | tras crearlo, ejecuta `db/init.sql` una vez |
| mosquitto | `/mosquitto` | vars `MQTT_*_PASSWORD`; expón el puerto 9001 (WebSocket) con dominio público |
| backend | `/backend` | `DATABASE_URL`, `MQTT_HOST`, `MQTT_PORT=1883`, `MQTT_USER=backend`, `MQTT_PASSWORD`, `API_KEY`, `CORS_ORIGINS` |
| frontend | `/frontend` | `PORT=80` y `VITE_*` (se leen al compilar) |
| simulator | `/simulator` | `MQTT_HOST`, `MQTT_PASSWORD` (= la del usuario sim-01), `DEVICE_ID` |

Dentro de la red privada usa `mosquitto.railway.internal`, `timescaledb.railway.internal`, etc.
No subas archivos `.env.*` con contraseñas reales al repo.
