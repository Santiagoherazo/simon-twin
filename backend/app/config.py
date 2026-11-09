from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_user: str = "backend"
    mqtt_password: str
    # Dirección pública del broker que reciben los ESP32 en GET /mqtt-config (opcional)
    mqtt_public_host: str | None = None
    mqtt_public_port: int | None = None
    api_key: str
    # Cuadernos/modelos abiertos por defecto (proyecto académico). Con MODELS_REQUIRE_KEY=true piden la API key.
    models_require_key: bool = False

    # Solo se aceptan datos de dispositivos con este formato de id (esp32-01, sim-01...)
    device_id_regex: str = r"^(esp32|sim)-\d{2,3}$"
    # Tolerancia entre el reloj del dispositivo (NTP) y el del servidor
    max_clock_skew_seconds: int = 300
    # Los dispositivos simulados (prefijo) pueden enviar histórico con ts del pasado
    backdate_prefix: str = "sim-"
    backdate_max_days: int = 60
    # Dispositivos reales: lecturas con hora (NTP) guardadas durante un corte de conexión se aceptan hasta este atraso
    device_backdate_max_s: int = 86400
    # Tope de seguridad para un comando de riego (el ESP32 debe aplicar el suyo también)
    pump_max_seconds: int = 120

    # Ubicación (afecta la presión atmosférica del cálculo de ET) y zona horaria local
    altitude_m: float = 1500.0
    local_utc_offset_h: float = -5.0

    # Alertas de bomba (mA). Calibra con tu minibomba real.
    pump_dry_ma_max: float = 40.0
    pump_block_ma_min: float = 700.0
    stale_seconds: float = 300.0

    # El estado del twin se republica como mucho cada tantos segundos por dispositivo
    state_min_interval_s: float = 2.0

    # Caché Redis (opcional). Vacío = sin caché. Ej.: redis://redis:6379/0
    redis_url: str = ""
    cache_state_ttl_s: int = 5
    cache_history_ttl_s: int = 30
    cache_sim_ttl_s: int = 120

    # Respaldo en Supabase (opcional): cadena de conexión directa a Postgres. Vacío = sin respaldo.
    # Ej.: postgresql://postgres.xxxx:CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
    supabase_db_url: str = ""
    backup_batch: int = 500
    backup_interval_s: float = 10.0
    backup_outbox_max: int = 500_000
    # Sincronización inversa: lecturas que el ESP32 deja directo en Supabase (tabla simon_inbox) cuando cae el servidor
    sync_inbox_batch: int = 200
    sync_require_device_key: bool = True     # exige la clave de ingesta del dispositivo en cada fila del inbox

    # Orígenes del front permitidos por CORS
    cors_origins: list[str] = [
        "http://localhost:5173", "http://127.0.0.1:5173",   # Vite dev
        "http://localhost:4173", "http://127.0.0.1:4173",   # Vite preview
        "http://localhost:8080", "http://127.0.0.1:8080",   # contenedor web (nginx)
    ]
    # Máximo de filas por importación masiva
    import_max_rows: int = 5000


settings = Settings()  # type: ignore[call-arg]
