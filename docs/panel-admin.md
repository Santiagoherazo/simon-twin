# Panel administrativo y configuración remota del ESP32

Abre `https://TU-SITIO/#/admin` (escribe la API key para guardar).

## Qué se edita
- **Sensores** (solo los del equipo): DHT11, humedad de suelo, DS18B20, 4 LDR y ultrasonido HC-SR04 (más «Simulado» para pruebas). Cada uno con su
  pin, escala/desplazamiento (valor = lectura × escala + desplazamiento), unidad y rango ideal (de ahí salen los avisos «alto/bajo»).
  «Agregar sensor» trae plantillas con los pines del montaje y sus indicadores (luz media, nivel del tanque).
- **Actuadores**: mini bomba, luz externa (relés) y el servo de la **luz indirecta** (ángulo abierto y cerrado; se queda en su posición, sin temporizador); pin (vacío = virtual), tope de seguridad y una **regla automática**
  («cuando `vwc_raw` esté encima de 2900, enciende 30 s y corta en 2500») que corre en el ESP32 aunque no haya nube. Botón «Probar 5 s».
- **Indicadores**: fórmulas sobre las variables (`air_t - soil_t`, `max(a,b)`…). Las calcula el servidor con cada lectura y las guarda.
- **ESP32 y cableado**: intervalo de envío, **pantalla OLED** (activar, dirección I2C, qué variables rotar), tabla de pines y el JSON exacto que recibirá el ESP32. Avisa de pines inválidos
  (flash, solo entrada, ADC2 con WiFi) y repetidos.

## Cómo llega al ESP32 (sin reflashear)
1. Guardas → el backend sube `config_version`.
2. El ESP32 (firmware 2.0) consulta `GET /devices/esp32-01/config?v=<versión>` cada 30 s; si cambió, la aplica sin reiniciar y la guarda en
   flash (`/config.json`), así que arranca con ella aunque no haya internet. Sin configuración usa una de fábrica (el hardware confirmado).
3. Cada lectura incluye todas las variables activas y `<actuador>_on`. Las que no son columnas estándar van a `telemetry.extra`.

## Drivers que necesitan librería
En el sketch están activados `USE_DHT`, `USE_DS18B20`, `USE_SERVO` (ESP32Servo) y `USE_OLED` (U8g2); comenta el de la pieza que no uses.
Si el panel configura un sensor cuyo driver no está compilado, el ESP32 lo omite y lo dice por el monitor serie.

## API
- `GET /catalog` · `GET /devices/<id>/config[?v=N][&full=1]` · `PUT /admin/devices/<id>/config` (API key)
- `POST /devices/<id>/actuators/<clave>/command {"seconds":N}` (API key; topic `simon/<id>/cmd/<clave>`)
- El estado del gemelo (`/devices/<id>/state`) trae `custom` (variables e indicadores con su estado ok/bajo/alto), `actuators` y `config_version`.

## Cuadernos y modelo de cultivo
La pestaña Modelos se abre **sin API key** (`MODELS_REQUIRE_KEY=false` por defecto). Si escribes una clave arriba se envía igual y debe ser válida; con `MODELS_REQUIRE_KEY=true` pasa a ser obligatoria.
Pestaña **Modelos**: cuadernos tipo Colab (celdas, variables persistentes, `simon.data()`, `simon.log()`, `simon.alert()`, `@simon.register`). Plantillas: explorar, aprender-humedad, tipo-cultivo. Detalles del motor de cultivo en `modelo-cultivo.md`.

### Importar y comparar modelos
- **Importar .py / .ipynb**: en Modelos → «Importar». Un `.py` se divide en celdas con marcadores `# %%`; un `.ipynb` conserva sus celdas. Si define `train(df)` y/o `predict(row)`, se agrega una celda final que entrena (con `simon.data()`) y registra `predict`. Máx. 1 MB.
- **Comparar modelos**: cada vez que un cuaderno llama `simon.log(...)`, se guarda su última métrica en este navegador; con 2+ cuadernos aparece una tabla y se marca con ★ el de menor «validación» (se asume pérdida).

## Control desde la pantalla principal
Con el dispositivo en vivo, sobre la animación aparece una botonera con un botón por actuador (mini bomba, luz externa, servo). Tocar uno (o su
modelo 3D) abre sus duraciones y, si está encendido, «Apagar ahora» (`seconds: 0`). Pide la API key una sola vez por pestaña. Sin nube, la orden va directo al ESP32.
