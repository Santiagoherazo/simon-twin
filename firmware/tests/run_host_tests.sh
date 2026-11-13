#!/usr/bin/env bash
# Prueba en el PC la lógica del sketch (configuración, servo, relés, ultrasonido, pantalla OLED) con ArduinoJson real
# y simulaciones mínimas de Arduino. No sustituye a probar en el ESP32. Requiere g++ y curl.
set -euo pipefail
cd "$(dirname "$0")"
INO=../esp32_telemetria/esp32_telemetria.ino
[ -f aj.h ] || curl -sL -o aj.h https://github.com/bblanchon/ArduinoJson/releases/download/v6.21.5/ArduinoJson-v6.21.5.h
python3 - "$INO" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
a, b = src.index("const int MAXS = 24"), src.index("// --- telemetría ---")
fa, fb = src.index("void fmtNum(char* buf, size_t n, float v) {"), src.index('// {"v":1,"ts":..')
ca = src.index("// --- actuadores ---")
cb = src.index("void actAuto(unsigned long now) {")
cb = src.index("\n}\n", cb) + 3
acts_code = src[ca:cb]
t = open("host_harness.template.cpp", encoding="utf-8").read()
head, tail = t.split("//@@SKETCH@@\n")
open("host_harness.cpp", "w", encoding="utf-8").write(head + src[fa:fb] + src[a:b] + acts_code + tail)
PY
g++ -std=c++17 -Wall -Wno-unused -Wno-format-truncation -o host_harness host_harness.cpp
./host_harness
