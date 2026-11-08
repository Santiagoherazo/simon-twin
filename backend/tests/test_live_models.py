import asyncio
from types import SimpleNamespace

from app import notebook as nbk
from app.twin import apply_live_models


class FakePool:
    async def fetch(self, *a, **k):
        return [{"id": "m1", "name": "Mi modelo"}]


def test_live_model_adds_alert_and_override():
    async def go():
        kernels = nbk.Kernels()
        k = kernels.get("m1")
        await k.start([], "d1")
        try:
            code = ("@simon.register\n"
                    "def predict(row):\n"
                    "    simon.alert('warn', 'va a secarse', 'vwc_pct')\n"
                    "    return {'overrides': {'vwc_pct': 20, 'nope': 1}, 'x': 1}\n")
            r = await k.call({"op": "run", "code": code}, 20)
            assert r["ok"] and r["has_predict"]
            app = SimpleNamespace(state=SimpleNamespace(pool=FakePool(), kernels=kernels))
            state = {"readings": {"vwc_pct": 35.0}, "alerts": [{"code": "a", "level": "info", "message": "x"}]}
            await apply_live_models(app, "d1", state)
            assert state["readings"]["vwc_pct"] == 20
            assert state["models"][0]["overrides"] == {"vwc_pct": {"was": 35.0, "now": 20.0}}
            assert state["alerts"][0]["code"] == "model_m1" and "va a secarse" in state["alerts"][0]["message"]
            # kernel caído: no rompe el estado
            await k.stop()
            state2 = {"readings": {}, "alerts": []}
            await apply_live_models(app, "d1", state2)
            assert state2["models"][0]["ok"] is False
        finally:
            await kernels.stop_all()
    asyncio.run(go())
