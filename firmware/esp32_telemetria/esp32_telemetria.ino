#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>

// Hardware confirmado: DHT11, humedad de suelo capacitiva, DS18B20 enterrado, 4 LDR, ultrasonido HC-SR04,
// mini bomba, luz externa (relés), servo y pantalla OLED 0,91" (SSD1306 128x32 por I2C).
// Comenta una línea si NO usas esa pieza (así no necesitas instalar su librería). Si el backend configura algo
// cuyo driver no está compilado, el ESP32 lo omite y avisa por el monitor serie.
#define USE_DHT        // librería «DHT sensor library» (Adafruit) + «Adafruit Unified Sensor»
#define USE_DS18B20    // librerías «OneWire» y «DallasTemperature»
#define USE_SERVO      // librería «ESP32Servo»
#define USE_OLED       // librería «U8g2» (olikraus)
#include <Wire.h>
#ifdef USE_DHT
#include <DHT.h>
#endif
#ifdef USE_DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>
#endif
#ifdef USE_SERVO
#include <ESP32Servo.h>
#endif
#ifdef USE_OLED
#include <U8g2lib.h>
#endif

#define FW_VERSION "2.1"

// === CONFIGURACIÓN WIFI ===
const char* ssid     = "vivo Y33s";
const char* password = "12345678";

// === CONFIGURACIÓN DISPOSITIVO ===
const char* device_id       = "esp32-01";
const char* mqtt_user       = "esp32-01";                 // = device_id (lo exige el ACL del broker)
const char* mqtt_password   = "Qgr_KMAM7VWyG3Q7PBvl3MuU"; // = MQTT_ESP32_PASSWORD del broker (solo pruebas)
const char* topic_telemetry = "simon/esp32-01/telemetry";
const char* topic_cmd       = "simon/esp32-01/cmd/#";   // cmd/<actuador> con {"seconds":N}
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

// >>> LOGIC (sensores, actuadores y configuración dinámica; se prueba en C++ de escritorio)
// === CONFIGURACIÓN DINÁMICA ===
// La lista de sensores/actuadores NO está en el sketch: se descarga de GET /devices/esp32-01/config, se guarda en
// flash (/config.json) y se aplica sin reiniciar. Lo que no tenga driver compilado (DHT, DS18B20) se omite con aviso.
const int MAXS = 24, MAXA = 8, HN = 240;
const int PAYLOAD_MAX = 360;                  // bytes del JSON de telemetría (cabe en una posición de la cola)
enum Drv : uint8_t { D_ANALOG, D_DHT_T, D_DHT_H, D_DS18B20, D_HCSR04, D_SIM };
enum ActDrv : uint8_t { A_RELAY, A_SERVO };

struct SensorCfg { char key[33]; char label[41]; char unit[13]; uint8_t drv; int16_t pin; int16_t param; float scale, offset, simMin, simMax; };
struct ActCfg {
  char key[33]; char label[41]; uint8_t drv; bool activeHigh; int16_t pin; int16_t angOn, angOff; uint16_t maxS; char autoVar[33];
  bool hasBelow, hasAbove, hasOff; float onBelow, onAbove, offAt; uint16_t autoS; uint32_t cooldownS;
};
struct ActState { bool on; bool autoRun; bool hold; unsigned long until; unsigned long endedAt; };   // hold: el servo se queda en su posición hasta que lo cierren

SensorCfg sens[MAXS]; int nSens = 0;
ActCfg acts[MAXA]; ActState actSt[MAXA]; int nActs = 0;
volatile int  actReq[MAXA];
volatile bool actStopReq[MAXA];
int cfgVersion = 0;
unsigned long reportMs = 10000;
float curVal[MAXS];
SemaphoreHandle_t cfgLock;

// Pantalla OLED: qué variables rota y cada cuánto (viene del backend dentro de la configuración).
struct DispCfg { bool enabled; uint8_t addr; uint8_t rotateS; uint8_t nShow; char show[8][33]; };
DispCfg disp = { false, 0x3C, 4, 0, {} };
#ifdef USE_SERVO
Servo servos[MAXA];
#endif

// Configuración de fábrica (si no hay una guardada ni red para descargarla): el hardware confirmado, con los pines del montaje.
const char DEFAULT_CFG[] PROGMEM = R"CFG({"version":0,"report_interval_s":10,"sensors":[
{"key":"air_t","label":"Temp. aire","unit":"C","driver":"dht_t","pin":4,"param":11},
{"key":"air_rh","label":"Humedad aire","unit":"%","driver":"dht_h","pin":4,"param":11},
{"key":"vwc_raw","label":"Humedad suelo","driver":"analog","pin":36},
{"key":"soil_t","label":"Temp. suelo","unit":"C","driver":"ds18b20","pin":18},
{"key":"ldr_nw","label":"Luz NO","unit":"%","driver":"analog","pin":32,"scale":0.02442},
{"key":"ldr_ne","label":"Luz NE","unit":"%","driver":"analog","pin":33,"scale":0.02442},
{"key":"ldr_sw","label":"Luz SO","unit":"%","driver":"analog","pin":34,"scale":0.02442},
{"key":"ldr_se","label":"Luz SE","unit":"%","driver":"analog","pin":35,"scale":0.02442},
{"key":"tank_cm","label":"Dist. agua","unit":"cm","driver":"hcsr04","pin":23,"param":19}],
"actuators":[
{"key":"pump","label":"Mini bomba","driver":"relay","pin":26,"max_seconds":120},
{"key":"light","label":"Luz externa","driver":"relay","pin":27,"max_seconds":3600},
{"key":"servo","label":"Luz indirecta","driver":"servo","pin":13,"angle_on":90,"angle_off":0,"max_seconds":30}],
"display":{"enabled":true,"address":60,"rotate_s":4,"show":["air_t","air_rh","vwc_raw","soil_t","tank_cm","pump"]}})CFG";

int drvFromName(const char* n) {
  if (!strcmp(n, "analog")) return D_ANALOG;
  if (!strcmp(n, "dht_t")) return D_DHT_T;
  if (!strcmp(n, "dht_h")) return D_DHT_H;
  if (!strcmp(n, "ds18b20")) return D_DS18B20;
  if (!strcmp(n, "hcsr04")) return D_HCSR04;
  if (!strcmp(n, "simulated")) return D_SIM;
  return -1;
}

void actWrite(int i, bool on) {
  actSt[i].on = on;
#ifdef USE_SERVO
  if (acts[i].drv == A_SERVO) { if (servos[i].attached()) servos[i].write(on ? acts[i].angOn : acts[i].angOff); }
  else
#endif
  if (acts[i].pin >= 0) digitalWrite(acts[i].pin, (on == acts[i].activeHigh) ? HIGH : LOW);
  Serial.printf("[ACT] %s %s\n", acts[i].key, on ? "ON" : "OFF");
}

int findAct(const char* key) { for (int i = 0; i < nActs; i++) if (!strcmp(acts[i].key, key)) return i; return -1; }
float varValue(const char* key) { for (int i = 0; i < nSens; i++) if (!strcmp(sens[i].key, key)) return curVal[i]; return NAN; }

// Resultado: 0 = JSON inválido, 1 = sin cambios, 2 = aplicada
int applyConfig(const String& json) {
  static SensorCfg ns[MAXS];
  static ActCfg na[MAXA];
  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, json.c_str())) { Serial.println("[CFG] JSON de configuración inválido"); return 0; }
  if (doc["unchanged"] | false) return 1;
  JsonArray js = doc["sensors"].as<JsonArray>(), ja = doc["actuators"].as<JsonArray>();
  if (js.isNull() || ja.isNull()) { Serial.println("[CFG] faltan sensors/actuators"); return 0; }

  int cs = 0, ca = 0;
  for (JsonObject s : js) {
    if (cs >= MAXS) break;
    int d = drvFromName(s["driver"] | "");
    if (d < 0) { Serial.printf("[CFG] driver desconocido en %s\n", (const char*)(s["key"] | "?")); continue; }
#ifndef USE_DHT
    if (d == D_DHT_T || d == D_DHT_H) { Serial.printf("[CFG] %s necesita USE_DHT: omitido\n", (const char*)(s["key"] | "?")); continue; }
#endif
#ifndef USE_DS18B20
    if (d == D_DS18B20) { Serial.printf("[CFG] %s necesita USE_DS18B20: omitido\n", (const char*)(s["key"] | "?")); continue; }
#endif
    SensorCfg& c = ns[cs++];
    memset(&c, 0, sizeof(c));
    strlcpy(c.key, s["key"] | "", sizeof(c.key));
    strlcpy(c.label, s["label"] | "", sizeof(c.label));
    strlcpy(c.unit, s["unit"] | "", sizeof(c.unit));
    c.drv = d; c.pin = s["pin"] | -1; c.param = s["param"] | 0;
    c.scale = s["scale"] | 1.0f; c.offset = s["offset"] | 0.0f;
    c.simMin = s["sim_min"] | 0.0f; c.simMax = s["sim_max"] | 1.0f;
    if (!c.key[0]) cs--;
  }
  for (JsonObject a : ja) {
    if (ca >= MAXA) break;
    ActCfg& c = na[ca++];
    memset(&c, 0, sizeof(c));
    strlcpy(c.key, a["key"] | "", sizeof(c.key));
    strlcpy(c.label, a["label"] | "", sizeof(c.label));
    c.pin = a["pin"] | -1; c.activeHigh = a["active_high"] | true; c.maxS = a["max_seconds"] | 120;
    c.drv = !strcmp(a["driver"] | "relay", "servo") ? A_SERVO : A_RELAY;
    c.angOn = a["angle_on"] | 90; c.angOff = a["angle_off"] | 0;
    c.angOn = constrain(c.angOn, 0, 180);
    c.angOff = constrain(c.angOff, 0, 180);
#ifndef USE_SERVO
    if (c.drv == A_SERVO) { Serial.printf("[CFG] %s necesita USE_SERVO: omitido\n", c.key); c.key[0] = 0; }
#endif
    strlcpy(c.autoVar, a["auto_variable"] | "", sizeof(c.autoVar));
    c.hasBelow = !a["auto_on_below"].isNull(); c.hasAbove = !a["auto_on_above"].isNull(); c.hasOff = !a["auto_off_at"].isNull();
    c.onBelow = a["auto_on_below"] | 0.0f; c.onAbove = a["auto_on_above"] | 0.0f; c.offAt = a["auto_off_at"] | 0.0f;
    c.autoS = a["auto_seconds"] | 30; c.cooldownS = a["cooldown_s"] | 600;
    if (!c.key[0]) ca--;
  }

  DispCfg nd; memset(&nd, 0, sizeof(nd)); nd.addr = 0x3C; nd.rotateS = 4;
  JsonObject jd = doc["display"].as<JsonObject>();
  if (!jd.isNull()) {
    nd.enabled = jd["enabled"] | false;
    nd.addr = jd["address"] | 60;
    int rs = jd["rotate_s"] | 4; nd.rotateS = rs < 2 ? 2 : (rs > 60 ? 60 : rs);
    for (JsonVariant k : jd["show"].as<JsonArray>()) {
      const char* ks = k.as<const char*>();
      if (ks && nd.nShow < 8) strlcpy(nd.show[nd.nShow++], ks, sizeof(nd.show[0]));
    }
  }

  xSemaphoreTake(cfgLock, portMAX_DELAY);
  // actuadores que desaparecen o cambian de pin: se apagan
  for (int i = 0; i < nActs; i++) {
    int j = -1;
    for (int k = 0; k < ca; k++) if (!strcmp(na[k].key, acts[i].key)) j = k;
    if (acts[i].pin >= 0 && actSt[i].on && (j < 0 || na[j].pin != acts[i].pin)) actWrite(i, false);
  }
  ActState oldSt[MAXA]; ActCfg oldA[MAXA]; int oldN = nActs;
  memcpy(oldSt, actSt, sizeof(actSt)); memcpy(oldA, acts, sizeof(acts));
  memcpy(sens, ns, sizeof(SensorCfg) * cs); nSens = cs;
  memcpy(acts, na, sizeof(ActCfg) * ca); nActs = ca;
  for (int i = 0; i < nActs; i++) {
    memset(&actSt[i], 0, sizeof(ActState)); actReq[i] = 0; actStopReq[i] = false;
    for (int k = 0; k < oldN; k++) if (!strcmp(oldA[k].key, acts[i].key) && oldA[k].pin == acts[i].pin) actSt[i] = oldSt[k];   // conserva el estado
    if (acts[i].drv == A_SERVO) {
#ifdef USE_SERVO
      if (servos[i].attached()) servos[i].detach();
      if (acts[i].pin >= 0) { servos[i].setPeriodHertz(50); servos[i].attach(acts[i].pin, 500, 2400); servos[i].write(actSt[i].on ? acts[i].angOn : acts[i].angOff); }
#endif
    } else {
#ifdef USE_SERVO
      if (servos[i].attached()) servos[i].detach();      // este índice antes era un servo
#endif
      if (acts[i].pin >= 0) { pinMode(acts[i].pin, OUTPUT); digitalWrite(acts[i].pin, (actSt[i].on == acts[i].activeHigh) ? HIGH : LOW); }
    }
  }
#ifdef USE_SERVO
  for (int i = nActs; i < MAXA; i++) if (servos[i].attached()) servos[i].detach();
#endif
  disp = nd;
  for (int i = 0; i < MAXS; i++) curVal[i] = NAN;
  cfgVersion = doc["version"] | 0;
  int ri = doc["report_interval_s"] | 10;
  reportMs = (unsigned long)(ri < 2 ? 2 : ri) * 1000UL;
  xSemaphoreGive(cfgLock);
  Serial.printf("[CFG] aplicada v%d: %d sensores, %d actuadores, cada %d s\n", cfgVersion, cs, ca, ri);
  return 2;
}

// --- lectura de sensores ---
#ifdef USE_DHT
DHT* dhtFor(int pin, int type) {
  static DHT* tab[4]; static int pins[4]; static int n = 0;
  for (int i = 0; i < n; i++) if (pins[i] == pin) return tab[i];
  if (n >= 4) return nullptr;
  tab[n] = new DHT(pin, type == 11 ? DHT11 : DHT22); tab[n]->begin(); pins[n] = pin; return tab[n++];
}
#endif
#ifdef USE_DS18B20
float readDs18b20(int pin) {
  static OneWire* ow[2]; static DallasTemperature* dt[2]; static int pins[2]; static int n = 0;
  int idx = -1;
  for (int i = 0; i < n; i++) if (pins[i] == pin) idx = i;
  if (idx < 0) { if (n >= 2) return NAN; ow[n] = new OneWire(pin); dt[n] = new DallasTemperature(ow[n]); dt[n]->begin(); pins[n] = pin; idx = n++; }
  dt[idx]->requestTemperatures();
  float t = dt[idx]->getTempCByIndex(0);
  return t == DEVICE_DISCONNECTED_C ? NAN : t;
}
#endif
// HC-SR04: pin = TRIG, param = ECHO. Mediana de 3 mediciones (descarta ecos sueltos). Distancia en cm; fuera de 2-400 cm = sin dato.
float readHcsr04(int trig, int echo) {
  if (trig < 0 || echo < 0) return NAN;
  pinMode(trig, OUTPUT); pinMode(echo, INPUT);
  float v[3]; int n = 0;
  for (int i = 0; i < 3; i++) {
    digitalWrite(trig, LOW); delayMicroseconds(4);
    digitalWrite(trig, HIGH); delayMicroseconds(10); digitalWrite(trig, LOW);
    unsigned long us = pulseIn(echo, HIGH, 30000UL);          // 30 ms ≈ 5 m
    if (us > 0) { float cm = us * 0.0343f / 2.0f; if (cm >= 2.0f && cm <= 400.0f) v[n++] = cm; }
    delay(30);
  }
  if (n == 0) return NAN;
  for (int i = 1; i < n; i++) for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { float t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  return v[n / 2];
}

float readOne(const SensorCfg& s) {
  float v = NAN;
  switch (s.drv) {
    case D_SIM: v = s.simMin + (s.simMax - s.simMin) * (random(0, 10001) / 10000.0f); break;
    case D_ANALOG: { if (s.pin < 0) return NAN; long sum = 0; for (int i = 0; i < 8; i++) sum += analogRead(s.pin); v = (sum / 8.0f) * s.scale + s.offset; break; }
    case D_HCSR04: v = readHcsr04(s.pin, s.param); if (!isnan(v)) v = v * s.scale + s.offset; break;
#ifdef USE_DHT
    case D_DHT_T: case D_DHT_H: { DHT* d = dhtFor(s.pin, s.param); if (!d) return NAN; v = (s.drv == D_DHT_T) ? d->readTemperature() : d->readHumidity(); if (!isnan(v)) v = v * s.scale + s.offset; break; }
#endif
#ifdef USE_DS18B20
    case D_DS18B20: v = readDs18b20(s.pin); if (!isnan(v)) v = v * s.scale + s.offset; break;
#endif
  }
  return v;
}

void readSensors() { for (int i = 0; i < nSens; i++) curVal[i] = readOne(sens[i]); }

void fmtNum(char* buf, size_t n, float v);      // definida más abajo

// --- pantalla OLED 0,91" (SSD1306 128x32, I2C en GPIO 21/22) ---
// Rota entre las variables elegidas en el panel (3 por página). Se dibuja desde loop(), una vez por segundo.
#ifdef USE_OLED
U8G2_SSD1306_128X32_UNIVISION_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
struct OledItem { char name[11]; char val[12]; };
void utf8Trim(char* t) {                       // quita un carácter UTF-8 cortado al final (ñ, á, °…)
  int n = strlen(t);
  while (n > 0 && ((uint8_t)t[n - 1] & 0xC0) == 0x80) n--;
  if (n > 0 && (uint8_t)t[n - 1] >= 0xC0) n--;
  t[n] = 0;
}
#endif

void oledTick() {
#ifdef USE_OLED
  static unsigned long last = 0, pageAt = 0;
  static bool started = false; static uint8_t startedAddr = 0; static int page = 0;
  if (millis() - last < 1000) return;
  last = millis();
  static OledItem items[32]; int n = 0;
  bool on; uint8_t addr, rot;
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  on = disp.enabled; addr = disp.addr; rot = disp.rotateS;
  if (on) {
    auto addSens = [&](int i) {
      if (n >= 32) return;
      strlcpy(items[n].name, sens[i].label, sizeof(items[n].name)); utf8Trim(items[n].name);
      if (isnan(curVal[i])) strlcpy(items[n].val, "--", sizeof(items[n].val));
      else { char b[12]; fmtNum(b, sizeof(b), curVal[i]); snprintf(items[n].val, sizeof(items[n].val), "%s%s", b, sens[i].unit); utf8Trim(items[n].val); }
      n++;
    };
    auto addAct = [&](int i) {
      if (n >= 32) return;
      strlcpy(items[n].name, acts[i].label, sizeof(items[n].name)); utf8Trim(items[n].name);
      strlcpy(items[n].val, actSt[i].on ? "ON" : "OFF", sizeof(items[n].val));
      n++;
    };
    if (disp.nShow == 0) { for (int i = 0; i < nSens; i++) addSens(i); for (int i = 0; i < nActs; i++) addAct(i); }
    else for (int k = 0; k < disp.nShow; k++) {
      bool found = false;
      for (int i = 0; i < nSens && !found; i++) if (!strcmp(sens[i].key, disp.show[k])) { addSens(i); found = true; }
      for (int i = 0; i < nActs && !found; i++) if (!strcmp(acts[i].key, disp.show[k])) { addAct(i); found = true; }
    }
  }
  xSemaphoreGive(cfgLock);
  if (!on) { if (started) { oled.clearDisplay(); started = false; } return; }
  if (!started || startedAddr != addr) {
    oled.setI2CAddress(addr * 2);                 // u8g2 usa la dirección de 8 bits
    oled.begin(); oled.setBusClock(400000); oled.enableUTF8Print();
    started = true; startedAddr = addr;
  }
  int pages = n ? (n + 2) / 3 : 1;
  if (millis() - pageAt >= (unsigned long)rot * 1000UL) { page = (page + 1) % pages; pageAt = millis(); }
  if (page >= pages) page = 0;
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  if (n == 0) oled.drawUTF8(0, 20, "Sin datos");
  for (int r = 0; r < 3; r++) {
    int idx = page * 3 + r;
    if (idx >= n) break;
    int y = 9 + r * 11;                         // 9, 20, 31: deja un margen abajo
    oled.drawUTF8(0, y, items[idx].name);
    oled.drawUTF8(128 - oled.getUTF8Width(items[idx].val), y, items[idx].val);
  }
  oled.sendBuffer();
#endif
}

// --- telemetría ---
void fmtNum(char* buf, size_t n, float v) {
  if (fabsf(v - roundf(v)) < 0.005f && fabsf(v) < 1e9f) snprintf(buf, n, "%ld", (long)roundf(v));
  else snprintf(buf, n, "%.2f", v);
}

// {"v":1,"ts":..,"<clave>":valor,...,"<actuador>_on":true}  Las claves que no son columnas del backend van a telemetry.extra.
void buildPayload(String& out, uint32_t ts) {
  out = "{\"v\":1";
  if (ts > 0) out += ",\"ts\":" + String(ts);
  char b[24];
  for (int i = 0; i < nSens; i++) {
    if (isnan(curVal[i])) continue;
    if ((int)out.length() > PAYLOAD_MAX - 40) { Serial.println("[TX] demasiadas variables: se recortan"); break; }
    fmtNum(b, sizeof(b), curVal[i]);
    out += ",\"" + String(sens[i].key) + "\":" + b;
  }
  for (int i = 0; i < nActs; i++) {
    if ((int)out.length() > PAYLOAD_MAX - 30) break;
    out += ",\"" + String(acts[i].key) + "_on\":" + (actSt[i].on ? "true" : "false");
  }
  out += "}";
}

// --- historial local (solo RAM): lo que muestra la página del propio ESP32 ---
struct HistRow { uint32_t ts, up; float v[MAXS]; uint8_t bits; };
HistRow hist[HN];
int hHead = 0, hCount = 0;
SemaphoreHandle_t histLock;

void histPushNow(uint32_t ts, uint32_t up) {
  xSemaphoreTake(histLock, portMAX_DELAY);
  HistRow& r = hist[(hHead + hCount) % HN];
  r.ts = ts; r.up = up; r.bits = 0;
  for (int i = 0; i < MAXS; i++) r.v[i] = i < nSens ? curVal[i] : NAN;
  for (int i = 0; i < nActs && i < 8; i++) if (actSt[i].on) r.bits |= (1 << i);
  if (hCount < HN) hCount++; else hHead = (hHead + 1) % HN;
  xSemaphoreGive(histLock);
}

// --- actuadores ---
// Peticiones (MQTT/web) y fin de temporizador. Se llama en cada vuelta de taskMqtt.
void actTick(unsigned long now) {
  for (int i = 0; i < nActs; i++) {
    ActState& s = actSt[i];
    if (actStopReq[i]) { actStopReq[i] = false; actReq[i] = 0; if (s.on) { actWrite(i, false); s.endedAt = now; } }
    int r = actReq[i];
    if (r > 0) {
      actReq[i] = 0;
      unsigned long sec = (unsigned long)(r > acts[i].maxS ? acts[i].maxS : r);   // tope de seguridad del firmware
      s.autoRun = false; s.until = now + sec * 1000UL; s.hold = (acts[i].drv == A_SERVO); actWrite(i, true);
    }
    // Relés: se apagan al vencer el tiempo. Servo (postigo de luz): se queda abierto hasta que llegue la orden de cerrar.
    if (s.on && !s.hold && (long)(now - s.until) >= 0) { actWrite(i, false); s.endedAt = now; }
  }
}

// Regla automática (funciona sin nube). Se evalúa con cada lectura nueva.
void actAuto(unsigned long now) {
  for (int i = 0; i < nActs; i++) {
    const ActCfg& a = acts[i]; ActState& s = actSt[i];
    if (!a.autoVar[0]) continue;
    float v = varValue(a.autoVar);
    if (isnan(v)) continue;
    if (!s.on) {
      bool trig = (a.hasBelow && v < a.onBelow) || (a.hasAbove && v > a.onAbove);
      bool cool = s.endedAt == 0 || (now - s.endedAt) >= a.cooldownS * 1000UL;
      if (trig && cool) {
        s.autoRun = true; s.until = now + (unsigned long)(a.autoS > a.maxS ? a.maxS : a.autoS) * 1000UL; s.hold = (a.drv == A_SERVO); actWrite(i, true);
        Serial.printf("[ACT] regla automática: %s = %.1f\n", a.autoVar, v);
      }
    } else if (s.autoRun && a.hasOff) {
      bool done = a.hasBelow ? (v >= a.offAt) : (a.hasAbove ? (v <= a.offAt) : false);
      if (done) { actWrite(i, false); s.endedAt = now; }
    }
  }
}
// <<< LOGIC

// === CALLBACK MQTT === (comando de actuador: simon/esp32-01/cmd/<clave> con {"seconds":30}; {"seconds":0} lo apaga)
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] RX [%s] %.*s\n", topic, (int)length, (const char*)payload);
  const char* p = strstr(topic, "/cmd/");
  if (!p) return;
  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload, length)) return;
  if (!doc.containsKey("seconds")) return;
  int sec = doc["seconds"] | -1;
  if (sec < 0) return;
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  int i = findAct(p + 5);
  xSemaphoreGive(cfgLock);
  if (i < 0) return;
  if (sec == 0) actStopReq[i] = true;      // seconds = 0: apagar ahora
  else actReq[i] = sec;
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
const int QN = 80;                // 80 lecturas x 10 s ≈ 13 min en RAM
const int QLEN = PAYLOAD_MAX + 40; // bytes por lectura
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

// === CONFIGURACIÓN DEL DISPOSITIVO (sensores/actuadores) ===
bool saveCfgFile(const String& body) {
  if (!fsOk) return false;
  File f = LittleFS.open("/config.json", "w");
  if (!f) return false;
  f.print(body);
  f.close();
  return true;
}

// GET /devices/esp32-01/config?v=<versión actual>: si no cambió responde corto; si cambió, se aplica y se guarda en flash.
void fetchDeviceConfig() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (xSemaphoreTake(httpMutex, pdMS_TO_TICKS(2000)) != pdTRUE) return;
  WiFiClientSecure sc;
  sc.setInsecure();
  HTTPClient h;
  h.setTimeout(5000);
  String body; int code = -1;
  if (h.begin(sc, String(CLOUD_BASE) + "/devices/" + device_id + "/config?v=" + String(cfgVersion))) {
    code = h.GET();
    if (code == HTTP_CODE_OK) body = h.getString();
    h.end();
  }
  sc.stop();
  xSemaphoreGive(httpMutex);
  if (code == HTTP_CODE_OK) { if (applyConfig(body) == 2) saveCfgFile(body); }
  else Serial.printf("[CFG] /config HTTP %d (se sigue con la configuración guardada)\n", code);
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
  fetchDeviceConfig();
  TickType_t lastCfg = xTaskGetTickCount();
  lastCheck = xTaskGetTickCount();
  candCount = CONFIRMS;                      // la primera lectura vale sola (arranque)

  for (;;) {
    if (xTaskGetTickCount() - lastCfg >= pdMS_TO_TICKS(30000)) { lastCfg = xTaskGetTickCount(); fetchDeviceConfig(); }
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

    // Lectura nueva cada reportMs: SIEMPRE entra a la cola (así se conserva el orden) y se vacía si hay conexión
    if (millis() - lastPub >= reportMs) {
      lastPub = millis();
      String payload; uint32_t ts = nowEpoch();
      xSemaphoreTake(cfgLock, portMAX_DELAY);
      readSensors();                       // según la configuración descargada (sensores reales o simulados)
      actAuto(millis());                   // reglas automáticas de los actuadores (sin nube)
      buildPayload(payload, ts);
      histPushNow(ts, millis() / 1000);
      xSemaphoreGive(cfgLock);
      qPush(payload.c_str());
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

    // Peticiones a actuadores (web local o MQTT) y fin de temporizadores
    xSemaphoreTake(cfgLock, portMAX_DELAY);
    actTick(millis());
    xSemaphoreGive(cfgLock);

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
button,select{font:inherit;padding:8px 12px;border:0;border-radius:8px;background:#1f5c38;color:#fff;margin:4px 4px 0 0}
select{background:#fff;color:#1b2a21;border:1px solid #ccc}
</style></head><body>
<header><h1>Simón · esp32-01 · modo local</h1></header><main>
<div id="chips"></div>
<div id="cloud"></div>
<div class="g" id="g"></div>
<div id="acts"></div>
<div style="margin-top:10px">Historial <select id="sel" onchange="hist()"></select></div><canvas id="cv" width="520" height="90"></canvas>
<p style="font-size:12px;color:#667">Datos directos del ESP32. Al volver la nube, las lecturas guardadas se envían solas.</p>
</main>
<script>
const CLOUD="%CLOUD%";let okN=0,keys="";
function chip(t,ok){return '<span class="chip '+(ok?'ok':'bad')+'">'+t+'</span>'}
function esc(t){return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function st(){try{const s=await (await fetch('/api/state',{cache:'no-store'})).json();
document.getElementById('chips').innerHTML=chip('Local OK',1)+chip(s.mqtt?'Nube conectada':'Sin nube',s.mqtt)+chip('Pendientes: '+s.pending,s.pending==0)+chip('WiFi '+s.rssi+' dBm',s.rssi>-80)+chip('Config v'+s.cfg_version,1)+(s.ap?chip('Red propia activa',0):'');
document.getElementById('g').innerHTML=s.values.map(x=>'<div class="c">'+esc(x.label||x.key)+'<b>'+(x.value==null?'–':x.value)+' <small>'+esc(x.unit)+'</small></b></div>').join('');
document.getElementById('acts').innerHTML=s.actuators.map(a=>'<div class="c" style="margin:6px 0">'+esc(a.label||a.key)+': <b style="display:inline">'+(a.on?'ENCENDIDO':'apagado')+'</b> <button onclick="act(\''+esc(a.key)+'\',15)">15 s</button><button onclick="act(\''+esc(a.key)+'\',0)">Parar</button></div>').join('');
const k=s.values.map(x=>x.key).join(',');if(k!==keys){keys=k;const sel=document.getElementById('sel'),cur=sel.value;sel.innerHTML=s.values.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.label||x.key)+'</option>').join('');if(cur)sel.value=cur;hist()}
}catch(e){document.getElementById('chips').innerHTML=chip('Sin respuesta del ESP32',0)}}
async function hist(){try{const h=await (await fetch('/api/history?n=240',{cache:'no-store'})).json();const i=h.keys.indexOf(document.getElementById('sel').value);if(i<0)return;
const c=document.getElementById('cv'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);const v=h.rows.map(r=>r[2+i]).filter(y=>y!=null);if(v.length<2)return;
const mn=Math.min(...v),mx=Math.max(...v),d=(mx-mn)||1;x.strokeStyle='#1f5c38';x.lineWidth=2;x.beginPath();v.forEach((y,j)=>{const px=j/(v.length-1)*c.width,py=c.height-(y-mn)/d*(c.height-10)-5;j?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}catch(e){}}
async function act(k,s){await fetch('/api/act?key='+encodeURIComponent(k)+'&s='+s,{method:'POST'});st()}
async function cloud(){const b=document.getElementById('cloud');try{const ac=new AbortController();setTimeout(()=>ac.abort(),4000);const r=await fetch(CLOUD+'/health',{cache:'no-store',signal:ac.signal});if(!r.ok)throw 0;okN++}catch(e){okN=0}
if(okN>=3){b.style.display='block';b.innerHTML='La nube volvió. <a href="'+CLOUD+'/">Volver a la nube</a>';if(location.hash.indexOf('auto')>=0)location.href=CLOUD+'/'}else b.style.display='none'}
st();cloud();setInterval(st,3000);setInterval(hist,15000);setInterval(cloud,10000);
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

String jsonEsc(const char* t) {
  String o;
  for (; *t; t++) { if (*t == '"' || *t == '\\') o += '\\'; if ((uint8_t)*t >= 32) o += *t; }
  return o;
}

String numOrNull(float v) { if (isnan(v)) return "null"; char b[24]; fmtNum(b, sizeof(b), v); return String(b); }

void handleState() {
  String s = "{\"device_id\":\"" + String(device_id) + "\",\"fw\":\"" FW_VERSION "\"";
  s += ",\"ts\":" + String(nowEpoch()) + ",\"uptime_s\":" + String(millis() / 1000);
  s += ",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127);
  s += String(",\"mqtt\":") + (mqttUp ? "true" : "false");
  s += String(",\"ap\":") + (apOn ? "true" : "false");
  s += ",\"pending\":" + String(qCount) + String(",\"pending_flash\":") + (spillPending ? "true" : "false");
  s += ",\"cfg_version\":" + String(cfgVersion) + ",\"values\":[";
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  for (int i = 0; i < nSens; i++) {
    if (i) s += ",";
    s += "{\"key\":\"" + jsonEsc(sens[i].key) + "\",\"label\":\"" + jsonEsc(sens[i].label) + "\",\"unit\":\"" + jsonEsc(sens[i].unit) + "\",\"value\":" + numOrNull(curVal[i]) + "}";
  }
  s += "],\"actuators\":[";
  for (int i = 0; i < nActs; i++) {
    if (i) s += ",";
    s += "{\"key\":\"" + jsonEsc(acts[i].key) + "\",\"label\":\"" + jsonEsc(acts[i].label) + "\",\"on\":" + (actSt[i].on ? "true" : "false") + "}";
  }
  xSemaphoreGive(cfgLock);
  s += "]}";
  cors(); server.send(200, "application/json", s);
}

// {"keys":[...],"rows":[[ts,uptime,v1,v2,...],...]} en trozos para no gastar RAM
void handleHistory() {
  int n = server.hasArg("n") ? server.arg("n").toInt() : 120;
  if (n < 1) n = 1;
  if (n > HN) n = HN;
  cors();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  int nk = nSens;
  String head = "{\"keys\":[";
  for (int i = 0; i < nk; i++) head += String(i ? "," : "") + "\"" + jsonEsc(sens[i].key) + "\"";
  xSemaphoreGive(cfgLock);
  server.sendContent(head + "],\"rows\":[");
  xSemaphoreTake(histLock, portMAX_DELAY);
  int cnt = hCount < n ? hCount : n;
  for (int i = hCount - cnt; i < hCount; i++) {
    HistRow r = hist[(hHead + i) % HN];
    xSemaphoreGive(histLock);                     // no se retiene el candado mientras se escribe a la red
    String row = String(i > hCount - cnt ? "," : "") + "[" + String(r.ts) + "," + String(r.up);
    for (int k = 0; k < nk; k++) row += "," + numOrNull(r.v[k]);
    server.sendContent(row + "]");
    xSemaphoreTake(histLock, portMAX_DELAY);
  }
  xSemaphoreGive(histLock);
  server.sendContent("]}");
  server.sendContent("");
}

// /api/act?key=pump&s=15  (s=0 para parar). /api/pump = atajo para la clave "pump".
void handleAct() {
  String key = server.hasArg("key") ? server.arg("key") : String("pump");
  int sec = server.hasArg("s") ? server.arg("s").toInt() : 0;
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  int i = findAct(key.c_str());
  xSemaphoreGive(cfgLock);
  if (i < 0) { cors(); server.send(404, "application/json", "{\"ok\":false,\"error\":\"actuador desconocido\"}"); return; }
  if (sec > 0) actReq[i] = sec; else actStopReq[i] = true;
  cors(); server.send(202, "application/json", String("{\"ok\":true,\"seconds\":") + sec + "}");
}

void startWeb() {
  server.on("/", HTTP_GET, []() {
    String p = FPSTR(PAGE); p.replace("%CLOUD%", CLOUD_BASE);
    cors(); server.send(200, "text/html; charset=utf-8", p);
  });
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/act", HTTP_POST, handleAct);
  server.on("/api/act", HTTP_GET, handleAct);
  server.on("/api/pump", HTTP_POST, handleAct);
  server.on("/api/pump", HTTP_GET, handleAct);
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
  cfgLock   = xSemaphoreCreateMutex();
  histLock  = xSemaphoreCreateMutex();

  fsOk = LittleFS.begin(true);
  spillPending = fsOk && LittleFS.exists(SPILL);   // quedaron lecturas en flash de antes del reinicio
  Serial.printf("[FS] %s%s\n", fsOk ? "LittleFS OK" : "LittleFS FALLÓ (sin respaldo en flash)", spillPending ? " | hay lecturas pendientes" : "");

#ifdef USE_SERVO
  for (int t = 0; t < 4; t++) ESP32PWM::allocateTimer(t);      // temporizadores LEDC para los servos
#endif
  // Configuración guardada en flash (funciona sin red); si no hay, la de fábrica (el hardware confirmado)
  String saved;
  if (fsOk && LittleFS.exists("/config.json")) { File f = LittleFS.open("/config.json", "r"); if (f) { saved = f.readString(); f.close(); } }
  if (saved.length() == 0 || applyConfig(saved) != 2) applyConfig(String(DEFAULT_CFG));

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
  oledTick();
  vTaskDelay(pdMS_TO_TICKS(3));
}