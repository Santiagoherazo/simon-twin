# Redis (caché) y Supabase (respaldo)

## Redis — lecturas rápidas
- Servicio `redis` en `docker-compose.yml` (sin persistencia, 64 MB, LRU). Variable del backend: `REDIS_URL`.
- Cachea: último dato (`/latest`, se invalida con cada lectura nueva), estado del gemelo (`/state`, 5 s), histórico (30 s) y
  simulaciones what-if repetidas (120 s; la clave incluye la última lectura al minuto y se borra si cambias el dispositivo).
- Si Redis no está configurado o cae, el backend responde igual (sin caché) y reintenta cada 15 s.
- Vive en tu servidor: **acelera, pero no protege de una caída**. Para eso es Supabase.

## Supabase — respaldo en la nube
1. Crea el proyecto en Supabase y copia la cadena **Session pooler** (Project Settings → Database). Ponla en `SUPABASE_DB_URL`.
2. Al arrancar, el backend crea `simon_devices` y `simon_telemetry` en Supabase (con RLS activado y sin políticas: la clave pública
   no puede leerlas) y empieza a copiar.
3. Cómo funciona: cada lectura se guarda junto con una fila en `backup_outbox` (misma transacción). Un proceso en segundo plano
   envía lotes de 500 con `ON CONFLICT DO NOTHING` y borra lo enviado. Si Supabase o internet fallan, la cola crece y se reintenta
   solo (tope `BACKUP_OUTBOX_MAX`, 500 000 filas).
4. `GET /health` muestra `redis`, y `backup` con `remote_ok`, `last_sync` y `pending` (filas por respaldar).
5. Histórico que ya tenías: `POST /admin/backup/backfill?days=30` con tu `X-API-Key`.

No se copia el hash de la clave de ingesta de los dispositivos.

## Sincronización en los dos sentidos
```
ESP32 ──MQTT──► tu servidor ──► base local ──(cola, cada 10 s)──► Supabase simon_telemetry
   │                                 ▲
   └─ si MQTT lleva > 45 s caído ─► Supabase simon_inbox ──(ciclo del backend: valida y trae)──┘
```
- **El "cron"** es el ciclo del backend (cada `BACKUP_INTERVAL_S`, 10 s): envía la cola local a Supabase **y** trae el buzón
  `simon_inbox` a la base local. Corre dentro del backend, sin otro servicio. Si prefieres un cron externo, estos endpoints hacen
  una pasada completa (con `X-API-Key`): `POST /admin/sync/run`.
- **ESP32 → Supabase**: si no hay MQTT durante 45 s pero sí WiFi, el firmware (v1.5) manda lotes de 10 lecturas por HTTPS a
  `simon_inbox`. Rellena `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `INGEST_KEY` en el sketch (la clave de ingesta sale de
  `POST /devices/esp32-01/ingest-key`).
- **Seguridad del buzón**: la clave `anon` solo puede INSERTAR en `simon_inbox` (RLS + política que limita `device_id` y el
  tamaño); no puede leer nada. El backend descarta filas con clave de dispositivo incorrecta, JSON inválido o fuera de rango
  (`SYNC_REQUIRE_DEVICE_KEY=true`). Un tercero con la clave `anon` solo puede ensuciar el buzón, no la base real.
- **Sin duplicados**: `telemetry` tiene índice único `(device_id, ts)`; una lectura que llegue por MQTT y por Supabase se guarda una vez.
- **Supabase → local**: `POST /admin/sync/restore?days=30` recupera dispositivos y lecturas que falten en la base local
  (por ejemplo, tras perder o restaurar el servidor). No pisa lo existente.

## Límites
- Plan gratis de Supabase: 500 MB y pausa por inactividad. A 10 s por lectura son ~8600 filas/día.
- La app aún no lee de Supabase; es respaldo y buzón.
- La configuración de dispositivos solo viaja local → Supabase (y en `restore`); los cambios hechos directamente en Supabase no vuelven.
- El firmware usa `setInsecure()` (sin verificar certificado) para las pruebas.
