# Subida a producción (v26)

Resultado de la revisión previa y orden recomendado. Todo lo marcado como **verificado** se probó con base de datos, Redis, API y navegador reales; lo marcado como **sin verificar** necesita una prueba tuya en el equipo.

## 1. Antes de tocar nada
1. **Respaldo de la base de datos** (`pg_dump`) y, si lo usas, confirma que el respaldo a Supabase está al día. Los cambios de esquema son solo de agregar columnas (`display`, `angle_on`, `angle_off`) y se aplican solos al arrancar, pero un respaldo es lo que permite volver atrás.
2. **`.env`**: la `API_KEY` ahora protege también los cuadernos de modelos, que **ejecutan código Python en el servidor** (`MODELS_REQUIRE_KEY=true` por defecto). Usa una clave larga y aleatoria, no la compartas y publica solo detrás de HTTPS. Si el front se sirve desde otro dominio, agrégalo a `CORS_ORIGINS` (lista JSON, p. ej. `["https://tu-front.example"]`; ver `docs/railway.md`): por defecto solo acepta orígenes locales.
3. Dependencias fijadas y auditadas: `fastapi 0.163.1`, `starlette 1.10.0`, `pydantic 2.14.3`, `uvicorn 0.54.0` (antes había 14 avisos de seguridad en starlette) y `@react-three/drei 9.122.0` (corrige `uuid`). `pip-audit` y `npm audit --omit=dev`: 0 vulnerabilidades.

## 2. Orden de la subida
1. **Backend** (`docker compose up -d --build backend`). Al arrancar migra la base y **conserva** la configuración y el historial. Si el dispositivo tenía hardware que ya no existe (BH1750, salida PWM/digital), la configuración se sigue leyendo y el panel muestra un aviso para cargar el hardware confirmado; nada se rompe.
2. **Frontend**. El service worker cambió de versión (`simon-shell-v2`): los navegadores recargan el cliente nuevo solos. En la APK hay que generar e instalar la versión nueva (`npm run build && npx cap sync android`).
3. **Firmware 2.1 en el ESP32** *antes* de cargar la configuración nueva. Un firmware 2.0 recibe los drivers nuevos (`hcsr04`, `servo`) como «desconocidos» y simplemente los omite. Instala las librerías (`ESP32Servo`, `U8g2`, DHT, OneWire, DallasTemperature, PubSubClient, ArduinoJson v6) y revisa el cableado de `firmware/README.md` (en especial el **divisor de 3,3 V del ECHO** y la alimentación externa del servo).
4. En el panel: **Sensores → Cargar hardware confirmado**, revisa pines y **Guardar**. El ESP32 la aplica en menos de 30 s.
5. Calibra el tanque (distancias de vacío y lleno en el indicador `tank_pct`) y los ángulos del servo.

## 3. Comprobación después de subir
- `GET /health` responde 200 y los registros no muestran `Traceback`.
- En el panel, la pestaña **Resumen** muestra el dispositivo en línea y sin avisos de cableado.
- En la pantalla principal aparecen las 4 esquinas de luz, el nivel del tanque y los 3 botones del mando.
- Con el equipo en línea: prueba **Luz externa → Otro → 1 min** y **Apagar ahora**; **Luz indirecta → Abrir / Cerrar**.
- La pantalla OLED rota las variables elegidas.

## 4. Volver atrás
El esquema es compatible hacia atrás (solo columnas nuevas con valor por defecto), pero **la configuración guardada con `hcsr04` o `servo` no la entiende el backend antiguo**. Para revertir: restaura el respaldo de la base (o guarda de nuevo una configuración con el hardware antiguo) y despliega la imagen anterior.

## 5. Qué se verificó
| Área | Cómo | Resultado |
|---|---|---|
| Backend | 56 pruebas con Postgres, Redis y base de respaldo reales (0 saltadas) | pasan |
| Actualización | base creada con el código v19 (config antigua + 30 lecturas) → backend nuevo + 21 pruebas de humo (validaciones, claves, fórmulas maliciosas, topes, historial) | pasan |
| Extremo a extremo | navegador real contra el backend real: en vivo, simulación, 6 pantallas de administración, guardado persistente, cuaderno ejecutando Python, celular | 26/26, sin errores de consola |
| Frontend | tipos, 13 pruebas, compilación; detector de diseño en 7 rutas | 0 hallazgos |
| 3D | PC con GPU simulada: monta el lienzo sin errores (antes y después de actualizar `drei`) | sin errores |
| Firmware | lógica de configuración, servo, relés, ultrasonido, OLED y tiempos largos compilada en PC con ArduinoJson real | pasa |

## 6. Sin verificar (necesita tu prueba)
- **Compilación del firmware con el core de Arduino/ESP32** y todo el **hardware real** (servo, OLED, ultrasonido, relés, divisor del ECHO).
- **El 3D visualmente** (mi entorno no tiene GPU): se comprobó que monta sin errores, no cómo se ve.
- **Comandos con MQTT real**: sin broker en mi entorno se verificó el bloqueo y los mensajes de error, no la entrega al ESP32 ni el apagado inmediato de punta a punta.
- **Despliegue en Docker/Railway** y la **APK de Android**: se revisaron los archivos (compose válido, Python 3.12, reglas ACL de MQTT que ya cubren `cmd/#`), pero no se construyeron las imágenes.
- **Rendimiento con tráfico real** y varios dispositivos.
