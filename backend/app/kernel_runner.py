"""Kernel de los cuadernos (proceso aparte, estilo Jupyter/Colab).

Habla con el servidor por líneas JSON: lee una orden por stdin y responde una línea por stdout.
Las variables se conservan entre celdas porque todas corren en el mismo espacio de nombres.
"""
import ast
import base64
import contextlib
import io
import json
import os
import sys
import time
import traceback

os.environ.setdefault("MPLBACKEND", "Agg")
PROTO = sys.stdout  # el canal de respuestas; sys.stdout se redirige durante cada celda
MAX_OUT = 200_000


def _send(obj) -> None:
    PROTO.write(json.dumps(obj, default=str) + "\n")
    PROTO.flush()


def _jsonable(x):
    try:
        import numpy as np

        if isinstance(x, np.generic):
            return x.item()
        if isinstance(x, np.ndarray):
            return x.tolist()
    except Exception:
        pass
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [_jsonable(v) for v in x]
    if isinstance(x, float) and x != x:
        return None
    return x if isinstance(x, (int, float, str, bool)) or x is None else str(x)


class Simon:
    """Objeto `simon` disponible en todas las celdas."""

    def __init__(self):
        self._metrics: list[dict] = []
        self._alerts: list[dict] = []
        self._n = 0
        self.predict_fn = None

    def data(self, hours: float | None = None):
        """DataFrame con las lecturas del dispositivo (ts, sensores, indicadores)."""
        import pandas as pd

        path = os.environ.get("SIMON_DATA", "")
        rows = []
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                rows = json.load(f)
        df = pd.DataFrame(rows)
        if "ts" in df.columns and len(df):
            df["ts"] = pd.to_datetime(df["ts"], utc=True)
            df = df.sort_values("ts").reset_index(drop=True)
            if hours:
                df = df[df["ts"] > df["ts"].max() - pd.Timedelta(hours=hours)].reset_index(drop=True)
        return df

    def log(self, step=None, **metrics):
        """Registra métricas (p. ej. simon.log(epoch, loss=0.3, val=0.4)); se grafican como curva de aprendizaje."""
        self._n += 1
        if step is None:
            step = self._n
        clean = {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float)) or hasattr(v, "__float__")}
        self._metrics.append({"step": step, **clean})

    def alert(self, level: str, message: str, variable: str | None = None):
        """Emite una alerta (info | warn | critical)."""
        self._alerts.append({"level": level if level in ("info", "warn", "critical") else "info", "message": str(message), "variable": variable})

    def register(self, fn):
        """Declara la función predict(row) -> dict que se usa con datos en vivo."""
        self.predict_fn = fn
        return fn


simon = Simon()
NS: dict = {"__name__": "__simon__", "simon": simon}
for _name, _mod in (("np", "numpy"), ("pd", "pandas")):
    try:
        NS[_name] = __import__(_mod)
    except Exception:
        pass


def _figures() -> list[str]:
    if "matplotlib.pyplot" not in sys.modules:
        return []
    plt = sys.modules["matplotlib.pyplot"]
    out = []
    for n in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(n).savefig(buf, format="png", dpi=90, bbox_inches="tight")
        out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out


def _run(code: str) -> dict:
    simon._metrics, simon._alerts = [], []
    out, err = io.StringIO(), io.StringIO()
    res, error = None, None
    t0 = time.time()
    try:
        tree = ast.parse(code, "<celda>", "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(compile(tree, "<celda>", "exec"), NS)
            if last is not None:
                v = eval(compile(last, "<celda>", "eval"), NS)
                if v is not None:
                    if hasattr(v, "to_string") and hasattr(v, "shape"):
                        res = v.to_string(max_rows=30, max_cols=14)
                    else:
                        res = repr(v)
    except SystemExit:
        error = "SystemExit ignorado"
    except BaseException as e:  # noqa: BLE001 — incluye KeyboardInterrupt de la celda
        # tb_next salta el marco del kernel; solo queda lo que pasó en la celda
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        error = "".join(traceback.format_exception(type(e), e, tb)).rstrip()[-4000:]
    try:
        figs = _figures()
    except Exception as e:  # pragma: no cover
        figs = []
        err.write(f"(no se pudo dibujar la figura: {e})\n")
    return {
        "ok": error is None,
        "stdout": out.getvalue()[:MAX_OUT] + err.getvalue()[:MAX_OUT],
        "result": (res or "")[:MAX_OUT] or None,
        "error": error,
        "metrics": simon._metrics,
        "alerts": simon._alerts,
        "figures": figs,
        "has_predict": callable(simon.predict_fn),
        "ms": int((time.time() - t0) * 1000),
    }


def _predict(row: dict) -> dict:
    simon._alerts = []
    if not callable(simon.predict_fn):
        return {"ok": False, "error": "Aún no hay predict(row). Decláralo con @simon.register en una celda y ejecútala."}
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            r = simon.predict_fn(row)
        return {"ok": True, "output": _jsonable(r), "alerts": simon._alerts, "stdout": out.getvalue()[:MAX_OUT]}
    except BaseException as e:  # noqa: BLE001
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        return {"ok": False, "error": "".join(traceback.format_exception(type(e), e, tb)).rstrip()[-4000:], "stdout": out.getvalue()[:MAX_OUT]}


def main() -> None:
    _send({"ready": True})
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        op = msg.get("op")
        if op == "run":
            _send(_run(str(msg.get("code", ""))))
        elif op == "predict":
            _send(_predict(msg.get("row") or {}))
        elif op == "ping":
            _send({"pong": True})


if __name__ == "__main__":
    main()
