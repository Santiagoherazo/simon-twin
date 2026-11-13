
#include <cstdio>
#include <cstring>
#include <cmath>
#include <cstdint>
#include <cstdarg>
#include <string>
#include <vector>
#include "aj.h"
#define PROGMEM
using std::isnan;
#define constrain(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
#define USE_SERVO
#define USE_OLED
typedef int SemaphoreHandle_t;
inline void xSemaphoreTake(SemaphoreHandle_t, int) {}
inline void xSemaphoreGive(SemaphoreHandle_t) {}
#define portMAX_DELAY 0
struct SerialT { void println(const char* s) { puts(s); } void printf(const char* f, ...) { va_list a; va_start(a, f); vprintf(f, a); va_end(a); } } Serial;
class String { std::string s; public: String(const char* c) : s(c) {} const char* c_str() const { return s.c_str(); } };
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
std::vector<std::string> pinlog;
void pinMode(int, int) {}
void digitalWrite(int p, int v) { char b[40]; snprintf(b, 40, "dw %d %d", p, v); pinlog.push_back(b); }
int analogRead(int) { return 0; }
void delay(unsigned long) {}
void delayMicroseconds(unsigned) {}
long random(long a, long b) { return (a + b) / 2; }
unsigned long g_ms = 0; unsigned long millis() { return g_ms; }
std::vector<unsigned long> pulses; size_t pidx = 0;
unsigned long pulseIn(int, int, unsigned long) { return pidx < pulses.size() ? pulses[pidx++] : 0; }
class Servo { int pin = -1; public: bool attached() { return pin >= 0; } void detach() { pin = -1; } void setPeriodHertz(int) {} void attach(int p, int, int) { pin = p; printf("  servo attach pin %d\n", p); } void write(int a) { printf("  servo(pin %d) -> %d grados\n", pin, a); } };
struct U8G2_SSD1306_128X32_UNIVISION_F_HW_I2C {
  U8G2_SSD1306_128X32_UNIVISION_F_HW_I2C(int, int) {}
  void setI2CAddress(int a) { printf("  oled addr 0x%02X\n", a); } void begin() { puts("  oled begin"); } void setBusClock(long) {} void enableUTF8Print() {}
  void clearDisplay() { puts("  oled clear"); } void clearBuffer() { puts("  --- oled frame ---"); } void setFont(int) {}
  void drawUTF8(int x, int y, const char* t) { printf("  [x=%3d y=%2d] %s\n", x, y, t); }
  int getUTF8Width(const char* t) { return 6 * strlen(t); } void sendBuffer() {}
};
#define U8G2_R0 0
#define U8X8_PIN_NONE 0
#define u8g2_font_6x10_tf 0
//@@SKETCH@@
int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FALLA: %s (línea %d)\n", #c, __LINE__); fails++; } } while (0)
int main() {
  puts("== config de fábrica (sin DHT/DS18B20 compilados: se omiten con aviso) ==");
  CHECK(applyConfig(String(DEFAULT_CFG)) == 2);
  printf("sensores=%d actuadores=%d\n", nSens, nActs);
  CHECK(nSens == 6 && nActs == 3);                       // 9 sensores - 2 DHT omitidos... (DHT t y h) y DS18B20 => 6 o 7; se afirma abajo
  CHECK(!strcmp(acts[2].key, "servo") && acts[2].drv == A_SERVO && acts[2].angOn == 90 && acts[2].angOff == 0);
  CHECK(acts[0].drv == A_RELAY && acts[1].maxS == 3600);
  CHECK(disp.enabled && disp.addr == 60 && disp.rotateS == 4 && disp.nShow == 6 && !strcmp(disp.show[5], "pump"));
  int ih = -1; for (int i = 0; i < nSens; i++) if (!strcmp(sens[i].key, "tank_cm")) ih = i;
  CHECK(ih >= 0 && sens[ih].drv == D_HCSR04 && sens[ih].pin == 23 && sens[ih].param == 19);

  puts("== ultrasonido: mediana descarta el eco suelto ==");
  pulses = {600, 5800, 610}; pidx = 0;                      // 600us≈10.3cm, 5800us≈99cm (ruido), 610us≈10.4cm
  float d = readHcsr04(23, 19); printf("distancia=%.2f cm\n", d);
  CHECK(fabsf(d - 10.46f) < 0.2f);
  pulses = {0, 0, 0}; pidx = 0; CHECK(isnan(readHcsr04(23, 19)));          // sin eco = sin dato
  pulses = {50, 50, 50}; pidx = 0; CHECK(isnan(readHcsr04(23, 19)));       // < 2 cm = fuera de rango

  puts("== servo: ON va a angle_on, OFF vuelve a angle_off ==");
  actWrite(2, true); CHECK(actSt[2].on);
  actWrite(2, false); CHECK(!actSt[2].on);
  pinlog.clear(); actWrite(1, true); CHECK(pinlog.size() == 1 && pinlog[0] == "dw 27 1");   // relé de la luz

  puts("== servo = postigo de luz indirecta: abrir lo deja abierto, cerrar lo cierra ==");
  actReq[2] = 5; actTick(1000);                         // "abrir" (el número no es un tiempo para el servo)
  CHECK(actSt[2].on);
  actTick(1000 + 3600UL * 1000UL * 5);                  // pasan 5 horas: sigue abierto
  CHECK(actSt[2].on);
  actStopReq[2] = true; actTick(99999999);              // cerrar
  CHECK(!actSt[2].on);
  actReq[1] = 2; actTick(200000); CHECK(actSt[1].on);   // el relé de la luz sí vence por tiempo
  actTick(200000 + 2500); CHECK(!actSt[1].on);
  puts("== OLED: 3 variables por página y rota ==");
  for (int i = 0; i < nSens; i++) curVal[i] = 20.0f + i;
  curVal[ih] = 11.5f;
  actSt[0].on = true;
  g_ms = 2000; oledTick();
  g_ms = 7000; oledTick();                                  // pasaron > 4 s: siguiente página

  puts("== OLED con 7 sensores simulados y sin lista: 3 páginas que rotan ==");
  CHECK(applyConfig(String(R"({"version":4,"sensors":[
   {"key":"a1","label":"Sensor uno","unit":"°C","driver":"simulated"},{"key":"a2","label":"Sensor dos","driver":"simulated"},
   {"key":"a3","label":"Sensor tres","driver":"simulated"},{"key":"a4","label":"Sensor cuatro","driver":"simulated"},
   {"key":"a5","label":"Sensor cinco","driver":"simulated"},{"key":"a6","label":"Sensor seis","driver":"simulated"},
   {"key":"a7","label":"Ñandú muy largo","unit":"°C","driver":"simulated"}],"actuators":[],
   "display":{"enabled":true,"address":61,"rotate_s":2,"show":[]}})")) == 2);
  CHECK(disp.addr == 61 && disp.nShow == 0 && nSens == 7);
  for (int i = 0; i < nSens; i++) curVal[i] = 10.0f * (i + 1);
  g_ms = 10000; oledTick();      // primera vez: pageAt=7000 -> ya pasó rot, avanza a página 1
  g_ms = 12000; oledTick();      // +2 s -> página 2
  g_ms = 14000; oledTick();      // +2 s -> vuelve a la 0

  puts("== config sin pantalla ni servo: se apaga la pantalla ==");
  CHECK(applyConfig(String(R"({"version":3,"sensors":[],"actuators":[{"key":"pump","pin":26}],"display":{"enabled":false}})")) == 2);
  CHECK(!disp.enabled && nActs == 1);
  CHECK(applyConfig(String("{\"unchanged\":true}")) == 1);
  CHECK(applyConfig(String("no es json")) == 0);
  printf("%s\n", fails ? "HAY FALLAS" : "TODO BIEN");
  return fails;
}
