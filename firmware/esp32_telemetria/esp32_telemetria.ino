#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>

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

// === OBJETOS ===
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

// === CALLBACK MQTT ===
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("[MQTT] RX [");
  Serial.print(topic);
  Serial.print("] ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();
}

// === WIFI ===
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("[WIFI] Conectando");
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println("\n[WIFI] OK | IP: " + WiFi.localIP().toString());
}

// === COLA DE LECTURAS (RAM) ===
// Si MQTT no está conectado (cambio de puerto, caída del túnel, WiFi) las lecturas se guardan aquí con su
// hora (NTP) y se envían al reconectar. El backend acepta hasta 1 h de atraso (device_backdate_max_s).
const int QN = 120;               // 120 lecturas x 10 s = 20 min
const int QLEN = 230;             // bytes por lectura (el JSON mide ~190)
char qbuf[QN][QLEN];
int qHead = 0, qCount = 0;
SemaphoreHandle_t qMutex;
volatile bool mqttUp = false;     // lo escribe solo taskMqtt; taskMonitor lo lee

void qPush(const char* s) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  int idx = (qHead + qCount) % QN;
  if (qCount == QN) { qHead = (qHead + 1) % QN; idx = (qHead + qCount - 1) % QN; }   // llena: descarta la más vieja
  else qCount++;
  strlcpy(qbuf[idx], s, QLEN);
  xSemaphoreGive(qMutex);
}

// Envía la lectura más vieja; solo la quita de la cola si el envío funcionó.
bool qFlushOne() {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (qCount == 0) { xSemaphoreGive(qMutex); return false; }
  bool ok = client.publish(topic_telemetry, qbuf[qHead]);
  if (ok) { qHead = (qHead + 1) % QN; qCount--; }
  xSemaphoreGive(qMutex);
  return ok;
}

// Hora UNIX (0 si el NTP todavía no sincronizó)
uint32_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1700000000 ? (uint32_t)t : 0;
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
  unsigned long lastPub = 0, lastFlush = 0;
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

      float air_t  = random(235, 275) / 10.0;
      float air_rh = random(500, 750) / 10.0;
      float soil_t = random(195, 230) / 10.0;
      int   vwc_raw = random(2150, 2450);
      float ph      = random(62, 68) / 10.0;
      float ec      = random(550, 650);
      float n       = random(70, 90);
      float p       = random(28, 38);
      float k       = random(170, 195);
      int   lux     = random(25000, 60000);

      String payload = "{\"v\":1";
      uint32_t ts = nowEpoch();
      if (ts > 0) payload += ",\"ts\":" + String(ts);     // hora real: el backend la respeta si el atraso es < 1 h
      payload += ",\"vwc_raw\":" + String(vwc_raw);
      payload += ",\"soil_t\":" + String(soil_t, 2);
      payload += ",\"ph\":" + String(ph, 2);
      payload += ",\"ec\":" + String(ec, 1);
      payload += ",\"n\":" + String(n, 1);
      payload += ",\"p\":" + String(p, 1);
      payload += ",\"k\":" + String(k, 1);
      payload += ",\"air_t\":" + String(air_t, 2);
      payload += ",\"air_rh\":" + String(air_rh, 2);
      payload += ",\"lux\":" + String(lux);
      payload += ",\"tank_ok\":true";
      payload += ",\"pump_on\":false";
      payload += ",\"pump_ma\":0.0";
      payload += "}";

      qPush(payload.c_str());
      Serial.printf("[TX] en cola (%d)%s\n", qCount, client.connected() ? "" : " - sin conexión");
    }

    // Vacía la cola poco a poco (1 cada 150 ms) para no saturar el broker ni el WiFi
    if (client.connected() && qCount > 0 && millis() - lastFlush >= 150) {
      lastFlush = millis();
      if (qFlushOne()) {
        if (qCount == 0) Serial.println("[TX] cola vacía, todo enviado");
      } else {
        Serial.println("[TX] publish falló; se reintenta (la lectura sigue en cola)");
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  cfgMutex  = xSemaphoreCreateMutex();
  httpMutex = xSemaphoreCreateMutex();
  qMutex    = xSemaphoreCreateMutex();

  setupWifi();
  WiFi.setAutoReconnect(true);
  configTime(-5 * 3600, 0, "pool.ntp.org", "time.google.com");   // hora real (Colombia UTC-5) para las lecturas
  client.setBufferSize(1024);   // el #define MQTT_MAX_PACKET_SIZE después del include no tiene efecto

  xTaskCreatePinnedToCore(taskMonitor, "MONITOR", 8192, NULL, 1, &hMonitor, 0);
  xTaskCreatePinnedToCore(taskMqtt,    "MQTT",    8192, NULL, 2, &hMqtt,    1);

  Serial.println("[SYS] Dual-core activo con MQTT en claro");
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}