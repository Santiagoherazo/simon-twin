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


## Firmware 2.1: hardware confirmado, servo, ultrasonido y pantalla OLED
La lista de sensores, actuadores y pantalla (pines, escalas, reglas) se descarga del backend. Ver `docs/panel-admin.md`.
**Hardware soportado** (y nada más): DHT11 · humedad de suelo capacitiva · DS18B20 enterrado · 4 LDR · ultrasonido HC-SR04 ·
mini bomba · luz externa · servo · pantalla OLED 0,91″. Se retiraron BH1750, sensor digital, salida digital y PWM.

**Librerías** (Administrador de bibliotecas de Arduino): `PubSubClient`, `ArduinoJson` v6, `DHT sensor library` + `Adafruit Unified Sensor`,
`OneWire`, `DallasTemperature`, `ESP32Servo`, `U8g2`. Si no usas una pieza, comenta su `#define USE_…` al inicio del sketch.
La página local (`http://<ip>/`) y `/api/state`, `/api/history`, `/api/act?key=<actuador>&s=<seg>` se adaptan solos a la configuración.

## Hardware confirmado (panel admin → Sensores → «Cargar hardware confirmado»)
| Pieza | Pin ESP32 | Notas |
|---|---|---|
| DHT11 (temp./humedad aire) | GPIO 4 | `param` 11; pull-up de 10 kΩ si el módulo no la trae |
| Humedad de suelo capacitiva | GPIO 36 (ADC1) | clave `vwc_raw`; calibra seco/mojado en el panel |
| DS18B20 (temp. suelo) | GPIO 18 | pull-up de 4,7 kΩ entre datos y 3V3 |
| 4 fotorresistencias (LDR) | GPIO 32, 33, 34, 35 (ADC1) | Divisor: 3V3 → LDR → pin → 10 kΩ → GND. Esquinas: 32 NO, 33 NE, 34 SO, 35 SE |
| Ultrasonido HC-SR04 | TRIG 23 · ECHO 19 | Alimentado a 5 V. **ECHO sale a 5 V: baja a 3,3 V con un divisor** (1 kΩ + 2 kΩ). Mide la distancia al agua |
| Mini bomba (relé) | GPIO 26 | máx. 120 s por activación |
| Luz externa (relé) | GPIO 27 | máx. 1 h por activación; se puede apagar antes desde la interfaz |
| Servo («Luz indirecta») | GPIO 13 | Abre y cierra la entrada de luz indirecta. 5 V externos (no del pin del ESP32), GND común. Abrir lo lleva a `angle_on` (90°) y **se queda ahí** hasta que lo cierren (`angle_off`, 0°); no tiene temporizador. Al reiniciar el ESP32 arranca cerrado |
| Pantalla OLED SSD1306 128×32 | SDA 21 · SCL 22 | Dirección I2C 0x3C (60). Rota 3 variables por página |

**Nivel del tanque.** El HC-SR04 va en la tapa mirando al agua y manda `tank_cm` (distancia). El indicador `tank_pct` lo convierte en %
con la fórmula `max(0, min(100, (15 - tank_cm) / (15 - 3) * 100))`: **15 = distancia con el tanque vacío y 3 = con el tanque lleno**
(valores de ejemplo: mídelos en tu montaje y edítalos en Indicadores). Bajo el 15 % el servidor marca el tanque como bajo y dispara la alerta.

**Luz.** Las 4 LDR llegan como `ldr_nw/ne/sw/se` en % (relativos, no lux). Indicadores: `luz_media` y `luz_desbalance` (máx.–mín.; > 35 % = sombra
desigual). Para el modelo de cultivo el servidor estima lux como media × 400 (**sin calibrar**; ajusta `LUX_PER_PCT` en `ingest.py` con un luxómetro),
pero en pantalla solo se muestra la luz en %.

Usa solo pines ADC1 (32-39) para analógicos: el ADC2 deja de funcionar con el WiFi activo.

**Orden por MQTT/REST:** `{"seconds": N}` enciende N s; `{"seconds": 0}` apaga ya.

**Probado**: lectura de configuración, servo, relés, mediana del ultrasonido y páginas de la OLED en C++ de escritorio con ArduinoJson real
(`firmware/tests/run_host_tests.sh`). **Sin probar**: compilación con el core real de Arduino y el hardware.
