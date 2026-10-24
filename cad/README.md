# Matera Simón: modelo CAD y archivos para imprimir

## Qué hay
- `imprimir/*.stl` — piezas listas para subir a un servicio de impresión (una por archivo, ya orientadas para imprimir).
- `imprimir/todas_las_piezas.step` — las mismas piezas en STEP (FreeCAD: Archivo → Abrir).
- `referencia/*.stl` — todo el ensamble (sustrato, sonda, controlador, LEDs, nivel de agua). **No se imprime**, sirve para ver cómo encaja.
- `simon_matera.step` / `.stl` — ensamble completo en un solo archivo.
- `simon_matera.py` — script paramétrico (CadQuery).
- `vista_previa.png`, `vista_imprimir.png` — vistas de referencia.

## Escala (importante)
Por defecto el script genera una **maqueta a escala 0.4**: el cuerpo mide 232 × 104 × 86 mm y cabe en una cama de 250 mm (la mayoría de servicios, p. ej. Bambu/Prusa de 250 mm).
Para otra escala o cama:

    pip install cadquery
    ESCALA=1 CAMA_MAX=300 python simon_matera.py

El script parte en mitades (con pasadores Ø8) lo que no cabe. **A escala 1 con cama de 300 mm aún no cabe todo**: las mitades del cuerpo salen de 302 mm, los paneles de la lámpara de 310 mm y el poste de 511 mm (no se parte). Para tamaño real hace falta una cama ≥ 320 mm, o un servicio industrial (MJF/SLS), o ajustar el script. Esto no está resuelto.

## Piezas impresas (escala 0.4)
| Archivo | Medida (mm) | Nota |
|---|---|---|
| cuerpo | 232 × 104 × 86 | con depósito sellado, rebajes para vidrios y base del poste |
| labio | 234 × 106 × 4 | borde superior |
| lampara_panel | 248 × 80 × 4.8 | |
| lampara_poste | 204 × 12 × 13.6 | se imprime acostado; espiga de 80 mm sin escalar |
| lampara_union | 20 × 16 × 10 | |
| tapon_llenado | 22 × 22 × 11 | |
| nivel_marco | 21 × 2.4 × 60 | |

## Materiales y límites reales
- **PETG o ASA** (FDM) o **PA12** (MJF). No PLA si va al sol o a mojarse.
- Una pieza FDM **no es estanca por defecto**. El depósito necesita sellado (resina epoxi apta para agua, o un forro/bolsa interna) antes de llenarlo.
- A escala 0.4 las paredes del depósito quedan de ~1.6 mm: delgadas para FDM. Si el servicio lo avisa, sube `WALL` en el script o usa una escala mayor.
- Los vidrios de las ventanas (ver rebajes de 2.5 mm) se compran aparte: lámina de PETG/acrílico cortada a medida; a esta escala la holgura es de ~1 mm, revísala con una pieza de prueba.
- Sustrato, sonda, controlador, LEDs y agua **no se imprimen**.

## Qué no se probó
No se abrió en FreeCAD ni se envió a ningún servicio de impresión; la geometría se validó en CadQuery (sólidos válidos, STEP reimportable, piezas dentro de la cama). Antes de pedir la pieza final, pide una pieza de prueba o revisa el STL en el visor del servicio.
