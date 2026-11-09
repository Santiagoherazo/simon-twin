"""Cuadernos de modelos (estilo Colab): kernels persistentes, almacenamiento y plantillas."""
import asyncio
import json
import logging
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

log = logging.getLogger("simon.notebook")
RUNNER = str(Path(__file__).with_name("kernel_runner.py"))
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
MAX_ROWS = 20000


class KernelError(Exception):
    pass


class Kernel:
    def __init__(self, nb_id: str):
        self.nb_id = nb_id
        self.proc: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.dir = tempfile.mkdtemp(prefix=f"simon-nb-{nb_id}-")
        self.device_id: str | None = None

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self, rows: list[dict], device_id: str | None) -> None:
        await self.stop()
        data = os.path.join(self.dir, "data.json")
        with open(data, "w", encoding="utf-8") as f:
            json.dump(rows, f, default=str)
        env = {"PATH": os.environ.get("PATH", ""), "SIMON_DATA": data, "MPLBACKEND": "Agg",
               "MPLCONFIGDIR": self.dir, "HOME": self.dir, "OMP_NUM_THREADS": "2", "PYTHONUNBUFFERED": "1"}
        self.proc = await asyncio.create_subprocess_exec(
            sys.executable, "-I", RUNNER, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=env, cwd=self.dir, limit=64 * 1024 * 1024)
        self.device_id = device_id
        try:
            line = await asyncio.wait_for(self.proc.stdout.readline(), 30)
        except asyncio.TimeoutError:
            await self.stop()
            raise KernelError("el kernel no arrancó a tiempo")
        if b"ready" not in line:
            await self.stop()
            raise KernelError("el kernel no arrancó")

    async def stop(self) -> None:
        p, self.proc = self.proc, None
        if p and p.returncode is None:
            p.kill()
            try:
                await asyncio.wait_for(p.wait(), 5)
            except asyncio.TimeoutError:
                pass

    async def call(self, msg: dict, timeout: float) -> dict:
        if not self.alive:
            raise KernelError("kernel detenido")
        assert self.proc and self.proc.stdin and self.proc.stdout
        try:
            self.proc.stdin.write((json.dumps(msg) + "\n").encode())
            await self.proc.stdin.drain()
            line = await asyncio.wait_for(self.proc.stdout.readline(), timeout)
        except asyncio.TimeoutError:
            await self.stop()
            raise KernelError(f"Tiempo agotado ({timeout:.0f} s). Se reinició el kernel: las variables se perdieron; vuelve a ejecutar las celdas.")
        except (BrokenPipeError, ConnectionResetError):
            await self.stop()
            raise KernelError("El kernel se cerró (¿poca memoria?). Vuelve a ejecutar las celdas.")
        if not line:
            await self.stop()
            raise KernelError("El kernel se cerró inesperadamente. Vuelve a ejecutar las celdas.")
        return json.loads(line)


class Kernels:
    def __init__(self):
        self._k: dict[str, Kernel] = {}

    def get(self, nb_id: str) -> Kernel:
        k = self._k.get(nb_id)
        if k is None:
            k = self._k[nb_id] = Kernel(nb_id)
        return k

    async def drop(self, nb_id: str) -> None:
        k = self._k.pop(nb_id, None)
        if k:
            await k.stop()
            shutil.rmtree(k.dir, ignore_errors=True)

    async def stop_all(self) -> None:
        for nb_id in list(self._k):
            await self.drop(nb_id)


async def telemetry_rows(pool, device_id: str | None, limit: int = MAX_ROWS) -> list[dict]:
    """Últimas lecturas del dispositivo como filas planas (columnas + variables personalizadas)."""
    if not device_id:
        return []
    recs = await pool.fetch(
        "SELECT * FROM (SELECT * FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT $2) t ORDER BY ts", device_id, limit)
    out = []
    for r in recs:
        d = dict(r)
        extra = d.pop("extra", None)
        d.pop("device_id", None)
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except ValueError:
                extra = None
        if isinstance(extra, dict):
            for k, v in extra.items():
                d.setdefault(k, v)
        d["ts"] = d["ts"].isoformat()
        out.append(d)
    return out


# ------------------------------------------------------------------ plantillas ----------------

def _c(source: str, kind: str = "code") -> dict:
    return {"type": kind, "source": source.strip("\n")}


TEMPLATES: dict[str, dict] = {
    "explorar": {
        "name": "Explorar los datos del jardín",
        "cells": [
            _c("Cada celda se ejecuta con Mayús+Enter. Las variables se conservan entre celdas, igual que en Colab.", "text"),
            _c("df = simon.data()          # lecturas reales del dispositivo elegido\nprint(len(df), 'filas')\ndf.tail()"),
            _c("df.describe().T[['count', 'mean', 'min', 'max']]"),
            _c("import matplotlib.pyplot as plt\ncols = [c for c in ['vwc_pct', 'soil_t', 'air_t', 'air_rh'] if c in df.columns]\nif len(df):\n    df.plot(x='ts', y=cols, subplots=True, figsize=(8, 5))\n    plt.tight_layout()\nelse:\n    print('Aún no hay datos: conecta el ESP32 o el simulador.')"),
        ],
    },
    "aprender-humedad": {
        "name": "Modelo que aprende: humedad futura",
        "cells": [
            _c("Entrena un regresor en línea (SGD) para predecir la humedad del suelo 30 min adelante y registra la curva de aprendizaje con simon.log(). Si aún no hay datos reales, genera datos sintéticos para que puedas probar el flujo.", "text"),
            _c("""import numpy as np, pandas as pd
df = simon.data()
if len(df) < 200 or 'vwc_pct' not in df.columns:
    rng = np.random.default_rng(0)
    n = 1500
    t = np.arange(n)
    df = pd.DataFrame({
        'air_t': 22 + 6*np.sin(t/96*2*np.pi) + rng.normal(0, .4, n),
        'air_rh': 65 - 15*np.sin(t/96*2*np.pi) + rng.normal(0, 1, n),
        'lux': np.clip(40000*np.sin(t/96*2*np.pi), 0, None),
    })
    df['vwc_pct'] = 35 - 0.004*np.cumsum(df['lux']/40000) + rng.normal(0, .3, n)
    print('usando datos sintéticos')
H = 6   # pasos hacia adelante a predecir
feats = [c for c in ['vwc_pct', 'air_t', 'air_rh', 'lux', 'soil_t'] if c in df.columns]
X = df[feats].ffill().bfill().to_numpy()[:-H]
y = df['vwc_pct'].ffill().bfill().to_numpy()[H:]
cut = int(len(X) * .8)
mu, sd = X[:cut].mean(0), X[:cut].std(0) + 1e-9
Xn = (X - mu) / sd
print(feats, X.shape)"""),
            _c("""from sklearn.linear_model import SGDRegressor
from sklearn.metrics import mean_squared_error
m = SGDRegressor(learning_rate='constant', eta0=0.0005, random_state=0)
for epoch in range(1, 41):
    m.partial_fit(Xn[:cut], y[:cut])
    simon.log(epoch,
              entrenamiento=mean_squared_error(y[:cut], m.predict(Xn[:cut])),
              validacion=mean_squared_error(y[cut:], m.predict(Xn[cut:])))
print('MSE validación final:', round(mean_squared_error(y[cut:], m.predict(Xn[cut:])), 4))"""),
            _c("""@simon.register
def predict(row):
    # row: la última lectura (dict). Devuelve lo que quieras; 'alerts' y 'overrides' se muestran como señales.
    x = np.array([[row.get(c) if row.get(c) is not None else mu[i] for i, c in enumerate(feats)]], dtype=float)
    est = float(m.predict((x - mu) / sd)[0])
    out = {'vwc_pct_30min': round(est, 2)}
    if est < 22:
        simon.alert('warn', f'Se prevé humedad baja ({est:.1f} %) en 30 min', 'vwc_pct')
    return out

predict({'vwc_pct': 30, 'air_t': 28, 'air_rh': 50, 'lux': 30000})"""),
        ],
    },
    "tipo-cultivo": {
        "name": "¿Qué cultivo encaja con estas condiciones?",
        "cells": [
            _c("Puntúa qué tan bien encajan las condiciones medias con perfiles de cultivo. Los rangos son aproximados (literatura general): edítalos y agrega cultivos.", "text"),
            _c("""PERFILES = {   # (mínimo ideal, máximo ideal)
    'tomate':   {'air_t': (18, 28), 'air_rh': (55, 80), 'vwc_pct': (25, 40)},
    'maíz':     {'air_t': (18, 32), 'air_rh': (45, 75), 'vwc_pct': (22, 38)},
    'lechuga':  {'air_t': (10, 22), 'air_rh': (60, 85), 'vwc_pct': (30, 45)},
    'albahaca': {'air_t': (20, 30), 'air_rh': (50, 75), 'vwc_pct': (22, 35)},
}
def puntaje(valor, lo, hi):
    if valor is None or valor != valor: return None
    if lo <= valor <= hi: return 1.0
    ancho = (hi - lo) / 2
    d = (lo - valor) if valor < lo else (valor - hi)
    return max(0.0, 1 - d / ancho)

def ranking(cond):
    res = []
    for nombre, rangos in PERFILES.items():
        ps = [puntaje(cond.get(k), *r) for k, r in rangos.items()]
        ps = [p for p in ps if p is not None]
        res.append((nombre, round(100 * sum(ps) / len(ps), 1) if ps else None))
    return sorted(res, key=lambda x: -(x[1] or 0))

df = simon.data()
cond = df[[c for c in ['air_t', 'air_rh', 'vwc_pct'] if c in df.columns]].mean().to_dict() if len(df) else {'air_t': 24, 'air_rh': 62, 'vwc_pct': 30}
print('condiciones:', {k: round(v, 1) for k, v in cond.items()})
ranking(cond)"""),
            _c("""@simon.register
def predict(row):
    r = ranking(row)
    return {'mejor_cultivo': r[0][0], 'ranking': r}

predict({'air_t': 15, 'air_rh': 70, 'vwc_pct': 38})"""),
        ],
    },
    "regresion-lineal": {
        "name": "Básico: regresión lineal",
        "cells": [
            _c("Modelo básico: una regresión lineal aprende la relación entre variables del ambiente y predice la humedad del suelo (vwc_pct). No necesita API key para verse; para ejecutarlo y guardarlo usa la API key.", "text"),
            _c("""import numpy as np, pandas as pd
df = simon.data()
feats = [c for c in ['air_t', 'air_rh', 'lux', 'soil_t'] if c in df.columns]
if len(df) < 30 or 'vwc_pct' not in df.columns or not feats:
    rng = np.random.default_rng(1)
    n = 600
    t = np.arange(n)
    df = pd.DataFrame({
        'air_t': 23 + 5*np.sin(t/96*2*np.pi) + rng.normal(0, .5, n),
        'air_rh': 60 - 12*np.sin(t/96*2*np.pi) + rng.normal(0, 1.2, n),
        'lux': np.clip(35000*np.sin(t/96*2*np.pi), 0, None),
        'soil_t': 20 + 2*np.sin(t/96*2*np.pi) + rng.normal(0, .2, n),
    })
    feats = ['air_t', 'air_rh', 'lux', 'soil_t']
    df['vwc_pct'] = 38 - 0.35*df['air_t'] + 0.08*df['air_rh'] - 0.00005*df['lux'] + rng.normal(0, 1.5, n)
    print('usando datos sintéticos (pocas lecturas reales)')
X = df[feats].ffill().bfill().to_numpy()
y = df['vwc_pct'].ffill().bfill().to_numpy()
cut = max(1, int(len(X) * .8))
Xtr, Xte, ytr, yte = X[:cut], X[cut:], y[:cut], y[cut:]
print('muestras:', len(X), 'variables:', feats)"""),
            _c("""from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
modelo = LinearRegression().fit(Xtr, ytr)
pred = modelo.predict(Xte if len(Xte) else Xtr)
ref = yte if len(yte) else ytr
simon.log(1, mae=mean_absolute_error(ref, pred), r2=r2_score(ref, pred))
print('MAE:', round(mean_absolute_error(ref, pred), 3), 'R2:', round(r2_score(ref, pred), 3))
print('coeficientes:', dict(zip(feats, map(lambda v: round(float(v), 4), modelo.coef_))))"""),
            _c("""@simon.register
def predict(row):
    x = np.array([[row.get(c) if row.get(c) is not None else float(np.nanmean(X[:, i])) for i, c in enumerate(feats)]], dtype=float)
    est = float(modelo.predict(x)[0])
    out = {'vwc_pct_estimada': round(est, 2), 'modelo': 'regresion_lineal'}
    if est < 22:
        simon.alert('warn', f'Regresión lineal estima humedad baja ({est:.1f} %)', 'vwc_pct')
    return out

predict({c: float(df[c].iloc[-1]) for c in feats})"""),
        ],
    },
    "knn": {
        "name": "Básico: KNN (vecinos más cercanos)",
        "cells": [
            _c("Modelo básico: KNN compara la lectura actual con lecturas pasadas similares (vecinos) para estimar la humedad del suelo. Simple e interpretable. No necesita API key para verse; para ejecutarlo y guardarlo usa la API key.", "text"),
            _c("""import numpy as np, pandas as pd
df = simon.data()
feats = [c for c in ['air_t', 'air_rh', 'lux', 'soil_t'] if c in df.columns]
if len(df) < 40 or 'vwc_pct' not in df.columns or not feats:
    rng = np.random.default_rng(2)
    n = 700
    t = np.arange(n)
    df = pd.DataFrame({
        'air_t': 23 + 5*np.sin(t/96*2*np.pi) + rng.normal(0, .6, n),
        'air_rh': 60 - 12*np.sin(t/96*2*np.pi) + rng.normal(0, 1.5, n),
        'lux': np.clip(35000*np.sin(t/96*2*np.pi), 0, None),
        'soil_t': 20 + 2*np.sin(t/96*2*np.pi) + rng.normal(0, .25, n),
    })
    feats = ['air_t', 'air_rh', 'lux', 'soil_t']
    df['vwc_pct'] = 38 - 0.3*df['air_t'] + 0.07*df['air_rh'] - 0.00004*df['lux'] + rng.normal(0, 1.8, n)
    print('usando datos sintéticos (pocas lecturas reales)')
X = df[feats].ffill().bfill().to_numpy()
y = df['vwc_pct'].ffill().bfill().to_numpy()
cut = max(1, int(len(X) * .8))
mu, sd = X[:cut].mean(0), X[:cut].std(0) + 1e-9
Xn = (X - mu) / sd
Xtr, Xte, ytr, yte = Xn[:cut], Xn[cut:], y[:cut], y[cut:]
print('muestras:', len(X), 'variables:', feats, 'k=5')"""),
            _c("""from sklearn.neighbors import KNeighborsRegressor
from sklearn.metrics import mean_absolute_error, r2_score
k = 5
modelo = KNeighborsRegressor(n_neighbors=k, weights='distance').fit(Xtr, ytr)
pred = modelo.predict(Xte if len(Xte) else Xtr)
ref = yte if len(yte) else ytr
simon.log(k, mae=mean_absolute_error(ref, pred), r2=r2_score(ref, pred))
print(f'KNN k={k} -> MAE:', round(mean_absolute_error(ref, pred), 3), 'R2:', round(r2_score(ref, pred), 3))"""),
            _c("""@simon.register
def predict(row):
    x = np.array([[row.get(c) if row.get(c) is not None else mu[i] for i, c in enumerate(feats)]], dtype=float)
    est = float(modelo.predict((x - mu) / sd)[0])
    vecinos = modelo.kneighbors((x - mu) / sd, n_neighbors=min(3, len(Xtr)), return_distance=True)[0][0]
    out = {'vwc_pct_estimada': round(est, 2), 'modelo': f'knn(k={k})', 'dist_vecino': round(float(vecinos[0]), 3)}
    if est < 22:
        simon.alert('warn', f'KNN estima humedad baja ({est:.1f} %)', 'vwc_pct')
    return out

predict({c: float(df[c].iloc[-1]) for c in feats})"""),
        ],
    },
}
