# Guía de impresión · Maqueta Simón v34

Todos los STL de `imprimir/` están en milímetros reales (escala 0,5 ya aplicada), orientados para imprimir tal cual y partidos para caber en una cama de 250 mm.
Los componentes comprados (bomba, sensores, servo, acetato, O-ring, tira LED) no se imprimen. **Nada de esto se ha impreso todavía: valida el primer encaje con la bandeja o el depósito antes de imprimir todo.**

## Ajustes generales
- Material: **PETG** en todo lo que toca agua (contenedor, bandeja, riego, depósito, tapas, conector, niple, tapones, cajita de la bomba). PLA sirve para la lámpara, la caja electrónica y las estacas.
- Altura de capa 0,2 mm · 3–4 perímetros (mín. 1,2 mm de pared) · relleno 20 % · boquilla 0,4 mm.
- Piezas húmedas: flujo 100–105 % y 4 perímetros; las roscas y el conector, 100 % de relleno si la pieza es pequeña.
- Pegar las mitades con cianoacrilato o epoxi; las uniones del contenedor y del depósito se sellan con silicona.

## Piezas
| Archivo | Cant. | Orientación | Soportes | Notas |
|---|---|---|---|---|
| contenedor_principal_mitad_A / _B | 1 + 1 | Abierto hacia arriba | Solo bajo el abultamiento del desagüe y los dinteles de las ventanas | Rebajes de acetato por dentro; OLED con rebaje por fuera |
| labio_mitad_A / _B | 1 + 1 | Plano | No | Cubre el borde y sujeta los cables sobre el peine |
| bandeja_tierra | 1 | Boca arriba (piso sobre la cama, ya orientada) | No | El riego es una pieza aparte; voladizos menores al 2 % del área (agujeros redondos) |
| riego_tierra | 1 | Boca abajo (ya girada, cara plana en la cama) | No | Apoya en el asiento de la pared izquierda |
| niple_riego | 1 | Acostado | No | Entra a presión en el colector; 100 % de relleno |
| deposito_agua | 1 | Abierto hacia arriba | Solo bajo el puerto trasero | Suelo inclinado hacia la salida |
| tapa_deposito, tapon_llenado | 1 + 1 | Plano | No | |
| conector_deposito, tapon_trasero | 1 + 1 | De pie | No | Usa uno u otro en la salida trasera; O-ring de cordón 1,6 mm, Ø interior 10 mm |
| cajita_bomba, cajita_bomba_tapa | 1 + 1 | Abierta hacia arriba / plana | No | Para la bomba DC30A-1230 (2 agujeros traseros: entrada y salida); verifica sus medidas |
| estaca_ldr_x4 | 4 | De pie | No | Rosca paso 3 mm |
| tornillo_mano_x2 | 2 | De pie, perilla arriba | No | Rosca gruesa paso 2 mm |
| soporte_ultrasonido | 1 | Plano | No | Se pega a la tapa del depósito |
| canaleta_cables, peine_cables | 1 + 1 | De pie / plano | No | El peine va en la muesca de la pared trasera |
| caja_electronica, caja_tapa | 1 + 1 | Plano | No | |
| lampara_cuerpo_mitad_A / _B | 1 + 1 | Piso abajo (las 2 orejas de bisagra quedan en el borde trasero) | No (la cápsula del servo queda a ras del piso; el techo de la cápsula es un puente de ~23 mm: imprimir con ventilación o añadir soporte) | Canal continuo para tira LED en todo el contorno |
| lampara_tapa_mitad_A / _B | 1 + 1 | Boca abajo: cara superior plana sobre la cama, faldón y nudillos hacia arriba (ya orientada) | No | Sin soportes: nudillos y oreja quedan al ras de la cara superior; el agujero del eje (Ø3,6) es horizontal y puentea sin problema |
| biela_tapa | 1 | Acostada (plana) | No | Barra de 1,8 mm con 2 agujeros Ø2,4; imprimir 2 de repuesto, es la pieza que más se desgasta |
| lampara_poste, lampara_union | 1 + 1 | Poste acostado | No | Canal interior para el cable |

## Montaje en seco antes de pegar
1. Probar bandeja y riego dentro del contenedor, y el niple por los dos agujeros traseros.
2. Probar el depósito con su conector, el O-ring y el tapón.
3. Roscar las 4 estacas en las escuadras y los 2 tornillos de mano contra el poste.
4. Montar la tapa de la lámpara: alinear los nudillos de la tapa con las orejas de la copa y pasar por cada lado un pasador (varilla rígida Ø3 mm × ~46 mm: clavo o alambre; pieza `pasador_bisagra`, no se imprime). Comprobar que abre hasta ~105° hacia atrás como una caneca y que no roza.


## Mecanismo de apertura de la tapa (servo en la base)
- El servo SG90 va **fijo en la cápsula** pegada a la pared trasera de la copa (mitad +X), entrando por la cara +X; las orejas se atornillan a la cara de la cápsula (2 tornillos de los que trae el servo, guías Ø1,5).
- Brazo del servo (el de plástico que trae) a 12 mm del eje → **biela_tapa** → oreja de la tapa. Pasadores: 2 trozos de alambre/clavo Ø2 mm (de ~4 mm el del brazo y ~7 mm el de la oreja). Ver `vista_mecanismo.png`.
- Giro: para abrir los 105° de la tapa el servo solo gira ~45° (se ve en `vista_mecanismo.png`, que genera `esquema_mecanismo.py`). Programar el servo entre esos dos extremos (con el sentido que corresponda) y probar sin tapa primero.
- Torque: el SG90 (~1,6 kg·cm) puede quedar justo; si la tapa pesa mucho, usa un MG90S (misma caja, engranajes metálicos) o imprime la tapa con poco relleno.

## Revisión de integridad (v35)
- Las 29 piezas impresas y las de referencia son sólidos válidos de un solo cuerpo; las mallas STL son herméticas, sin triángulos degenerados ni caras sueltas. La rosca de la estaca LDR era antes un sólido aparte solapado (se veía raro en FreeCAD); ahora está fusionada.
- Piso de la lámpara hueco (aro de 7,5 mm + puente trasero para el poste) para que entre luz natural; la tira LED va solo en el canal del contorno.
- La pared trasera de la copa tiene una ranura por donde pasan la oreja de la tapa y la biela al abrir; ahí la tira LED tiene un salto de ~6 mm.
