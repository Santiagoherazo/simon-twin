"""Caché Redis opcional. Si no está configurado o cae, todo sigue funcionando (solo más lento).
Tras un error se deja de intentar durante unos segundos para no frenar cada petición."""

import hashlib
import json
import logging
import time

from fastapi.encoders import jsonable_encoder

log = logging.getLogger("simon.cache")
RETRY_AFTER_S = 15.0


class Cache:
    def __init__(self, url: str):
        self.url = url
        self.r = None
        self.down_until = 0.0
        self.hits = 0
        self.misses = 0

    @property
    def enabled(self) -> bool:
        return self.r is not None

    @property
    def ok(self) -> bool:
        return self.enabled and time.monotonic() >= self.down_until

    async def start(self) -> None:
        if not self.url:
            return
        import redis.asyncio as aioredis

        self.r = aioredis.from_url(self.url, decode_responses=True, socket_timeout=1.0, socket_connect_timeout=1.0)
        try:
            await self.r.ping()
            log.info("caché Redis conectada")
        except Exception as e:
            log.warning("Redis no responde (%s); se reintenta solo", e)
            self.down_until = time.monotonic() + RETRY_AFTER_S

    async def close(self) -> None:
        if self.r is not None:
            try:
                await self.r.aclose()
            except Exception:
                pass

    def _fail(self, e: Exception) -> None:
        log.warning("error de Redis (%s); se omite la caché %ds", e, int(RETRY_AFTER_S))
        self.down_until = time.monotonic() + RETRY_AFTER_S

    async def get(self, key: str):
        if not self.ok:
            return None
        try:
            raw = await self.r.get(key)
        except Exception as e:
            self._fail(e)
            return None
        if raw is None:
            self.misses += 1
            return None
        self.hits += 1
        return json.loads(raw)

    async def set(self, key: str, value, ttl: int) -> None:
        if not self.ok:
            return
        try:
            await self.r.set(key, json.dumps(jsonable_encoder(value)), ex=ttl)
        except Exception as e:
            self._fail(e)

    async def delete(self, *keys: str) -> None:
        if not self.ok or not keys:
            return
        try:
            await self.r.delete(*keys)
        except Exception as e:
            self._fail(e)

    async def delete_prefix(self, prefix: str) -> None:
        if not self.ok:
            return
        try:
            async for k in self.r.scan_iter(match=prefix + "*", count=200):
                await self.r.delete(k)
        except Exception as e:
            self._fail(e)

    async def cached(self, key: str, ttl: int, producer):
        """Lee de Redis; si no está, calcula, guarda y devuelve."""
        hit = await self.get(key)
        if hit is not None:
            return hit
        val = await producer()
        await self.set(key, val, ttl)
        return val


def key_hash(obj) -> str:
    return hashlib.sha1(json.dumps(jsonable_encoder(obj), sort_keys=True).encode()).hexdigest()[:16]
