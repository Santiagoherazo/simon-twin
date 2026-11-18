# Matera Simón: modelo CAD en 3 piezas (v25)

Generado con `python simon_matera.py` (CadQuery). Todo en mm; la matera es la misma del gemelo 3D.
Escala por defecto **0.5** (`ESCALA=1.0 python simon_matera.py` para tamaño real). Las medidas de los componentes comprados
(bomba, sensores, caja electrónica) son reales y **no** se escalan.

## Las 3 piezas

| # | Pieza | Color en las imágenes | Qué hace |
|---|-------|----------------------|----------|
| 1 | `contenedor_principal` (2 mitades con clavijas) | morado | Recoge todo. Abajo queda la **cuenca** que recibe el agua que gotea; 12 postes sostienen la bandeja; un divisor separa el hueco del depósito; cajón fijo para el poste de la lámpara. |
| 2 | `bandeja_tierra` | negro | Recipiente de la tierra con huecos de drenaje Ø7 mm (escalado: 3,5 mm), ventana con acrílico y 2 asas. **Se levanta sin herramientas** y deja la cuenca a la vista para sacar el agua. |
| 3 | `deposito_agua` + `tapa_deposito` + `tapon_llenado` | rojo | Depósito con **plataforma-soporte para la bomba ya impresa**, ventana de nivel con acrílico, boca de llenado y asa. Se levanta como una sola pieza. |

Más: `labio` (marco del borde, con ranura para cables), lámpara (panel, poste, unión), 4 estacas-tornillo para la LDR (rosca helicoidal paso 3 mm, Ø10 mm; se enroscan en la tierra, cabeza con 2 planos para girarlas), caja del ESP32 + 2 relés (con ventana para el DHT11), **colocada detrás de la matera** para que no se vea desde el frente; los cables suben por la ranura del labio en la parte trasera.

Ciclo del agua: la bomba sube agua del depósito por una manguera de 10 mm (sale por la tapa) y la suelta sobre la tierra → gotea por la bandeja
→ cae a la cuenca del contenedor. Para devolver el agua: levantar la bandeja, sacar el agua de la cuenca y llenarla por la boca del depósito.
(No hay retorno automático; si lo quieres, es un agujero con tubo por el divisor — dímelo.)

## Cambios de la v25b
- **Fondo de la bandeja en reja**: ~1200 huecos Ø2 mm con paso 4 mm (puentes de 2 mm) en todo el piso; es lo más fino que imprime una boquilla de 0,4 mm. La tierra se escaparía por huecos de 2 mm: pon encima una malla/geotextil o papel filtro.
- **Ducto de riego** (`ducto_riego`): colector con 4 ramales de goteo, 9 agujeros por ramal (de Ø1,0 a Ø1,6 mm: más grandes hacia el extremo lejano para repartir parejo), púa vertical para manguera de **8 mm interior** y 4 patas que se clavan en la tierra. Va por encima de la tierra; **sácalo y suelta la manguera antes de levantar la bandeja**. Calibra los agujeros con tu bomba (el caudal real no está medido).
- **Lámpara centrada**: el poste pasa al centro (x = 0) detrás de las plantas; el corte del contenedor se movió a x = 60 para no partir el cajón del poste ni las ventanas.
- **Desagüe de la cuenca** (lado izquierdo): suelo inclinado 10 unidades (5 mm a escala 0.5) hacia la izquierda, agujero Ø12,6 con rosca interna Ø12 paso 2 y `tapon_drenaje` roscado con ranura para destornillador de pala. Usa arandela de goma o cinta de teflón. El `tapon_llenado` del depósito también tiene ranura para destornillador.
  Interpreté "bandeja" como la **cuenca del contenedor** (donde se estanca el agua); la bandeja de la tierra ya drena por toda la reja. Si querías el desagüe en la bandeja de tierra, dímelo.
- **Pantalla OLED 0.96" I2C** (la más pequeña, como la de tu circuito) centrada en el frente (x = 0, a media altura = "los ojos"): nicho exterior de 3,2 mm donde se pega con el vidrio hacia afuera, abertura en cruz detrás para pines y cables, y un canal hueco en la bandeja que sube hasta el borde para sacar el cable. Medidas supuestas: placa 27,3 × 27,8 mm; verifícalas con tu módulo.
- **Tinkercad**: carpeta `tinkercad/` (ver `LEEME.txt`): `jardin_inteligente_ensamblado.stl` y `..._explosionado.stl` (una sola pieza cada uno) y las piezas sueltas posicionadas. La bandeja va sin reja (versión ligera).
- `vista_explosionada.png`: despiece de todo el jardín.

## Imágenes
`vista_explosionada.png` (todo separado) · `vista_ensamble.png` (todo montado) · `vista_3_partes.png` (despiece) · `vista_corte.png` (corte longitudinal) · `vista_nivel_exterior.png` (ventana de nivel).

## Archivos
- `imprimir/` STL listos (escalados, orientados, partidos). `referencia/` STL del ensamble (tamaño real de la matera, con tierra, agua y bomba como referencia, no se imprimen).
- `simon_matera.step` ensamble para FreeCAD. `auditar.py` revisa validez e interferencias; **`medidas.py` revisa holguras reales, acrílicos, paredes mínimas, cama y que la bandeja y el depósito salgan en vertical** (resultado actual: todo OK).
- `historial/simon_matera_v24.py` versión anterior (cuerpo único). `modular/` y `simon_modular.py`: torre modular v23 (alternativa, sin auditar).

## Cómo encaja (a escala 0.5)
- Holgura entre piezas desmontables: **0,5 mm por lado** (parámetro `CL`). Refuerzo interior de 1,5 mm (`BOSS`) alrededor de las ventanas para que el rebaje del acrílico deje un marco de 1,6 mm. Paredes: contenedor 6 mm, bandeja y depósito 3 mm.
- Cuenca bajo la bandeja: ~11 mm de profundidad (≈ 0,3 L). Postes de 6 × 6 mm.
- Bomba (101,6 × 53,1 × 66,8 mm, Ø cuerpo 45,4 mm): cabe dentro del depósito (auditoría: 0 mm³ fuera de la cavidad). Plataforma 108 × 52 mm con topes y 4 ranuras para bridas.
- Acrílico de 2,5 mm a escala 0.5: ventana de la tierra **94 × 71 mm**, ventana de nivel **29 × 74 mm** (esquinas redondeadas; córtalo 1 mm más chico si dudas).
- Bandeja 206 × 117 mm, depósito 67 × 117 mm: caben en cama de 250 mm; contenedor y labio se parten en x = 0.

## Depósito: solo 2 aberturas de agua (v36)
- Entrada: boca de llenado en la tapa. Salida: puerto trasero hacia la bomba (conector o tapón). Depósito con sensor ultrasónico como en v35.

## Qué NO se ha probado (honesto)
- Las roscas (estacas y tapón de drenaje) son de diseño; el tapón y su agujero interfieren 4,5 mm³ en los flancos: prueba que enrosque, y si aprieta imprime el agujero a 0,1 mm más grande (`DR_MAJOR + 0.3`).
- La rosca de las estacas es de diseño y depende de la impresora (el paso 3 mm con boquilla 0,4 mm suele salir bien, pero en tierra suelta agarra poco; pruébala).
- Nada impreso ni probado con agua. Paredes de 3 mm y la tapa del depósito (pegar con silicona apta para agua) son lo primero que revisaría.
- La forma de la bomba es una envolvente tomada de los STL; la **posición de la salida** (10 mm del extremo del rodete, +12 mm del eje) y cómo apoya sobre la plataforma hay que verificarlas con tu bomba impresa (parámetros `PUMP_*` y `PUMP_C`).
- El DHT11 va en la caja electrónica (detrás de la matera): mide el aire de la caja, no el de las plantas; si prefieres otro sitio hay que decidirlo.
- Para imprimir el depósito sin soportes conviene ponerlo con la abertura hacia arriba (la tapa se imprime aparte).

## Revisión de modelamiento (v25b)
- Las 19 piezas de `imprimir/` y todas las de `tinkercad/` son mallas herméticas, 1 cuerpo, orientación consistente, 0 triángulos degenerados (`trimesh`).
- Todos los sólidos BRep son válidos; única interferencia: rosca del tapón de drenaje contra su boquilla (~4.5 mm³ reales, contacto de flancos; si aprieta, ampliar el taladro 0.1 mm con `DR_MAJOR+0.3`).
- `medidas.py`: holguras, espesores mínimos, cama 250 mm y extracción vertical de bandeja/depósito → todo OK.
- Sin imprimir ni probar con agua; posición de la salida de la bomba y dimensiones de HC-SR04/OLED son supuestas.

## Cambios v27
- **Base del contenedor limpia:** sin postes. Piso único con caída de 12 u (6 mm) hacia el desagüe; la bandeja se apoya en un reborde bajo sus paredes y 2 rieles paralelos al flujo del agua. El extremo izquierdo queda libre.
- **Acetato:** rebaje de 0,5 mm en la cara interior de las ventanas de la bandeja y del depósito (mismo tamaño que la ventana). BOSS 3→4 para conservar el marco.
- **OLED SSD1306 0.96":** 4 taladros piloto M2 (Ø1,8 × 2,2 mm), separación supuesta 23,5 × 23,8 mm (verifica con tu módulo).
- **Depósito:** 2 conectores traseros roscados M12×2 con púa para manguera 8 mm interior (como las minibombas): A = desagüe (abajo), B = salida de la bomba (arriba). Se desenroscan antes de sacar el depósito. Ya no hay agujero de manguera en la tapa.
- **Bomba:** 2 arcos de asiento que abrazan el cuerpo Ø45,4 y canal para el pie; las bridas pasan por las ranuras.
- **Riego:** no se integra a la bandeja (los ramales quedarían puenteando 200 mm en el aire al imprimir y la bandeja no saldría). La púa mira hacia atrás: la manguera sale por una muesca en la bandeja, la pared trasera y el labio, y baja por detrás hasta el conector B.
- **Cables:** salen bajo el labio (canal) y bajan por la canaleta pegada a la pared trasera hasta la ranura de la caja electrónica, que ahora está detrás, a la izquierda.
- Mallas: 22 STL de imprimir y las carpetas de Tinkercad, herméticas.

## v27b (v28)
- Cajita de la bomba externa junto al depósito (tapa, púas de entrada/salida).
- Puerto trasero del depósito con tapón ⇄ conector de manguera (rosca M12×2): sirve de seguro entre contenedor y depósito.
- Riego integrado a la bandeja (se imprime boca abajo, sin soportes); púa trasera por una muesca (también en el labio).
- 4 escuadras de esquina en la bandeja (no en la tierra) con rosca para las estacas de las LDR.
- Rebajes de acetato por la cara interior; marcos en todas las ventanas; techo + junta alrededor de la OLED.
- Sensor de humedad conservado, movido a la pared trasera de la bandeja.
- Lámpara: cuerpo hueco con 2 canales para tiras LED + 11 agujeros de LED, cable por el poste, 2 puertas (bisagra) accionadas por servo SG90 (varilla no modelada).
- Piezas y ensambles: ASSEMBLIES en simon_matera.py; visor/visor.html (interactivo); simon_matera.step (ensamble anidado).

## v29
- Acetato por la cara interior en contenedor, bandeja y depósito (ventana con 6 u de margen + rebaje); OLED con rebaje de acetato por fuera. Sin marcos de ventana ni techo/nicho OLED en la bandeja.
- Suelo del contenedor liso con caída de 12 mm hacia el desagüe (sin anillo perimetral; quedan 2 rieles + tope); suelo del depósito inclinado hacia la salida trasera.
- Cables: peine pasacables (6 canales, abierto por arriba) en la pared trasera + canaleta de 45 mm hasta la caja; los cables de la lámpara salen por la base del poste hacia la canaleta.
- Riego separado (riego_tierra, se imprime boca abajo) con canal en U y soporte_manguera de la misma forma que la púa.
- 2 tornillos de mano (rosca gruesa paso 2) detrás del poste.
- Depósito: conector con collar liso y ranura para O-ring (cordón 1,6 mm); rosca más profunda.
- Cajita de la bomba rehecha para la minibomba DC30A-1230 (55 x 41 x 36 mm, medidas de catálogo: verifica con tu pieza).
- Lámpara: capota que gira 0-90 sobre el borde frontal.

## v30
- Lámpara: cuerpo fijo (copa) con canal continuo para tira LED en todo el contorno interior y canales + 11 huecos de LED en el piso; la tapa oscura sube 35 mm guiada por 2 pines; servo sobre la tapa con brazo que empuja una columna fija (mecanismo conceptual).
- Riego: sin ranura en U ni soporte cuadrado; agujeros redondos en las paredes y un niple con base redonda del mismo diámetro que la púa (se retira para levantar el riego).
- Poste: cajón con menos holgura (0,15 mm por lado) más los 2 tornillos de mano.
- Se añade GUIA_IMPRESION.md (también dentro de imprimir/).
- Tapa de la lámpara con faldón que cubre el borde de la copa (estilo tapa de caja).

## v32
- Lámpara: la tapa abre como la de una caneca: 2 bisagras en el borde trasero (nudillos en la tapa, orejas en la copa, pasador Ø3 mm), giro 0-105° y queda recostada hacia atrás. El faldón solo cubre el frente y los lados.

## v33
- Cajita de la bomba simplificada: solo 2 agujeros redondos traseros (entrada y salida de manguera); sin ranura, topes ni paso de cable.
- Lámpara: piso liso (sin huecos ni canales de LED); las luces van solo en el canal del contorno interior.

## v34
- Mecanismo de apertura rehecho: el servo queda FIJO en la base (cápsula trasera de la copa) y abre la tapa con brazo + biela_tapa + oreja de la tapa (biela-manivela). Barrido 0-105° verificado sin choques en medidas.py (0, 30, 60, 90 y 105°).
- Nuevas piezas: biela_tapa (impresa), brazo_servo, pasador_servo y pasador_tapa (referencia/alambre Ø2).

## v35
- Revisión de integridad y de imprimibilidad: rosca de la estaca LDR fusionada en un solo sólido; paredes finas de la bisagra y del poste corregidas; tapa de la lámpara rediseñada para imprimir plana (bisagra en el borde recto, nudillos y oreja al ras); bandeja boca arriba; piso de la lámpara hueco; ranura en la pared trasera para la oreja de la tapa.

## v36
- v36: caja de la bomba con solo 2 huecos (entrada Ø13 y salida Ø9, ahora separados por 2,5 mm: antes se fusionaban en uno) y tapa lisa sin ranuras. Fuera de la caja el 3.er puerto de agua es el trasero del depósito (manguera hacia la entrada de la bomba).
- v37: muesca para el cable de la bomba (4 mm de ancho, abierta por arriba; la tapa la cierra y deja un ojal) en la pared del extremo opuesto a las mangueras.
- v38: rampa a 45° bajo los pilares de las LDR (sin islas flotantes en la bandeja); carpeta step/ con un STEP por pieza (sólidos reales, verificados al reabrirlos) para AutoCAD/FreeCAD: usar estos en vez de los STL.
- v39: muesca del cable de la bomba rehecha: 'U' redondeada Ø5 mm solo en el borde superior (antes una ranura alta y angosta); la tapa la cierra formando un ojal liso.
- v40: quitadas las 2 clavijas de la caja de la bomba y sus 2 huecos ciegos en el contenedor; la caja se pega con silicona/pegamento.
