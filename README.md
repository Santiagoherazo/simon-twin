# Simón: gemelo digital del cultivo

ESP32 con sensores → MQTT → backend (FastAPI) → TimescaleDB → gemelo 3D en el navegador.
El **suelo** es el centro: eliges un cultivo (maíz, tomate…) y el sistema sabe qué condiciones necesita,
calcula el balance de agua, la etapa de crecimiento y predice cuándo regar. También simula escenarios
(más calor, lluvia, riego) con datos reales o simulados.

![En vivo](frontend/screenshots/live-desktop.png)

## Arrancar

```bash
cp .env.example .env          # y cambia TODAS las contraseñas
docker compose up -d --build  # mosquitto, timescaledb, backend, simulador y web
```
- Gemelo 3D: http://127.0.0.1:8080 (arranca con el dispositivo virtual `sim-01`, que rellena 14 días de histórico).
- API y docs: http://127.0.0.1:8000/docs
- Grafana (opcional): `docker compose --profile grafana up -d`, http://127.0.0.1:3000

Para conectar el ESP32 real: [docs/esp32.md](docs/esp32.md).

## Qué hace el backend

| Pieza | Descripción |
|---|---|
| Perfiles de cultivo | `backend/app/profiles/*.yml` (maíz, tomate): rangos óptimos por etapa, Kc, raíces, GDD. Agrega un archivo y aparece. |
| Suelo | Tipos con θsat/θcc/θpmp; humedad del sensor → agua útil. |
| Balance hídrico | FAO-56 (un depósito): TAW, RAW, agotamiento, Ks; ET0 por Priestley-Taylor con lux/temperatura/HR, calibrada con el secado de las últimas 48 h. |
| Crecimiento | Grados-día (método modificado, base 10 °C, tope 30 °C) → etapa, altura, hojas. |
| Aptitud | Puntaje 0–100 por variable (humedad, T, pH, EC, N-P-K, VPD, luz) y alertas. |
| Simulador what-if | `POST /devices/{id}/simulate`: clima (persistencia o constante), eventos de riego/lluvia, riego automático, cambio de cultivo/suelo. |

Los valores de los perfiles son **indicativos**: valídalos con fuentes agronómicas locales.

## Contrato

Topics MQTT: `simon/<id>/telemetry` (dispositivo→broker), `simon/<id>/status` (retained + LWT),
`simon/<id>/state` (backend→broker, retained, lo consume el navegador por WebSockets, puerto 9001),
`simon/<id>/cmd/pump` (backend→dispositivo).

| Endpoint | Auth |
|---|---|
| `GET /health /crops /soils /devices` · `GET /devices/{id}/latest /history /state` | abierto (solo localhost por defecto) |
| `POST /ingest/{id}` | `X-Device-Key` |
| `POST /devices/{id}/simulate` | abierto |
| `POST /devices`, `PUT /devices/{id}`, `POST /devices/{id}/ingest-key`, `POST /devices/{id}/import`, `POST /devices/{id}/pump` | `X-API-Key` |

Ejemplos de respuesta: `docs/state.sample.json`, `docs/simulate.sample.json`. Prueba de punta a punta:
`API_URL=http://localhost:8000 API_KEY=... python scripts/smoke_test.py`.

## La interfaz (PC y celular)

El gemelo 3D reproduce la matera real: cuerpo negro brillante de esquinas redondeadas (recortado con CSG) con ventana del sustrato (se ve el perfil del suelo, las raíces y la sonda) y ventana del nivel de agua, lámpara ovalada con poste grueso que sube con la planta y cuya barra delantera cambia de color según el estado (verde bien, ámbar con sed, rojo con alerta).

- **PC (centro de mando):** tarjetas con anillos medidores, fichas de medidas, próximo riego, historial de 24 h, aptitud y alertas. Clic en la maceta, la planta o el tanque acerca la cámara y resalta su tarjeta. Atajos: `L` en vivo, `S` simulación, `G` gráficos, espacio reproduce.
- **Celular (compañero del jardín):** una frase ("Tu maíz está bien · riego en ~3 días"), botón grande de riego con vibración, escenarios rápidos (¿Y si llueve? ¿Y si hace calor? ¿Y si no riego?), inclinación por giroscopio y **Ver en AR**.
- **Instalable (PWA):** `manifest` + `sw.js` (solo cachea la interfaz; los datos son siempre en vivo).
- **Calidad gráfica:** Baja / Media / Alta, con ajuste automático de resolución. Parámetros de revisión: `?q=low|medium|high`, `?day=0..1` (fuerza hora del día).

**AR (WebXR):** coloca el gemelo sobre una mesa real a escala reducida. Requiere Android + Chrome + HTTPS. En iPhone Safari no existe AR web; una app nativa (Capacitor + ARKit/ARCore) sería la fase 2. **Sin probar en un teléfono real:** solo se verificó que el botón aparece y llama a `requestSession`.

## Estado de las pruebas (honesto)

- Probado: motor (18 tests), API, MQTT con ACL real y simulador, contra PostgreSQL 16 + Mosquitto, y el frontend
  (compila en TypeScript estricto, capturas con Chromium, bomba con clave buena y mala y estado vacío; el respaldo por REST cuando cae el broker está implementado pero no se probó a propósito).
- **No probado:** el AR en un teléfono real, la instalación como PWA en un dispositivo, el modo de calidad Alta en una GPU real (se revisó con render por software), extensiones de TimescaleDB (hypertable, agregado continuo, retención), `docker compose build`
  (los Dockerfiles están sin construir), Grafana y **hardware real**. Revisa los logs en tu primer arranque.

## Seguridad antes de exponerlo

- Todo escucha en 127.0.0.1. Para internet pon un proxy con **TLS** (MQTT `wss://`, HTTPS) y restringe CORS (`CORS_ORIGINS`).
- La contraseña del usuario `viewer` queda dentro del JavaScript del navegador: es de solo lectura, pero es pública.
- Los GET no piden autenticación; añádela si el jardín es privado.
- Cambia todas las contraseñas del `.env`; la `API_KEY` manda la bomba.

## App Android (Capacitor + CI)

El frontend está envuelto con Capacitor (`frontend/android`). GitHub Actions compila el APK en cada push/PR: `.github/workflows/android.yml` → artefacto **simon-debug-apk** (y lo adjunta al release si subes un tag `v*`).

- Configura en el repo las variables `VITE_API_URL`, `VITE_MQTT_URL`, `VITE_MQTT_USER`, `VITE_DEFAULT_DEVICE` y el secreto `VITE_MQTT_PASS`; se incrustan al compilar. Sin ellas la app apunta a `127.0.0.1` (en un celular no sirve).
- Local: `cd frontend && npm run cap:sync && npm run cap:open` (requiere Android Studio).
- Es un APK **debug** (instálalo con "orígenes desconocidos"). Para Play Store hace falta firma release (keystore en secretos).
- El WebView de Android **no soporta WebXR**: el botón de AR no aparecerá en la app; la AR sigue funcionando en Chrome Android vía PWA/HTTPS.
- No se pudo compilar el APK en el entorno donde se escribió (sin Android SDK): el primer run de CI puede necesitar ajustes.
