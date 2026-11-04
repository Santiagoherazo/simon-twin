#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>

#define FW_VERSION "1.5"

// === CONFIGURACIÓN WIFI ===
const char* ssid     = "vivo Y33s";
const char* password = "12345678";

// === CONFIGURACIÓN DISPOSITIVO ===
const char* device_id       = "esp32-01";
const char* mqtt_user       = "esp32-01";                 // = device_id (lo exige el ACL del broker)
const char* mqtt_password   = "Qgr_KMAM7VWyG3Q7PBvl3MuU"; // = MQTT_ESP32_PASSWORD del broker (solo pruebas)
const char* topic_telemetry = "simon/esp32-01/telemetry";
const char* topic_cmd       = "simon/esp32-01/cmd/#";
const char* topic_status    = "simon/esp32-01/status";
const char* config_url      = "https://simon.zeusr2.duckdns.org/mqtt-config";

// === MODO LOCAL / SIN NUBE ===
const char* CLOUD_BASE = "https://simon.zeusr2.duckdns.org";  // la página local comprueba CLOUD_BASE/health y ofrece volver
const char* MDNS_NAME  = "simon-esp32-01";                   // http://simon-esp32-01.local
const char* AP_SSID    = "Simon-esp32-01";                   // red propia si el WiFi cae (IP 192.168.4.1)
const char* AP_PASS    = "simon1234";                        // solo pruebas

// === RESPALDO DIRECTO EN SUPABASE (si cae tu servidor) ===
// Vacío = desactivado. Con la tabla simon_inbox (la crea el backend) y la clave pública "anon" solo se puede INSERTAR.
const char* SUPABASE_URL      = "";    // https://TU-PROYECTO.supabase.co
const char* SUPABASE_ANON_KEY = "";    // Project Settings → API → anon public (solo pruebas)
const char* INGEST_KEY        = "";    // POST /devices/esp32-01/ingest-key en el backend
const unsigned long SB_AFTER_MS = 45000;   // tiempo sin MQTT antes de usar Supabase (evita saltar por un cambio de puerto)
const unsigned long SB_EVERY_MS = 10000;   // un lote cada 10 s
const int SB_BATCH = 10;

// === RIEGO AUTÓNOMO (funciona sin nube) ===
const int   PUMP_PIN        = -1;       // GPIO del relé de la bomba; -1 = solo simulado (sin salida física)
const bool  PUMP_ACTIVE_HIGH = true;
const bool  AUTO_IRRIGATION  = true;
const float PUMP_ON_BELOW    = 30.0;    // % de humedad: debajo de esto riega
const float PUMP_OFF_ABOVE   = 40.0;    // % de humedad: al llegar aquí corta
const int   PUMP_AUTO_S      = 30;      // segundos por riego automático
const int   PUMP_MAX_S       = 120;     // tope duro por cualquier comando
const unsigned long PUMP_COOLDOWN_MS = 600000;   // 10 min entre riegos automáticos
const int   RAW_DRY = 3100, RAW_WET = 1300;      // calibración local (el backend usa la suya)

// === OBJETOS ===
WebServer server(80);
WiFiClient mqttClient;
PubSubClient client(mqttClient);

// === VARIABLES COMPARTIDAS ===
String mqtt_host_new = "";
int    mqtt_port_new = 0;

String mqtt_host_cur = "";
int    mqtt_port_cur = 0;

// Flags
volatile bool switchRequested = false;

// Mutex para acceso seguro
SemaphoreHandle_t cfgMutex;
SemaphoreHandle_t httpMutex;

// Tareas
TaskHandle_t hMonitor;
TaskHandle_t hMqtt;

// === OBTENER CONFIG DESDE DNS ===
bool fetchConfig() {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  if (xSemaphoreTake(httpMutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
    return false;
  }

  bool success = false;
  WiFiClientSecure httpsClient;
  httpsClient.setInsecure();

  HTTPClient http;
  http.setTimeout(4000);
  
  if (http.begin(httpsClient, config_url)) {
    int code = http.GET();
    if (code == HTTP_CODE_OK) {
      String payload = http.getString();
      DynamicJsonDocument doc(256);
      DeserializationError err = deserializeJson(doc, payload);
      if (!err) {
        String h = doc["host"].as<String>();
        int p    = doc["port"].as<int>();
        if (h.length() > 0 && p > 0) {
          xSemaphoreTake(cfgMutex, portMAX_DELAY);
          mqtt_host_new = h;
          mqtt_port_new = p;
          xSemaphoreGive(cfgMutex);
          Serial.printf("[CFG] OK -> %s:%d\n", h.c_str(), p);
          success = true;
        } else {
          Serial.println("[CFG] JSON inválido");
        }
      } else {
        Serial.println("[CFG] Error parseando JSON");
      }
    } else {
      Serial.printf("[CFG] GET failed: %d\n", code);
    }
    http.end();
  } else {
    Serial.println("[CFG] No se pudo iniciar conexión HTTPS");
  }

  httpsClient.stop();
  xSemaphoreGive(httpMutex);
  return success;
}

// === BOMBA (estado + peticiones; solo taskMqtt cambia la salida) ===
volatile bool pumpOn = false;
volatile int  pumpReq = 0;            // >0: encender N s (manual local o MQTT)
volatile bool pumpStopReq = false;
bool pumpAuto = false;
unsigned long pumpUntil = 0, pumpEnd = 0;

void pumpWrite(bool on) {
  pumpOn = on;
  if (PUMP_PIN >= 0) digitalWrite(PUMP_PIN, (on == PUMP_ACTIVE_HIGH) ? HIGH : LOW);
  Serial.printf("[PUMP] %s\n", on ? "ON" : "OFF");
}

// === CALLBACK MQTT === (comando de riego: {"seconds":30})
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] RX [%s] %.*s\n", topic, (int)length, (const char*)payload);
  if (strstr(topic, "/cmd/pump")) {
    StaticJsonDocument<192> doc;
    if (!deserializeJson(doc, payload, length)) {
      int sec = doc["seconds"] | 0;
      if (sec > 0) pumpReq = sec;
    }
  }
}

// === WIFI ===
// Espera hasta 20 s; si no conecta, el equipo sigue (lecturas, riego, servidor local y red propia de respaldo).
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(MDNS_NAME);
  WiFi.begin(ssid, password);
  Serial.print("[WIFI] Conectando");
  for (int i = 0; i < 80 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  if (WiFi.status() == WL_CONNECTED) Serial.println("\n[WIFI] OK | IP: " + WiFi.localIP().toString());
  else Serial.println("\n[WIFI] sin conexión por ahora; se sigue en modo local");
}

// === COLA DE LECTURAS (RAM) ===
// Si MQTT no está conectado (cambio de puerto, caída del túnel, WiFi) las lecturas se guardan aquí con su
// hora (NTP) y se envían al reconectar. El backend acepta hasta 24 h de atraso (device_backdate_max_s); más allá se desborda a flash.
const int QN = 120;               // 120 lecturas x 10 s = 20 min
const int QLEN = 230;             // bytes por lectura (el JSON mide ~190)
char qbuf[QN][QLEN];
int qHead = 0, qCount = 0;
SemaphoreHandle_t qMutex;
volatile bool mqttUp = false;     // lo escribe solo taskMqtt; taskMonitor lo lee

// Desborde a flash: cuando la RAM se llena, la lectura más vieja pasa a /spill.log (aguanta cortes largos).
// Orden de envío al reconectar: primero spill.log (lo más viejo), luego la RAM. Tope ~400 KB (~2000 lecturas).
const char* SPILL = "/spill.log";
const size_t SPILL_MAX = 400 * 1024;
size_t spillOff = 0;
volatile bool spillPending = false;
volatile bool fsOk = false;

bool spillAppend(const char* line) {
  if (!fsOk) return false;
  File f = LittleFS.open(SPILL, "a");
  if (!f) return false;
  if (f.size() > SPILL_MAX) { f.close(); return false; }
  f.print(line); f.print('\n');
  f.close();
  spillPending = true;
  return true;
}

void qPush(const char* s) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (qCount == QN) {                                        // RAM llena: la más vieja va a flash (o se pierde si no hay sitio)
    spillAppend(qbuf[qHead]);
    qHead = (qHead + 1) % QN; qCount--;
  }
  int idx = (qHead + qCount) % QN;
  qCount++;
  strlcpy(qbuf[idx], s, QLEN);
  xSemaphoreGive(qMutex);
}

// Envía la lectura más vieja; solo la quita si el envío funcionó.
bool qFlushOne() {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  bool ok = false;
  if (spillPending) {
    File f = LittleFS.open(SPILL, "r");
    String line;
    if (f) { f.seek(spillOff); line = f.readStringUntil('\n'); line.trim(); }
    size_t pos = f ? f.position() : 0;
    bool atEnd = f ? (pos >= f.size()) : true;
    if (f) f.close();
    if (line.length() == 0) {                                // archivo agotado (o vacío)
      if (atEnd) { LittleFS.remove(SPILL); spillOff = 0; spillPending = false; }
      xSemaphoreGive(qMutex);
      return false;
    }
    ok = client.publish(topic_telemetry, line.c_str());
    if (ok) {
      spillOff = pos;
      if (atEnd) { LittleFS.remove(SPILL); spillOff = 0; spillPending = false; }
    }
    xSemaphoreGive(qMutex);
    return ok;
  }
  if (qCount == 0) { xSemaphoreGive(qMutex); return false; }
  ok = client.publish(topic_telemetry, qbuf[qHead]);
  if (ok) { qHead = (qHead + 1) % QN; qCount--; }
  xSemaphoreGive(qMutex);
  return ok;
}

bool pendingData() { return qCount > 0 || spillPending; }

// Lee hasta n lecturas pendientes sin quitarlas (primero flash, que es lo más viejo; luego RAM).
// Se confirman con qAck() solo si el envío funcionó. Solo taskMqtt escribe la cola, así que no cambia entre peek y ack.
int qPeek(String* out, int n, int* fromSpill, size_t* spillEnd) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  int cnt = 0; *fromSpill = 0; *spillEnd = spillOff;
  bool spillDone = true;
  if (spillPending) {
    File f = LittleFS.open(SPILL, "r");
    if (f) {
      f.seek(spillOff);
      while (cnt < n && f.available()) {
        String l = f.readStringUntil('\n'); l.trim();
        *spillEnd = f.position();
        if (l.length()) { out[cnt++] = l; (*fromSpill)++; }
      }
      spillDone = !f.available();
      f.close();
    }
    if (spillDone && *fromSpill == 0) { LittleFS.remove(SPILL); spillOff = 0; spillPending = false; *spillEnd = 0; }
  }
  if (!spillPending || (spillDone && *fromSpill > 0)) {
    for (int i = 0; i < qCount && cnt < n; i++) out[cnt++] = String(qbuf[(qHead + i) % QN]);
  }
  xSemaphoreGive(qMutex);
  return cnt;
}

void qAck(int total, int fromSpill, size_t spillEnd) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (fromSpill > 0) {
    spillOff = spillEnd;
    File f = LittleFS.open(SPILL, "r");
    size_t sz = f ? f.size() : 0;
    if (f) f.close();
    if (spillOff >= sz) { LittleFS.remove(SPILL); spillOff = 0; spillPending = false; }
  }
  int ring = total - fromSpill;
  qHead = (qHead + ring) % QN; qCount -= ring;
  xSemaphoreGive(qMutex);
}

// Envía un lote a Supabase (REST). Devuelve true si el servidor lo aceptó.
bool sbSend(const String* lines, int n) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (xSemaphoreTake(httpMutex, pdMS_TO_TICKS(3000)) != pdTRUE) return false;   // un solo TLS a la vez (memoria)
  WiFiClientSecure sc;
  sc.setInsecure();                                                              // solo pruebas: en producción fija el certificado
  HTTPClient h;
  h.setTimeout(6000);
  bool ok = false;
  if (h.begin(sc, String(SUPABASE_URL) + "/rest/v1/simon_inbox")) {
    h.addHeader("apikey", SUPABASE_ANON_KEY);
    h.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    h.addHeader("Content-Type", "application/json");
    h.addHeader("Prefer", "return=minimal");
    String body = "[";
    for (int i = 0; i < n; i++) {
      if (i) body += ",";
      body += "{\"device_id\":\"" + String(device_id) + "\",\"device_key\":\"" + INGEST_KEY + "\",\"payload\":" + lines[i] + "}";
    }
    body += "]";
    int code = h.POST(body);
    ok = (code == 200 || code == 201 || code == 204);
    if (!ok) Serial.printf("[SB] HTTP %d\n", code);
    h.end();
  }
  sc.stop();
  xSemaphoreGive(httpMutex);
  return ok;
}

// === HISTORIAL LOCAL (RAM) para la página del propio ESP32 y /api/history ===
struct Reading {
  uint32_t ts, up, lux;
  float vwc_pct, soil_t, ph, ec, n, p, k, air_t, air_rh;
  uint16_t vwc_raw;
  bool pump_on;
};
const int HN = 360;                 // 1 h a 10 s
Reading hist[HN];
int hHead = 0, hCount = 0;
SemaphoreHandle_t hMutex;

void histPush(const Reading& r) {
  xSemaphoreTake(hMutex, portMAX_DELAY);
  hist[(hHead + hCount) % HN] = r;
  if (hCount < HN) hCount++; else hHead = (hHead + 1) % HN;
  xSemaphoreGive(hMutex);
}

// local=false -> el formato exacto que espera el backend; local=true agrega vwc_pct y uptime
String readingJson(const Reading& r, bool local) {
  String s = "{\"v\":1";
  if (r.ts > 0) s += ",\"ts\":" + String(r.ts);
  s += ",\"vwc_raw\":" + String(r.vwc_raw);
  s += ",\"soil_t\":" + String(r.soil_t, 2);
  s += ",\"ph\":" + String(r.ph, 2);
  s += ",\"ec\":" + String(r.ec, 1);
  s += ",\"n\":" + String(r.n, 1);
  s += ",\"p\":" + String(r.p, 1);
  s += ",\"k\":" + String(r.k, 1);
  s += ",\"air_t\":" + String(r.air_t, 2);
  s += ",\"air_rh\":" + String(r.air_rh, 2);
  s += ",\"lux\":" + String(r.lux);
  s += ",\"tank_ok\":true";
  s += String(",\"pump_on\":") + (r.pump_on ? "true" : "false");
  s += ",\"pump_ma\":" + String(r.pump_on ? 180.0 : 0.0, 1);
  if (local) s += ",\"vwc_pct\":" + String(r.vwc_pct, 1) + ",\"up\":" + String(r.up);
  s += "}";
  return s;
}

// Hora UNIX (0 si el NTP todavía no sincronizó)
uint32_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1700000000 ? (uint32_t)t : 0;
}

// Anuncia la dirección local (retenido). El backend la guarda y la app la usa si cae la nube.
String lastInfoIp = "";
void publishInfo() {
  if (WiFi.status() != WL_CONNECTED) return;
  String ip = WiFi.localIP().toString();
  String j = "{\"ip\":\"" + ip + "\",\"host\":\"" + MDNS_NAME + ".local\",\"fw\":\"" FW_VERSION "\"}";
  if (client.publish("simon/esp32-01/info", j.c_str(), true)) lastInfoIp = ip;
}

// === TAREA 1: MONITOR (CORE 0) ===
// Consulta la dirección del broker sin saturar la red y solo cambia si el valor nuevo se repite
// (así una respuesta rara del servidor no provoca un cambio de puerto falso).
void taskMonitor(void *pvParameters) {
  const int CONFIRMS = 2;                    // consultas seguidas con el mismo valor nuevo
  String candHost = "";
  int candPort = 0, candCount = 0;
  TickType_t lastCheck = 0;

  vTaskDelay(pdMS_TO_TICKS(2000));
  fetchConfig();
  lastCheck = xTaskGetTickCount();
  candCount = CONFIRMS;                      // la primera lectura vale sola (arranque)

  for (;;) {
    // Conectado: cada 30 s. Sin conexión MQTT: cada 8 s (puede que el puerto ya haya cambiado).
    TickType_t interval = pdMS_TO_TICKS(mqttUp ? 30000 : 8000);
    bool first = (candCount == CONFIRMS && mqtt_host_cur.length() == 0);
    if (first || (xTaskGetTickCount() - lastCheck) >= interval) {
      bool fetched = first ? true : fetchConfig();
      lastCheck = xTaskGetTickCount();

      if (fetched && WiFi.status() == WL_CONNECTED) {
        xSemaphoreTake(cfgMutex, portMAX_DELAY);
        String h = mqtt_host_new;
        int p = mqtt_port_new;
        bool differs = (h.length() > 0 && p > 0) && (h != mqtt_host_cur || p != mqtt_port_cur);
        xSemaphoreGive(cfgMutex);

        if (!differs) {
          candCount = 0;
        } else {
          if (h == candHost && p == candPort) candCount++;
          else { candHost = h; candPort = p; candCount = 1; }

          bool initial = (mqtt_host_cur.length() == 0);
          if (initial || candCount >= CONFIRMS) {
            Serial.printf("[MON] Cambio confirmado -> %s:%d (actual: %s:%d)\n",
                          h.c_str(), p, mqtt_host_cur.c_str(), mqtt_port_cur);
            switchRequested = true;      // taskMqtt aplica la dirección (PubSubClient no es seguro entre tareas)
            candCount = 0;
          } else {
            Serial.printf("[MON] Valor nuevo %s:%d, esperando confirmación (%d/%d)\n",
                          h.c_str(), p, candCount, CONFIRMS);
          }
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// === TAREA 2: MQTT + TELEMETRÍA (CORE 1) ===
void taskMqtt(void *pvParameters) {
  unsigned long lastPub = 0, lastFlush = 0, lastInfoCheck = 0, lastSb = 0, mqttDownSince = 0;
  const unsigned long pubInterval = 10000;

  client.setCallback(mqttCallback);
  client.setKeepAlive(15);       // detecta una conexión muerta en ~20 s (antes ~37 s)

  for (;;) {
    if (switchRequested) {
      if (client.connected()) {
        Serial.println("[MQTT] Cambio de puerto -> desconectando (las lecturas se guardan en cola)");
        client.disconnect();
      }
      mqttUp = false;

      xSemaphoreTake(cfgMutex, portMAX_DELAY);
      if (mqtt_host_new.length() > 0 && mqtt_port_new > 0) {
        mqtt_host_cur = mqtt_host_new;
        mqtt_port_cur = mqtt_port_new;
        client.setServer(mqtt_host_cur.c_str(), mqtt_port_cur);
        Serial.printf("[MQTT] Actualizado a -> %s:%d\n", mqtt_host_cur.c_str(), mqtt_port_cur);
      }
      xSemaphoreGive(cfgMutex);

      switchRequested = false;
    }

    if (!client.connected()) {
      mqttUp = false;
      if (mqtt_host_cur.length() == 0 || mqtt_port_cur == 0) {
        vTaskDelay(pdMS_TO_TICKS(500));
      } else {
        String cid = String(device_id) + "-" + String((uint32_t)esp_random(), HEX);
        const char* willT = topic_status;
        const char* willM = "offline";   // el backend espera "online"/"offline" en texto plano

        Serial.printf("[MQTT] Conectando a %s:%d ...\n", mqtt_host_cur.c_str(), mqtt_port_cur);
        if (client.connect(cid.c_str(), mqtt_user, mqtt_password, willT, 1, true, willM)) {
          Serial.printf("[MQTT] CONECTADO (cola: %d lecturas)\n", qCount);
          client.subscribe(topic_cmd);
          client.publish(topic_status, "online", true);
          publishInfo();
          mqttUp = true;
        } else {
          Serial.printf("[MQTT] Fallo rc=%d | reintento en 1 s\n", client.state());
          vTaskDelay(pdMS_TO_TICKS(1000));
        }
      }
    }

    if (client.connected()) client.loop();

    // Lectura nueva cada 10 s: SIEMPRE entra a la cola (así se conserva el orden) y se vacía si hay conexión
    if (millis() - lastPub >= pubInterval) {
      lastPub = millis();

      // --- Sensores (simulados; aquí van las lecturas reales) ---
      Reading r;
      r.ts = nowEpoch();
      r.up = millis() / 1000;
      r.air_t  = random(235, 275) / 10.0;
      r.air_rh = random(500, 750) / 10.0;
      r.soil_t = random(195, 230) / 10.0;
      r.vwc_raw = random(2150, 2450);
      r.ph = random(62, 68) / 10.0;
      r.ec = random(550, 650);
      r.n  = random(70, 90);
      r.p  = random(28, 38);
      r.k  = random(170, 195);
      r.lux = random(25000, 60000);
      float pct = 100.0 * (RAW_DRY - (int)r.vwc_raw) / (float)(RAW_DRY - RAW_WET);
      r.vwc_pct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);

      // --- Riego autónomo ---
      if (AUTO_IRRIGATION && !pumpOn && r.vwc_pct < PUMP_ON_BELOW &&
          (pumpEnd == 0 || millis() - pumpEnd >= PUMP_COOLDOWN_MS)) {
        pumpAuto = true; pumpUntil = millis() + PUMP_AUTO_S * 1000UL; pumpWrite(true);
        Serial.printf("[PUMP] riego automático (humedad %.1f%%)\n", r.vwc_pct);
      } else if (pumpOn && pumpAuto && r.vwc_pct >= PUMP_OFF_ABOVE) {
        pumpWrite(false); pumpEnd = millis();
      }
      r.pump_on = pumpOn;

      histPush(r);
      qPush(readingJson(r, false).c_str());
      Serial.printf("[TX] en cola (%d%s)%s\n", qCount, spillPending ? "+flash" : "", client.connected() ? "" : " - sin conexión");
    }

    // Respaldo: si MQTT lleva > SB_AFTER_MS caído pero hay WiFi, las lecturas pendientes van directo a Supabase
    if (client.connected()) mqttDownSince = 0; else if (!mqttDownSince) mqttDownSince = millis();
    if (SUPABASE_URL[0] && !client.connected() && mqttDownSince && millis() - mqttDownSince > SB_AFTER_MS &&
        pendingData() && millis() - lastSb >= SB_EVERY_MS) {
      lastSb = millis();
      String batch[SB_BATCH]; int fs = 0; size_t se = 0;
      int n = qPeek(batch, SB_BATCH, &fs, &se);
      if (n > 0 && sbSend(batch, n)) { qAck(n, fs, se); Serial.printf("[SB] %d lecturas enviadas a Supabase (quedan %d)\n", n, qCount); }
    }

    // Peticiones de bomba (web local o MQTT) y fin de temporizador
    if (pumpStopReq) { pumpStopReq = false; pumpReq = 0; if (pumpOn) { pumpWrite(false); pumpEnd = millis(); } }
    if (pumpReq > 0) {
      int sec = pumpReq > PUMP_MAX_S ? PUMP_MAX_S : pumpReq; pumpReq = 0;
      pumpAuto = false; pumpUntil = millis() + sec * 1000UL; pumpWrite(true);
    }
    if (pumpOn && (long)(millis() - pumpUntil) >= 0) { pumpWrite(false); pumpEnd = millis(); }

    // Si la IP cambió (otro router, DHCP), se vuelve a anunciar
    if (client.connected() && millis() - lastInfoCheck >= 5000) {
      lastInfoCheck = millis();
      if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != lastInfoIp) publishInfo();
    }

    // Vacía la cola poco a poco (1 cada 150 ms) para no saturar el broker ni el WiFi
    if (client.connected() && pendingData() && millis() - lastFlush >= 150) {
      lastFlush = millis();
      if (qFlushOne()) {
        if (!pendingData()) Serial.println("[TX] cola vacía, todo enviado");
      } else {
        Serial.println("[TX] publish falló; se reintenta (la lectura sigue en cola)");
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// === SERVIDOR LOCAL (http://<ip> o http://simon-esp32-01.local) ===
static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simón · modo local</title>
<style>
body{font:15px system-ui,sans-serif;margin:0;background:#f3f1ec;color:#1b2a21}
header{background:#1f5c38;color:#fff;padding:12px 16px}
h1{font-size:18px;margin:0}main{padding:12px 16px;max-width:560px;margin:auto}
.chip{display:inline-block;padding:2px 8px;border-radius:10px;background:#ddd;margin:2px 4px 2px 0;font-size:12px}
.ok{background:#c9ecd3}.bad{background:#f6c9c4}
#cloud{display:none;background:#fff3c4;border:1px solid #e0c35a;padding:10px;border-radius:8px;margin:10px 0}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.c{background:#fff;border-radius:10px;padding:8px 10px}.c b{display:block;font-size:20px}
canvas{width:100%;height:90px;background:#fff;border-radius:10px}
button{font:inherit;padding:8px 12px;border:0;border-radius:8px;background:#1f5c38;color:#fff;margin:4px 4px 0 0}
</style></head><body>
<header><h1>Simón · esp32-01 · modo local</h1></header><main>
<div id="chips"></div>
<div id="cloud"></div>
<div class="g" id="g"></div>
<div>Humedad (última hora)</div><canvas id="cv" width="520" height="90"></canvas>
<div><button onclick="pump(15)">Regar 15 s</button><button onclick="pump(0)">Parar bomba</button></div>
<p style="font-size:12px;color:#667">Datos directos del ESP32. Al volver la nube, las lecturas guardadas se envían solas.</p>
</main>
<script>
const CLOUD="%CLOUD%";let okN=0;
const L=[["vwc_pct","Humedad","%"],["soil_t","T suelo","°C"],["air_t","T aire","°C"],["air_rh","HR aire","%"],["ph","pH",""],["ec","EC","µS"],["lux","Luz","lx"],["pump_on","Bomba",""]];
function chip(t,ok){return '<span class="chip '+(ok?'ok':'bad')+'">'+t+'</span>'}
async function st(){try{const s=await (await fetch('/api/state',{cache:'no-store'})).json();const r=s.reading||{};
document.getElementById('chips').innerHTML=chip('Local OK',1)+chip(s.mqtt?'Nube conectada':'Sin nube',s.mqtt)+chip('Pendientes: '+s.pending,s.pending==0)+chip('WiFi '+s.rssi+' dBm',s.rssi>-80)+(s.ap?chip('Red propia activa',0):'');
document.getElementById('g').innerHTML=L.map(x=>'<div class="c">'+x[1]+'<b>'+(x[0]=='pump_on'?(r[x[0]]?'ON':'OFF'):(r[x[0]]==null?'–':r[x[0]]))+(x[0]=='pump_on'?'':' '+x[2])+'</b></div>').join('')}catch(e){document.getElementById('chips').innerHTML=chip('Sin respuesta del ESP32',0)}}
async function hist(){try{const h=await (await fetch('/api/history?n=360',{cache:'no-store'})).json();const c=document.getElementById('cv'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);if(h.length<2)return;
const v=h.map(r=>r.vwc_pct),mn=Math.min(...v,0),mx=Math.max(...v,60);x.strokeStyle='#1f5c38';x.lineWidth=2;x.beginPath();v.forEach((y,i)=>{const px=i/(v.length-1)*c.width,py=c.height-(y-mn)/(mx-mn)*(c.height-8)-4;i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}catch(e){}}
async function pump(s){await fetch('/api/pump?s='+s,{method:'POST'});st()}
async function cloud(){const b=document.getElementById('cloud');try{const ac=new AbortController();setTimeout(()=>ac.abort(),4000);const r=await fetch(CLOUD+'/health',{cache:'no-store',signal:ac.signal});if(!r.ok)throw 0;okN++}catch(e){okN=0}
if(okN>=3){b.style.display='block';b.innerHTML='La nube volvió. <a href="'+CLOUD+'/">Volver a la nube</a>';if(location.hash.indexOf('auto')>=0)location.href=CLOUD+'/'}else b.style.display='none'}
st();hist();cloud();setInterval(st,3000);setInterval(hist,15000);setInterval(cloud,10000);
</script></body></html>
)HTML";

bool apOn = false, mdnsOk = false;

void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");   // páginas públicas (https) hacia una IP local
  server.sendHeader("Cache-Control", "no-store");
}

bool lastReading(Reading& r) {
  xSemaphoreTake(hMutex, portMAX_DELAY);
  bool has = hCount > 0;
  if (has) r = hist[(hHead + hCount - 1) % HN];
  xSemaphoreGive(hMutex);
  return has;
}

void handleState() {
  Reading r; bool has = lastReading(r);
  String s = "{\"device_id\":\"" + String(device_id) + "\",\"fw\":\"" FW_VERSION "\"";
  s += ",\"ts\":" + String(nowEpoch()) + ",\"uptime_s\":" + String(millis() / 1000);
  s += ",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127);
  s += String(",\"mqtt\":") + (mqttUp ? "true" : "false");
  s += String(",\"ap\":") + (apOn ? "true" : "false");
  s += ",\"pending\":" + String(qCount) + String(",\"pending_flash\":") + (spillPending ? "true" : "false");
  s += String(",\"pump_on\":") + (pumpOn ? "true" : "false");
  s += ",\"reading\":" + (has ? readingJson(r, true) : String("null")) + "}";
  cors(); server.send(200, "application/json", s);
}

void handleHistory() {
  int n = server.hasArg("n") ? server.arg("n").toInt() : 120;
  if (n < 1) n = 1;
  if (n > HN) n = HN;
  cors();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  server.sendContent("[");
  xSemaphoreTake(hMutex, portMAX_DELAY);
  int cnt = hCount < n ? hCount : n;
  Reading copy[1];
  for (int i = hCount - cnt; i < hCount; i++) {
    copy[0] = hist[(hHead + i) % HN];
    xSemaphoreGive(hMutex);                       // no se retiene el mutex mientras se escribe a la red
    server.sendContent((i > hCount - cnt ? "," : "") + readingJson(copy[0], true));
    xSemaphoreTake(hMutex, portMAX_DELAY);
  }
  xSemaphoreGive(hMutex);
  server.sendContent("]");
  server.sendContent("");
}

void handlePump() {
  int sec = server.hasArg("s") ? server.arg("s").toInt() : 0;
  if (sec > 0) pumpReq = sec; else pumpStopReq = true;
  cors(); server.send(202, "application/json", String("{\"ok\":true,\"seconds\":") + sec + "}");
}

void startWeb() {
  server.on("/", HTTP_GET, []() {
    String p = FPSTR(PAGE); p.replace("%CLOUD%", CLOUD_BASE);
    cors(); server.send(200, "text/html; charset=utf-8", p);
  });
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/pump", HTTP_POST, handlePump);
  server.on("/api/pump", HTTP_GET, handlePump);
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) { cors(); server.send(204); }          // preflight CORS
    else { cors(); server.send(404, "text/plain", "no encontrado"); }
  });
  server.begin();
}

// Red propia de respaldo cuando el WiFi lleva > 30 s caído; se apaga tras 60 s de WiFi estable.
void netTick() {
  static unsigned long downSince = 0, upSince = 0, last = 0;
  if (millis() - last < 1000) return;
  last = millis();
  bool sta = WiFi.status() == WL_CONNECTED;
  if (sta) {
    downSince = 0;
    if (!upSince) upSince = millis();
    if (!mdnsOk && MDNS.begin(MDNS_NAME)) { MDNS.addService("http", "tcp", 80); mdnsOk = true; }
    if (apOn && millis() - upSince > 60000) {
      WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA); apOn = false;
      Serial.println("[AP] apagada (WiFi estable)");
    }
  } else {
    upSince = 0; mdnsOk = false;
    if (!downSince) downSince = millis();
    if (!apOn && millis() - downSince > 30000) {
      WiFi.mode(WIFI_AP_STA); WiFi.softAP(AP_SSID, AP_PASS); apOn = true;
      Serial.printf("[AP] red propia '%s' -> http://%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  cfgMutex  = xSemaphoreCreateMutex();
  httpMutex = xSemaphoreCreateMutex();
  qMutex    = xSemaphoreCreateMutex();
  hMutex    = xSemaphoreCreateMutex();

  if (PUMP_PIN >= 0) { pinMode(PUMP_PIN, OUTPUT); digitalWrite(PUMP_PIN, PUMP_ACTIVE_HIGH ? LOW : HIGH); }   // bomba apagada al arrancar
  fsOk = LittleFS.begin(true);
  spillPending = fsOk && LittleFS.exists(SPILL);   // quedaron lecturas en flash de antes del reinicio
  Serial.printf("[FS] %s%s\n", fsOk ? "LittleFS OK" : "LittleFS FALLÓ (sin respaldo en flash)", spillPending ? " | hay lecturas pendientes" : "");

  setupWifi();
  WiFi.setAutoReconnect(true);
  configTime(-5 * 3600, 0, "pool.ntp.org", "time.google.com");   // hora real (Colombia UTC-5) para las lecturas
  startWeb();
  client.setBufferSize(1024);   // el #define MQTT_MAX_PACKET_SIZE después del include no tiene efecto

  xTaskCreatePinnedToCore(taskMonitor, "MONITOR", 8192, NULL, 1, &hMonitor, 0);
  xTaskCreatePinnedToCore(taskMqtt,    "MQTT",    8192, NULL, 2, &hMqtt,    1);

  Serial.println("[SYS] Dual-core activo | servidor local en :80 | MQTT en claro");
}

void loop() {
  server.handleClient();
  netTick();
  vTaskDelay(pdMS_TO_TICKS(3));
}