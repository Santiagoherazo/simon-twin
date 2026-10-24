import asyncio
import hashlib
import json
import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .crops import get_crop, load_profiles
from .ingest import ensure_device, mqtt_loop, process_telemetry, telemetry_args
from .schemas import (
    DeviceCreate, DeviceUpdate, ImportBody, PumpCommand, SimulateRequest, Telemetry,
)
from .simulate import simulate
from .soils import SOILS, get_soil
from .twin import TwinError, compute_state, schedule_state_publish, sim_context, take_snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("simon.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # La base puede tardar unos segundos en aceptar conexiones
    for attempt in range(10):
        try:
            app.state.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=8)
            break
        except (OSError, asyncpg.PostgresError):
            log.warning("base de datos no disponible (intento %d/10)", attempt + 1)
            await asyncio.sleep(3)
    else:
        log.error("No se pudo conectar a la base de datos tras 10 intentos")
        app.state.pool = None
    app.state.api_keys = set()
    app.state.mqtt = None
    try:
        app.state.mqtt = await mqtt_loop(app)
    except Exception as exc:
        log.warning("No se pudo iniciar ingest MQTT: %s", exc)
    yield
    if app.state.mqtt is not None:
        try:
            app.state.mqtt.__aexit__(None, None, None)
        except Exception:
            pass
    if getattr(app.state, "pool", None):
        await app.state.pool.close()


app = FastAPI(title="Simón Twin API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _device_or_404(device_id: str):
    if not getattr(app.state, "pool", None):
        raise HTTPException(503, "base de datos no disponible")
    row = await app.state.pool.fetchrow("SELECT * FROM devices WHERE device_id = $1", device_id)
    if not row:
        raise HTTPException(404, "dispositivo desconocido")
    return row


# ------------------------------------------------------------------ utilidades ------------

@app.get("/health")
async def health():
    db_ok = False
    try:
        pool = getattr(app.state, "pool", None)
        if pool is not None:
            await pool.fetchval("SELECT 1")
            db_ok = True
    except Exception:
        db_ok = False
    mqtt_ok = getattr(app.state, "mqtt", None) is not None
    return {"db": db_ok, "mqtt": mqtt_ok}
