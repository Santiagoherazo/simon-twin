"""Exporta STL para Tinkercad: carpeta ensamblado/ (cada pieza ya en su posición, en mm a ESCALA 0.5) y explosionado/ (las mismas piezas separadas).
Importa todos los STL de una carpeta a la vez (Importar -> arrastrar) con unidades en mm y escala 100 %.
La bandeja va SIN la reja de huecos (versión ligera; Tinkercad se atasca con 1200 agujeros). La versión con reja está en imprimir/."""
import os, sys, shutil
os.environ["REJA"] = "0"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cadquery as cq, simon_matera as m
S = m.ESCALA
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "tinkercad")
shutil.rmtree(out, ignore_errors=True)
for d in ("ensamblado", "explosionado"):
    os.makedirs(os.path.join(out, d))
P = m.build()
A, B = 300.0, 160.0
dz = dict(labio=60, cajita_bomba=0, cajita_bomba_tapa=140, tapon_trasero=0, conector_deposito=0, canaleta_cables=60, lampara_tapa=380, servo_sg90=330, marco_suelo=0, marco_nivel=B, lampara_cuerpo=330, lampara_union=330, lampara_poste=150,
          deposito_agua=B, bomba_referencia=0, tapa_deposito=B + 160, tapon_llenado=B + 240, caja_tapa=120, bandeja_tierra=A, sonda_humedad=A,
          estaca_ldr_NO=A, estaca_ldr_NE=A, estaca_ldr_SO=A, estaca_ldr_SE=A)
dx = dict(cajita_bomba=300, cajita_bomba_tapa=300, bomba_referencia=300, deposito_agua=150, tapa_deposito=150, tapon_llenado=150, tapon_drenaje=-130)
dy = dict(marco_nivel=-110, marco_suelo=-110, tapon_trasero=150, cajita_bomba=0, pantalla_oled=-170, caja_electronica=170, caja_tapa=170)
skip = {"sustrato", "agua_deposito", "acetato_nivel", "acetato_suelo", "lampara_leds"} | set(m.REFERENCE_ONLY) - {"bomba_referencia","pantalla_oled","servo_sg90"} | set(m.HIDDEN_BY_DEFAULT)      # volúmenes de referencia / vidrios
n = 0
asm_all, exp_all = [], []
for name, (wp, _, _) in P.items():
    if name in skip:
        continue
    shp = wp.val().scale(S)
    m.export_stl(shp, os.path.join(out, "ensamblado", f"{name}.stl"), 0.05, 0.3)
    ex = shp.translate(cq.Vector(dx.get(name, 0) * S, dy.get(name, 0) * S, dz.get(name, 0) * S))
    m.export_stl(ex, os.path.join(out, "explosionado", f"{name}.stl"), 0.05, 0.3)
    asm_all.append(shp); exp_all.append(ex)
    n += 1
m.export_stl(cq.Compound.makeCompound(asm_all), os.path.join(out, "jardin_inteligente_ensamblado.stl"), 0.05, 0.3, union=False)
m.export_stl(cq.Compound.makeCompound(exp_all), os.path.join(out, "jardin_inteligente_explosionado.stl"), 0.05, 0.3, union=False)
open(os.path.join(out, "LEEME.txt"), "w", encoding="utf-8").write(
"""JARDÍN INTELIGENTE SIMÓN — archivos para Tinkercad (mm, escala 0.5 de la matera)

1) Prueba rápida: Tinkercad -> Crear nuevo diseño -> Importar -> jardin_inteligente_ensamblado.stl
   (o ..._explosionado.stl). Unidades: milímetros, escala 100 %. Llega como UNA sola pieza.
2) Para mover/editar piezas por separado: importa TODOS los STL de la carpeta ensamblado/ (cada uno ya viene en su posición)
   o de explosionado/ (separados). Selecciona varios archivos a la vez al importar.
- La bandeja va SIN la reja de huecos (1200 agujeros atascan Tinkercad). La versión con reja está en imprimir/bandeja_tierra.stl.
- Tinkercad acepta STL hasta 25 MB por archivo: todos pesan menos de 1 MB.
- Piezas azules/oscuras de referencia (bomba, pantalla OLED) son volúmenes para comprobar encajes; no se imprimen.
""")
print(n, "piezas")
for d in ("ensamblado", "explosionado"):
    tot = sum(os.path.getsize(os.path.join(out, d, f)) for f in os.listdir(os.path.join(out, d)))
    big = max(os.listdir(os.path.join(out, d)), key=lambda f: os.path.getsize(os.path.join(out, d, f)))
    print(d, f"{tot/1e6:.1f} MB; mayor: {big} {os.path.getsize(os.path.join(out, d, big))/1e6:.1f} MB")
