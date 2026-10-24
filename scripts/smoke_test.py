#!/usr/bin/env python3
"""Prueba de humo de punta a punta contra un stack en marcha (docker compose up).

    API_URL=http://localhost:8000 API_KEY=<tu API_KEY de .env> python scripts/smoke_test.py

Solo usa la biblioteca estándar. Escribe datos de prueba en el dispositivo esp32-01
(lecturas de ejemplo e histórico de 48 h); bórralos si no los quieres:
    docker compose exec timescaledb psql -U simon -d simon -c "DELETE FROM telemetry WHERE device_id='esp32-01'"
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
KEY = os.environ.get("API_KEY", "")
if not KEY:
    sys.exit("Falta API_KEY (la de tu .env)")

failures = 0


def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")


def check(name, cond, detail=""):
    global failures
    print(("  ok   " if cond else "  FALLA"), name, "" if cond else f"  -> {detail}")
    if not cond:
        failures += 1


ADMIN = {"X-API-Key": KEY}

print("Salud y catálogo")
st, h = call("GET", "/health")
check("db y mqtt conectados", st == 200 and h["db"] and h["mqtt"], h)
st, devs = call("GET", "/devices")
ids = {d["device_id"] for d in devs}
check("dispositivos sim-01 y esp32-01 existen", {"sim-01", "esp32-01"} <= ids, ids)
st, crops = call("GET", "/crops")
check("catálogo de cultivos (maíz, tomate)", {"maiz", "tomate"} <= {c["id"] for c in crops})
st, soils = call("GET", "/soils")
check("catálogo de suelos", len(soils) >= 5)

print("Seguridad de los endpoints de control")
check("bomba sin API key -> 401", call("POST", "/devices/sim-01/pump", {"seconds": 5})[0] == 401)
check("bomba con API key falsa -> 401", call("POST", "/devices/sim-01/pump", {"seconds": 5}, {"X-API-Key": "x"})[0] == 401)
check("editar dispositivo sin key -> 401", call("PUT", "/devices/sim-01", {"name": "x"})[0] == 401)
check("generar clave sin key -> 401", call("POST", "/devices/esp32-01/ingest-key")[0] == 401)
check("importar sin key -> 401", call("POST", "/devices/esp32-01/import", {"rows": [{"ts": 1}]})[0] == 401)

print("Ingesta HTTP (alternativa a MQTT para el Arduino)")
st, k = call("POST", "/devices/esp32-01/ingest-key", headers=ADMIN)
check("se genera una clave de dispositivo", st == 200 and len(k.get("ingest_key", "")) > 20, k)
dkey = k["ingest_key"]
reading = {"vwc_raw": 2200, "air_t": 25.0, "air_rh": 60.0, "lux": 30000, "soil_t": 23.5, "ph": 6.5,
           "n": 80, "p": 30, "k": 180, "ec": 600, "tank_ok": True, "pump_on": False, "pump_ma": 0}
check("sin clave -> 401", call("POST", "/ingest/esp32-01", reading)[0] == 401)
check("clave incorrecta -> 401", call("POST", "/ingest/esp32-01", reading, {"X-Device-Key": "mala"})[0] == 401)
check("la clave de un dispositivo no sirve para otro",
      call("POST", "/ingest/sim-01", reading, {"X-Device-Key": dkey})[0] == 401)
check("dispositivo inexistente -> 404", call("POST", "/ingest/esp32-99", reading, {"X-Device-Key": dkey})[0] == 404)
check("humedad relativa imposible -> 422", call("POST", "/ingest/esp32-01", dict(reading, air_rh=130), {"X-Device-Key": dkey})[0] == 422)
st, r = call("POST", "/ingest/esp32-01", reading, {"X-Device-Key": dkey})
check("lectura válida -> 202", st == 202 and r["ok"], (st, r))
st, last = call("GET", "/devices/esp32-01/latest")
check("VPD calculado en el servidor (25 °C, 60 % -> ~1.27 kPa)", st == 200 and abs(last["vpd_kpa"] - 1.267) < 0.02, last)
check("humedad calibrada (2200 de 3100..1300 -> 50 %)", st == 200 and abs(last["vwc_pct"] - 50.0) < 0.1, last)

print("Importación de histórico")
now = time.time()
rows = [{"ts": now - h * 3600, "vwc_raw": 1700 + 14 * (48 - h), "air_t": 22 + 4 * (1 if 8 <= (h % 24) <= 18 else 0),
         "air_rh": 65, "lux": 35000 if 8 <= (h % 24) <= 18 else 0} for h in range(48, 0, -1)]
st, r = call("POST", "/devices/esp32-01/import", {"rows": rows}, ADMIN)
check("importa 48 filas horarias", st == 200 and r["inserted"] == 48, (st, r))
check("fila sin ts -> 422", call("POST", "/devices/esp32-01/import", {"rows": [{"air_t": 20}]}, ADMIN)[0] == 422)
check("ts en el futuro -> 422", call("POST", "/devices/esp32-01/import", {"rows": [{"ts": now + 86400, "air_t": 20}]}, ADMIN)[0] == 422)

print("Configuración del dispositivo")
check("cultivo desconocido -> 422", call("PUT", "/devices/esp32-01", {"crop": "papaya"}, ADMIN)[0] == 422)
check("calibración invertida -> 422", call("PUT", "/devices/esp32-01", {"vwc_raw_dry": 1000, "vwc_raw_wet": 2000}, ADMIN)[0] == 422)
check("fecha de siembra inválida -> 422", call("PUT", "/devices/esp32-01", {"sowing_date": "ayer"}, ADMIN)[0] == 422)
st, _ = call("PUT", "/devices/esp32-01", {"crop": "maiz", "soil_type": "franco", "sowing_date": "2026-09-30"}, ADMIN)
check("actualiza cultivo, suelo y siembra", st == 200)

print("Estado del gemelo")
time.sleep(1)
st, s = call("GET", "/devices/esp32-01/state")
check("estado calculado para datos HTTP", st == 200 and s.get("ready"), s)
if st == 200 and s.get("ready"):
    check("etapa, suelo, idoneidad, predicción y planta presentes",
          all(k in s for k in ("stage", "soil", "suitability", "prediction", "plant", "alerts")), list(s))
    check("idoneidad entre 0 y 100", 0 <= s["suitability"]["overall"] <= 100)
st, s = call("GET", "/devices/sim-01/state")
check("estado del dispositivo virtual listo y en línea", st == 200 and s.get("ready") and s["online"], s if st != 200 else "")
check("dispositivo desconocido -> 404", call("GET", "/devices/esp32-77/state")[0] == 404)

print("Simulación what-if")
base_req = {"hours": 72, "step_minutes": 30}
st, a = call("POST", "/devices/sim-01/simulate", base_req)
check("simulación base", st == 200 and len(a["series"]) > 10 and "summary" in a, a if st != 200 else "")
st, b = call("POST", "/devices/sim-01/simulate", dict(base_req, weather={"temp_offset_c": 6, "lux_scale": 1.4}))
check("más calor y luz -> más evapotranspiración", st == 200 and b["summary"]["etc_total_mm"] > a["summary"]["etc_total_mm"])
st, c = call("POST", "/devices/sim-01/simulate", dict(base_req, events=[{"at_hour": 2, "type": "rain", "mm": 30}]))
check("lluvia de 30 mm sube el agua útil", st == 200 and c["series"][-1]["aw_pct"] > a["series"][-1]["aw_pct"])
st, d = call("POST", "/devices/sim-01/simulate", dict(base_req, hours=240, auto_irrigation={"enabled": True, "mm": 20}))
check("riego automático evita el estrés", st == 200 and d["summary"]["hours_water_stress"] == 0 and d["summary"]["irrigation_total_mm"] > 0, d["summary"] if st == 200 else d)
st, e = call("POST", "/devices/sim-01/simulate", dict(base_req, overrides={"crop": "tomate", "soil_type": "arenoso", "vwc_pct": 40, "gdd": 120}))
check("cambia cultivo y suelo (tomate, arenoso)", st == 200 and e["inputs"]["crop"] == "tomate" and e["series"][0]["stage"] == "ES", e if st != 200 else "")
check("cultivo inválido -> 422", call("POST", "/devices/sim-01/simulate", dict(base_req, overrides={"crop": "papaya"}))[0] == 422)
check("horas fuera de rango -> 422", call("POST", "/devices/sim-01/simulate", {"hours": 100000})[0] == 422)
check("simulación de dispositivo desconocido -> 404", call("POST", "/devices/esp32-77/simulate", base_req)[0] == 404)

print("Historial")
st, hist = call("GET", "/devices/sim-01/history?hours=48&bucket_seconds=60")
check("historial con puntos", st == 200 and len(hist["points"]) > 10)
st, hist = call("GET", "/devices/sim-01/history?hours=720&bucket_seconds=1")
check("el intervalo sube solo para no pasar de ~2000 puntos", st == 200 and len(hist["points"]) <= 2100 and hist["bucket_seconds"] > 1)

print("Comandos de riego (el dispositivo virtual obedece)")
check("más de 120 s -> 422", call("POST", "/devices/sim-01/pump", {"seconds": 121}, ADMIN)[0] == 422)
check("dispositivo offline -> 409", call("POST", "/devices/esp32-01/pump", {"seconds": 5}, ADMIN)[0] == 409)
_, before = call("GET", "/devices/sim-01/latest")
st, cmd = call("POST", "/devices/sim-01/pump", {"seconds": 12}, ADMIN)
check("comando aceptado", st == 200 and cmd.get("cmd_id"), (st, cmd))
seen_pump = False
for _ in range(14):
    time.sleep(1.5)
    _, cur = call("GET", "/devices/sim-01/latest")
    if cur.get("pump_on"):
        seen_pump = True
        break
check("el dispositivo enciende la bomba y reporta corriente", seen_pump and (cur.get("pump_ma") or 0) > 100, cur)

print()
if failures:
    sys.exit(f"{failures} comprobación(es) fallaron")
print("Todo ok")
