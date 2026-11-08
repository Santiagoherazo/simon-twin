# Modelo del ciclo de cultivo

Archivo: `backend/app/cropmodel.py` (motor `CropEngine`), perfiles en `backend/app/profiles/*.yml`.
**Es un modelo de prototipo basado en literatura agronómica general, no una predicción agronómica validada.** Los valores son aproximaciones; ajústalos con datos reales (panel admin → Parámetros del cultivo, o en la simulación).

## Qué simula (paso horario)
| Fenómeno | Cómo |
|---|---|
| Crecimiento | Curva potencial en S según grados-día (GDD); biomasa real vs potencial → vigor |
| Estrés hídrico | Agua útil del suelo vs umbral de estrés del cultivo; Kc por etapa (FAO-56) |
| Encharcamiento / hipoxia | θ ≥ capacidad de campo + 70 % de (saturación − CC) acumula horas de hipoxia (más rápido con suelo cálido); al pasar el umbral hay daño radicular permanente; desnitrificación 3 %/día saturado |
| Pudrición de raíz | Acoplada a hipoxia + Pythium/Phytophthora |
| Drenaje | Constante de drenaje por suelo (`drain_tau_h`) × drenaje del recipiente (bueno 1, regular 3, malo 8, sin salida 40) |
| Temperatura | Calor, frío, helada, calor reproductivo (aborto de flor), frío en floración, GDD |
| Luz / VPD | Déficit de luz, quemadura, estrés por VPD alto/bajo |
| Nutrientes | Extracción N/P/K proporcional al crecimiento; eventos `fertilize` |
| pH y salinidad | Factor por pH; Maas–Hoffman con efecto de concentración al secarse |
| Fisiológicos | Pudrición apical (Ca/agua irregular), espigado (lechuga/espinaca), tip-burn |
| Sanidad | Botrytis, tizón (días de Hutton), oídio, damping-off; ácaros, pulgones, mosca blanca; controles `disease_control`/`pest_control` |
| Salida | Rendimiento proyectado, salud, eventos con causa/consecuencia/acción, intensidades visuales (amarillo, podrido, quemado, enano, manchas, muerto) |

## Uso en vivo
`/devices/{id}/state` reproduce las últimas 14 días de telemetría por el motor y agrega alertas explicadas (qué pasó, por qué, qué hacer) y el bloque `health`.
`/devices/{id}/recommend` simula el ciclo completo por cada cultivo con las condiciones del dispositivo y los ordena por rendimiento proyectado (es un **ranking relativo**).
`/devices/{id}/optimize` busca el mejor riego (24 simulaciones: umbral de agua útil × lámina).

## Fuentes de referencia
FAO-56 (Kc, agotamiento permitido), FAO-29 y Maas–Hoffman (salinidad), OMAFRA (tomate, pimentón), Purdue, Manitoba Agriculture, VegCrops Hotline (tizón/Hutton), Cornell (DLI/tip-burn), Virginia Tech (pH).
Cada YAML de cultivo incluye `sources`. **Algunos valores salen de memoria o están derivados** (p. ej. Kc por etapa, parámetros de botrytis, GDD de madurez): verifícalos antes de usarlos fuera del contexto académico.

## Límites conocidos
- Raíces y pudrición no se dibujan en 3D (solo tinte y caída de hojas).
- Cuadernos: el kernel ejecuta Python arbitrario en el contenedor del backend; requiere `requirements-ml.txt` (el Dockerfile lo instala; `--build-arg WITH_ML=0` lo omite).


## Modelo en vivo
En Modelos → «Activar en vivo» (el cuaderno debe estar ejecutado, con `@simon.register`). Cada vez que se calcula el estado, el servidor llama `predict(row)` con las lecturas: sus `simon.alert()` aparecen en las alertas y si devuelve `{"overrides": {"vwc_pct": 31}}` esa lectura se ajusta en el estado (no se toca la telemetría guardada). Si el kernel se cae o tarda más de 5 s, el estado sigue funcionando y se informa en `state.models`. Tras reiniciar el servidor hay que volver a ejecutar el cuaderno.

## Gemelo 3D (qué reacciona a qué)
| Dato | Efecto en la escena |
|---|---|
| Humedad del suelo / agua útil | Color y brillo del sustrato, marchitez |
| Aire < 4 °C | Escarcha sobre el sustrato |
| Aire > 33 °C o calefactor encendido | Ondas de calor |
| Humedad del aire > 82 % o humidificador | Bruma |
| EC > ~2,2 dS/m (2200 µS/cm) | Costra blanca de sales |
| Ventilador encendido | La planta se mece más rápido y fuerte; aspas giran |
| Actuador de luz | La lámpara sigue su estado real (si no hay, sigue el día) |
| Válvula, calefactor, humidificador, otros | Un modelo por actuador (banco a la derecha) con LED y nombre |
| Todos los sensores, indicadores y variables personalizadas | Tablero con valor y color de estado (bajo/ok/alto) |
| Bomba, tanque | Modelos propios (ya existían) |
Los actuadores se clasifican por clave o nombre (ventilador/fan, luz/lámpara/led, calefactor/heater, humidificador/nebulizador, válvula/electroválvula; el resto es genérico).
Límite: el tablero y el banco no se muestran en AR; la escarcha puede quedar tapada por las hojas según el ángulo.

## Comparar con lo vivido (`GET /devices/{id}/identify`)
Pasa las últimas 14 días reales de lecturas por el motor de **cada** cultivo y ordena por salud estimada. Avisa si otro cultivo habría sufrido bastante menos que el configurado. **No detecta la especie plantada**: sin sensores sobre la planta eso no es posible; solo indica qué cultivos toleran mejor lo que ha vivido el dispositivo.

## Matriz de luz (4 LDR)
En el 3D, cada LDR aparece en su esquina del sustrato y brilla según su lectura; entre ellas se dibuja un mapa de luz interpolado (azul = sombra, amarillo = sol). Las LDR miden luz relativa (%), no lux: el valor `lux` que usa el modelo se estima como media × 400 hasta que se calibre.
