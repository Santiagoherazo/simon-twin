import os
import sys
from pathlib import Path

# Variables mínimas para importar app.config en las pruebas
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("MQTT_PASSWORD", "x")
os.environ.setdefault("API_KEY", "test-key")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
