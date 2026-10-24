"""Dispositivo virtual de Simón.

Hace lo mismo que el ESP32: publica telemetría de suelo/clima por MQTT y obedece
comandos de riego. Al arrancar por primera vez publica un HISTÓRICO (por defecto 14 días,
con ts del pasado) para que el gemelo tenga datos desde el primer minuto; después
publica en tiempo real.

La física de este simulador es deliberadamente distinta (y más simple) que la del
backend: el gemelo tiene que aprender del "dispositivo", no copiarle la fórmula.
"""

import json
import math
import os
import random
import signal
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

HOST = os.environ.get("MQTT_HOST", "localhost")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
DEVICE_ID = os.environ.get("DEVICE_ID", "sim-01")
PASSWORD = os.environ["MQTT_PASSWORD"]
INTERVAL_S = float(os.environ.get("SIM_INTERVAL_SECONDS", "5"))
BACKFILL_DAYS = float(os.environ.get("SIM_BACKFILL_DAYS", "14"))
BACKFILL_STEP_MIN = float(os.environ.get("SIM_BACKFILL_STEP_MIN", "5"))
AUTO_IRRIGATE_LIVE = os.environ.get("SIM_AUTO_IRRIGATE_LIVE", "false").lower() == "true"
UTC_OFFSET_H = float(os.environ.get("SIM_UTC_OFFSET_H", "-5"))
STATE_FILE = Path(os.environ.get("SIM_STATE_FILE", "/data/sim_state.json"))

# "Dispositivo" físico: una maceta de 20x20 cm con sustrato franco
THETA_SAT, THETA_FC, THETA_WP = 0.46, 0.27, 0.12
ROOT_MM = 300.0
P_DEPLETION = 0.55
RAW_DRY, RAW_WET = 3100, 1300
POT_AREA_CM2, PUMP_ML_MIN = 400.0, 300.0
MM_PER_PUMP_S = PUMP_ML_MIN / 60.0 * 10.0 / POT_AREA_CM2
IRRIGATION_MM = 25.0
PUMP_MA = 230.0

rng = random.Random(int(os.environ.get("SIM_SEED", "42")))


class Pot:
    def __init__(self, theta: float, soil_t: float, crop_start_ts: float):
        self.theta = theta
        self.soil_t = soil_t
        self.crop_start_ts = crop_start_ts
        self.pump_left_s = 0.0          # segundos de bomba pendientes
        self.pending_cmd = 0.0

    # ---- clima ------------------------------------------------------------
    def weather(self, ts: float) -> tuple[float, float, float]:
        day = int(ts // 86400)
        d = random.Random(day)
        cloud = 0.55 + 0.45 * d.random()
        t_mean = 21.5 + 3.5 * d.random()
        h = ((ts / 3600.0) + UTC_OFFSET_H) % 24
        air_t = t_mean + 5.0 * math.sin(2 * math.pi * (h - 9) / 24) + rng.gauss(0, 0.25)
        rh = min(96.0, max(35.0, 78.0 - 2.4 * (air_t - 22.0) + rng.gauss(0, 1.2)))
        sun = max(0.0, math.sin(math.pi * (h - 6) / 12)) if 6 <= h <= 18 else 0.0
        lux = min(65535.0, 52000.0 * cloud * sun * (1 + rng.gauss(0, 0.03)))
        return air_t, rh, max(0.0, lux)

    # ---- física del suelo -------------------------------------------------
    def kc(self, ts: float) -> float:
        days = max(0.0, (ts - self.crop_start_ts) / 86400.0)
        return min(1.1, 0.35 + 0.03 * days)

    def advance(self, ts: float, dt_h: float, air_t: float, rh: float, lux: float, irrigation_mm: float) -> float:
        vpd = 0.6108 * math.exp(17.27 * air_t / (air_t + 237.3)) * (1 - rh / 100.0)
        et0 = 0.022 * (lux / 1000.0) + 0.06 * vpd           # mm/h (muy simple; más 'sediento' que el modelo del gemelo)
        dr = max(0.0, (THETA_FC - self.theta) * ROOT_MM)
        taw = (THETA_FC - THETA_WP) * ROOT_MM
        raw = P_DEPLETION * taw
        ks = 1.0 if dr <= raw else max(0.0, (taw - dr) / (taw - raw))
        etc = et0 * self.kc(ts) * ks * (1 + rng.gauss(0, 0.04))
        self.theta += (irrigation_mm - etc * dt_h) / ROOT_MM
        if self.theta > THETA_FC:
            self.theta = THETA_FC + (self.theta - THETA_FC) * math.exp(-dt_h / 3.0)
        self.theta = min(THETA_SAT, max(THETA_WP * 0.6, self.theta))
        self.soil_t += (air_t - self.soil_t) * min(1.0, dt_h / 4.0)
        return dr

    def needs_irrigation(self) -> bool:
        dr = max(0.0, (THETA_FC - self.theta) * ROOT_MM)
        return dr >= P_DEPLETION * (THETA_FC - THETA_WP) * ROOT_MM

    # ---- lectura ----------------------------------------------------------
    def reading(self, ts: float, air_t: float, rh: float, lux: float, pump_on: bool) -> dict:
        days = max(0.0, (ts - self.crop_start_ts) / 86400.0)
        raw = RAW_DRY - self.theta / THETA_SAT * (RAW_DRY - RAW_WET) + rng.gauss(0, 6)
        return {
            "v": 1,
            "vwc_raw": int(min(4095, max(0, round(raw)))),
            "soil_t": round(self.soil_t + rng.gauss(0, 0.05), 2),
            "ph": round(6.4 + 0.15 * math.sin(days / 6.0) + rng.gauss(0, 0.02), 2),
            "ec": round(640 + 3 * rng.gauss(0, 4) - 2.0 * days, 0),
            "n": round(max(15.0, 95.0 - 1.1 * days + rng.gauss(0, 1.2)), 1),
            "p": round(33 + rng.gauss(0, 0.8), 1),
            "k": round(185 + rng.gauss(0, 2.5), 1),
            "air_t": round(air_t, 2),
            "air_rh": round(rh, 1),
            "lux": round(lux, 0),
            "tank_ok": True,
            "pump_on": pump_on,
            "pump_ma": round(PUMP_MA + rng.gauss(0, 12), 0) if pump_on else round(abs(rng.gauss(0, 1.2)), 0),
        }


def load_state(now: float) -> tuple[Pot, bool]:
    if STATE_FILE.exists():
        try:
            s = json.loads(STATE_FILE.read_text())
            return Pot(s["theta"], s["soil_t"], s["crop_start_ts"]), True
        except Exception:
            pass
    return Pot(THETA_FC, 22.0, now - BACKFILL_DAYS * 86400), False


def save_state(pot: Pot) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(
            {"theta": pot.theta, "soil_t": pot.soil_t, "crop_start_ts": pot.crop_start_ts}))
    except OSError as e:
        print(f"[sim] no se pudo guardar el estado: {e}", file=sys.stderr)


def main() -> None:
    now = time.time()
    pot, resumed = load_state(now)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=DEVICE_ID)
    client.username_pw_set(DEVICE_ID, PASSWORD)
    client.will_set(f"simon/{DEVICE_ID}/status", "offline", qos=1, retain=True)
    client.max_inflight_messages_set(100)
    client.max_queued_messages_set(0)

    def on_connect(c, userdata, flags, reason_code, properties):
        if reason_code != 0:
            print(f"[sim] conexión rechazada: {reason_code}", file=sys.stderr)
            return
        c.publish(f"simon/{DEVICE_ID}/status", "online", qos=1, retain=True)
        c.subscribe(f"simon/{DEVICE_ID}/cmd/pump", qos=1)
        print(f"[sim] conectado como {DEVICE_ID}")

    def on_message(c, userdata, msg):
        try:
            seconds = float(json.loads(msg.payload)["seconds"])
        except (ValueError, KeyError, TypeError):
            return
        seconds = max(0.0, min(seconds, 120.0))            # tope de seguridad del "firmware"
        pot.pending_cmd += seconds
        print(f"[sim] comando de riego: {seconds:.0f} s")

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect_async(HOST, PORT, keepalive=30)
    client.loop_start()
    for _ in range(100):                                    # espera la conexión
        if client.is_connected():
            break
        time.sleep(0.1)

    stop = {"flag": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__("flag", True))
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("flag", True))

    # ---- histórico ----
    if not resumed and BACKFILL_DAYS > 0:
        step_s = BACKFILL_STEP_MIN * 60.0
        n = int(BACKFILL_DAYS * 86400 / step_s)
        t0 = now - n * step_s
        print(f"[sim] publicando {n} muestras de histórico ({BACKFILL_DAYS:g} días)…")
        info = None
        for i in range(n):
            if stop["flag"]:
                break
            ts = t0 + i * step_s
            air_t, rh, lux = pot.weather(ts)
            irr = 0.0
            if pot.needs_irrigation():
                irr = IRRIGATION_MM
            pot.advance(ts, step_s / 3600.0, air_t, rh, lux, irr)
            payload = pot.reading(ts, air_t, rh, lux, pump_on=irr > 0)
            payload["ts"] = round(ts, 1)
            info = client.publish(f"simon/{DEVICE_ID}/telemetry", json.dumps(payload), qos=1)
            if i % 50 == 0:
                info.wait_for_publish(timeout=10)
                time.sleep(0.2)
        if info is not None:
            info.wait_for_publish(timeout=30)
        save_state(pot)
        print("[sim] histórico publicado; pasando a tiempo real")

    # ---- tiempo real ----
    last = time.time()
    last_save = last
    while not stop["flag"]:
        time.sleep(INTERVAL_S)
        ts = time.time()
        dt_s = ts - last
        last = ts
        irr = 0.0
        if pot.pending_cmd > 0:
            run = min(pot.pending_cmd, dt_s)
            pot.pending_cmd -= run
            irr = run * MM_PER_PUMP_S
            pot.pump_left_s = pot.pending_cmd
        elif AUTO_IRRIGATE_LIVE and pot.needs_irrigation():
            pot.pending_cmd = IRRIGATION_MM / MM_PER_PUMP_S
        air_t, rh, lux = pot.weather(ts)
        pot.advance(ts, dt_s / 3600.0, air_t, rh, lux, irr)
        payload = pot.reading(ts, air_t, rh, lux, pump_on=irr > 0)
        client.publish(f"simon/{DEVICE_ID}/telemetry", json.dumps(payload), qos=0)
        if ts - last_save > 60:
            save_state(pot)
            last_save = ts

    save_state(pot)
    client.publish(f"simon/{DEVICE_ID}/status", "offline", qos=1, retain=True).wait_for_publish(timeout=5)
    client.loop_stop()
    client.disconnect()


if __name__ == "__main__":
    main()
