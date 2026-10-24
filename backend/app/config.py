from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_user: str = "backend"
    mqtt_password: str
    api_key: str

    # Solo se aceptan datos de dispositivos con este formato de id (esp32-01, sim-01...)
    device_id_regex: str = r"^(esp32|sim)-\d{2,3}$"
    # Tolerancia entre el reloj del dispositivo (NTP) y el del servidor
    max_clock_skew_seconds: int = 300
    # Los dispositivos simulados (prefijo) pueden enviar histórico con ts del pasado
    backdate_prefix: str = "sim-"
    backdate_max_days: int = 60
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

    # Orígenes del front permitidos por CORS
    cors_origins: list[str] = [
        "http://localhost:5173", "http://127.0.0.1:5173",   # Vite dev
        "http://localhost:4173", "http://127.0.0.1:4173",   # Vite preview
        "http://localhost:8080", "http://127.0.0.1:8080",   # contenedor web (nginx)
    ]
    # Máximo de filas por importación masiva
    import_max_rows: int = 5000


settings = Settings()  # type: ignore[call-arg]
