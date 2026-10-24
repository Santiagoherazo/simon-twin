# Conectar el ESP32 (o cualquier cosa que hable HTTP/MQTT)

El backend ya espera los datos; al ESP32 solo le falta enviarlos. **Nada de esto está probado en hardware real**
(se probó con el simulador y con `curl`/`mosquitto_pub`).

## Contrato de telemetría (JSON)

Todos los campos son opcionales: manda solo lo que tengas. El backend convierte `vwc_raw` en % usando la
calibración del dispositivo (`vwc_raw_dry` = seco al aire, `vwc_raw_wet` = en agua; se editan con `PUT /devices/{id}`).

```json
{
  "v": 1,
  "ts": 1760000000,
  "vwc_raw": 2100,
  "soil_t": 24.5, "ph": 6.4, "ec": 620,
  "n": 78, "p": 34, "k": 180,
  "air_t": 27.1, "air_rh": 62, "lux": 18000,
  "tank_ok": true, "pump_on": false, "pump_ma": 0
}
```

`ts` es epoch en segundos (sincroniza con NTP). Si lo omites, el backend usa su propia hora.
Se rechaza un `ts` más de 300 s en el futuro; las fechas pasadas solo se aceptan de dispositivos `sim-*` o por `/import`.

## Opción A: MQTT (recomendada)

- Usuario = `device_id` (p. ej. `esp32-01`), contraseña = `MQTT_ESP32_PASSWORD` del `.env`, puerto 1883.
- Publica en `simon/esp32-01/telemetry` cada 5–10 s.
- Estado: `simon/esp32-01/status` con `online` (retained) y Last Will `offline`.
- Escucha `simon/esp32-01/cmd/pump`: `{"cmd_id":"...","seconds":10,"ts":...}` (QoS 1). Enciende la bomba
  `seconds` s y corta siempre con un tope propio; sigue publicando `pump_on`/`pump_ma`.
- Con el ACL, cada dispositivo solo escribe en sus topics y lee sus comandos.

```cpp
// platformio.ini: lib_deps = knolleary/PubSubClient, bblanchon/ArduinoJson
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

WiFiClient net; PubSubClient mqtt(net);
const char* ID = "esp32-01";
unsigned long pumpOffAt = 0;

void onCmd(char*, byte* p, unsigned int n) {
  JsonDocument d; if (deserializeJson(d, p, n)) return;
  int s = constrain((int)d["seconds"], 0, 120);      // tope local de seguridad
  if (s > 0) { digitalWrite(PUMP_PIN, HIGH); pumpOffAt = millis() + s * 1000UL; }
}

void connectMqtt() {
  String t = String("simon/") + ID;
  while (!mqtt.connected()) {
    if (mqtt.connect(ID, ID, MQTT_PASS, (t + "/status").c_str(), 1, true, "offline")) {
      mqtt.publish((t + "/status").c_str(), "online", true);
      mqtt.subscribe((t + "/cmd/pump").c_str(), 1);
    } else delay(2000);
  }
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  if (pumpOffAt && (long)(millis() - pumpOffAt) >= 0) { digitalWrite(PUMP_PIN, LOW); pumpOffAt = 0; }
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    last = millis();
    JsonDocument d;
    d["v"] = 1; d["ts"] = (uint32_t)time(nullptr);
    d["vwc_raw"] = analogRead(SOIL_PIN);
    d["air_t"] = readTemp(); d["air_rh"] = readRh();
    d["tank_ok"] = digitalRead(TANK_PIN); d["pump_on"] = digitalRead(PUMP_PIN);
    char buf[384]; size_t n = serializeJson(d, buf);
    mqtt.publish("simon/esp32-01/telemetry", (const uint8_t*)buf, n);
  }
}
```
(`setup()`, WiFi, `configTime(...)`, `mqtt.setServer/ setCallback(onCmd)` y los pines van en tu proyecto.)

## Opción B: HTTP

```bash
# 1) generar la clave del dispositivo (una vez; se muestra una sola vez)
curl -X POST http://HOST:8000/devices/esp32-01/ingest-key -H "X-API-Key: $API_KEY"
# 2) enviar lecturas
curl -X POST http://HOST:8000/ingest/esp32-01 \
  -H "Content-Type: application/json" -H "X-Device-Key: <clave>" \
  -d '{"vwc_raw":2100,"air_t":27.1,"air_rh":62,"lux":18000}'
```

## Importar histórico (CSV de la SD / PLX-DAQ)

Convierte las filas a JSON con `ts` en cada una y envía `POST /devices/{id}/import` con
`{"rows":[...]}` (máx. 5000 por llamada, cabecera `X-API-Key`).

## Calibrar el sensor de humedad

Mide `vwc_raw` con el sensor en el aire (seco) y sumergido en agua; guarda ambos con
`PUT /devices/esp32-01 {"vwc_raw_dry":3100,"vwc_raw_wet":1300}`. Sin calibrar, los porcentajes son solo orientativos.
