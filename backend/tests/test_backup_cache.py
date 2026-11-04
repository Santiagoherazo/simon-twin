"""Integración: respaldo a Supabase (otra base Postgres) y caché Redis. Se omite si no hay servicios de prueba.
Variables: TEST_PG_LOCAL, TEST_PG_REMOTE, TEST_REDIS (ver README)."""
import asyncio, os, time
import pytest

LOCAL, REMOTE, REDIS = os.getenv("TEST_PG_LOCAL"), os.getenv("TEST_PG_REMOTE"), os.getenv("TEST_REDIS")
pytestmark = pytest.mark.skipif(not (LOCAL and REMOTE and REDIS), reason="sin servicios de prueba")


def run(c):
    return asyncio.run(c)


def test_outbox_drena_a_remoto_sin_duplicados_y_se_recupera():
    import asyncpg
    from app import backup
    from app.migrate import migrate

    async def go():
        loc = await asyncpg.create_pool(LOCAL, min_size=1, max_size=3)
        rem = await asyncpg.create_pool(REMOTE, min_size=1, max_size=2, statement_cache_size=0)
        await loc.execute("DROP TABLE IF EXISTS backup_outbox, telemetry, devices CASCADE")
        await rem.execute("DROP TABLE IF EXISTS simon_telemetry, simon_devices CASCADE")
        await migrate(loc)
        await rem.execute(backup.REMOTE_SCHEMA)
        backup.settings.supabase_db_url = "x"            # habilita enqueue
        now = time.time()
        from datetime import datetime, timezone
        for i in range(25):
            ts = datetime.fromtimestamp(now - 100 + i, tz=timezone.utc)
            async with loc.acquire() as con:
                async with con.transaction():
                    await con.execute("INSERT INTO telemetry (ts, device_id, vwc_raw, vwc_pct) VALUES ($1,'esp32-01',2000,50)", ts)
                    await backup.enqueue(con, "esp32-01", ts)
        assert await backup.pending(loc) == 25
        # lote chico: 3 pasadas
        total = 0
        while True:
            n = await backup.drain(loc, rem, 10)
            if not n:
                break
            total += n
        assert total == 25 and await backup.pending(loc) == 0
        assert await rem.fetchval("SELECT count(*) FROM simon_telemetry") == 25
        assert await rem.fetchval("SELECT count(*) FROM simon_devices WHERE device_id='esp32-01'") == 1
        # reenvío del mismo histórico (backfill): sin duplicados
        assert await backup.backfill(loc, 1) == 25
        while await backup.drain(loc, rem, 100):
            pass
        assert await rem.fetchval("SELECT count(*) FROM simon_telemetry") == 25
        # fallo del remoto: la cola se conserva
        async with loc.acquire() as con:
            await backup.enqueue(con, "esp32-01", datetime.now(timezone.utc))
        await rem.close()
        with pytest.raises(Exception):
            await backup.drain(loc, rem, 100)
        assert await backup.pending(loc) >= 1
        # RLS activo
        rem2 = await asyncpg.create_pool(REMOTE, min_size=1, max_size=1, statement_cache_size=0)
        assert await rem2.fetchval("SELECT relrowsecurity FROM pg_class WHERE relname='simon_telemetry'")
        await loc.close(); await rem2.close()
    run(go())


def test_cache_redis_y_degradacion():
    from app.cache import Cache

    async def go():
        c = Cache(REDIS); await c.start()
        calls = {"n": 0}
        async def prod():
            calls["n"] += 1
            return {"a": 1}
        assert await c.cached("t:k", 5, prod) == {"a": 1}
        assert await c.cached("t:k", 5, prod) == {"a": 1}
        assert calls["n"] == 1 and c.hits == 1
        await c.delete_prefix("t:")
        assert await c.get("t:k") is None
        bad = Cache("redis://127.0.0.1:1/0"); await bad.start()     # Redis caído: no rompe, calcula siempre
        assert await bad.cached("t:k", 5, prod) == {"a": 1} and calls["n"] == 2
        off = Cache("")                                              # sin Redis configurado
        assert await off.cached("t:k", 5, prod) == {"a": 1}
        await c.close()
    run(go())


def test_inbox_anon_validacion_dedupe_y_restore():
    import json
    from datetime import datetime, timezone
    from types import SimpleNamespace
    import asyncpg
    from app import backup
    from app.migrate import migrate

    async def go():
        loc = await asyncpg.create_pool(LOCAL, min_size=1, max_size=3)
        rem = await asyncpg.create_pool(REMOTE, min_size=1, max_size=3, statement_cache_size=0)
        await loc.execute("DROP TABLE IF EXISTS backup_outbox, telemetry, devices CASCADE")
        await rem.execute("DROP TABLE IF EXISTS simon_inbox, simon_telemetry, simon_devices CASCADE")
        await rem.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$")
        await rem.execute("GRANT USAGE ON SCHEMA public TO anon")
        await migrate(loc)
        await rem.execute(backup.REMOTE_SCHEMA)
        backup.settings.supabase_db_url = "x"
        key = "clave-de-prueba"
        await loc.execute("UPDATE devices SET ingest_key_hash=$1 WHERE device_id='esp32-01'", backup.hash_key(key))
        app = SimpleNamespace(state=SimpleNamespace(pool=loc, cache=None))
        base = time.time() - 600                       # no es "en vivo": no dispara el recálculo del twin

        async def post(device, k, payload):             # como lo hace el ESP32: rol anon, solo INSERT
            async with rem.acquire() as con:
                await con.execute("SET ROLE anon")
                try:
                    await con.execute("INSERT INTO simon_inbox (device_id, device_key, payload) VALUES ($1,$2,$3::jsonb)",
                                      device, k, json.dumps(payload))
                finally:
                    await con.execute("RESET ROLE")

        ok = {"v": 1, "ts": base, "vwc_raw": 2200, "air_t": 24.0, "air_rh": 60.0}
        await post("esp32-01", key, ok)
        await post("esp32-01", key, ok)                                         # duplicado exacto (mismo ts)
        await post("esp32-01", key, {**ok, "ts": base + 10})
        await post("esp32-01", "otra-clave", {**ok, "ts": base + 20})           # clave incorrecta
        await post("esp32-01", key, {"vwc_raw": "no-es-numero"})                # payload inválido
        await post("esp32-01", key, {**ok, "vwc_raw": 99999999999})            # fuera de rango para INTEGER
        with pytest.raises(asyncpg.PostgresError):                              # la política bloquea ids ajenos
            await post("hacker-01", key, ok)
        async with rem.acquire() as con:                                        # anon no puede leer
            await con.execute("SET ROLE anon")
            with pytest.raises(asyncpg.PostgresError):
                await con.fetch("SELECT * FROM simon_inbox")
            await con.execute("RESET ROLE")

        res = await backup.pull_inbox(app, rem, 100)
        assert res["read"] == 6 and res["stored"] == 3 and res["discarded"] == 3, res
        assert await loc.fetchval("SELECT count(*) FROM telemetry WHERE device_id='esp32-01'") == 2   # dedupe por (device_id, ts)
        assert await rem.fetchval("SELECT count(*) FROM simon_inbox") == 0                             # buzón vaciado
        # lo recibido por el buzón también se respalda en simon_telemetry
        while await backup.drain(loc, rem, 100):
            pass
        assert await rem.fetchval("SELECT count(*) FROM simon_telemetry") == 2
        # restore: se pierde la base local y se recupera desde Supabase
        await loc.execute("DELETE FROM telemetry")
        out = await backup.restore(app, rem, 3)
        assert out["telemetry_read"] == 2 and await loc.fetchval("SELECT count(*) FROM telemetry") == 2
        out2 = await backup.restore(app, rem, 3)                                # idempotente
        assert await loc.fetchval("SELECT count(*) FROM telemetry") == 2
        await loc.close(); await rem.close()
    run(go())
