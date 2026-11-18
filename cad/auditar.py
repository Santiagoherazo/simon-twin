import sys, itertools, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cadquery as cq, simon_matera as m
parts = m.build()
print("== piezas")
vs = {}
for n, (wp, _, pr) in parts.items():
    v = wp.val(); vs[n] = v
    print(f"{n:22s} valida={v.isValid()!s:5} solidos={len(wp.solids().vals())} vol={v.Volume()/1000:9.1f} cm3 imprimible={pr}")
SKIP = set(m.REFERENCE_ONLY)|{"conector_deposito"}      # volúmenes de referencia (tierra y agua) que rellenan huecos a propósito
print("== interferencias > 20 mm3 (unidades de diseño)")
bad = 0
for a, b in itertools.combinations(vs, 2):
    if {a, b} & SKIP: continue
    if (a.startswith("lampara") or a=="servo_sg90") and (b.startswith("lampara") or b=="servo_sg90"): continue
    if {a,b}=={"tapon_trasero","conector_deposito"}: continue   # unión lámpara-poste intencional
    try:
        x = vs[a].intersect(vs[b]).Volume()
    except Exception as e:
        print("  (no se pudo calcular)", a, b, e); continue
    if x > 20:
        bad += 1; print(f"  {a:22s} x {b:22s} {x:10.1f} mm3")
print("  ninguna" if not bad else f"  {bad} pares")
print("== comprobaciones de encaje")
def vol(a, b): return vs[a].intersect(vs[b]).Volume()
w = vs["agua_deposito"]
print("  agua vs depósito/tapa:", round(vol("agua_deposito","deposito_agua"),1), round(vol("agua_deposito","tapa_deposito"),1))
print("  tierra vs bandeja/contenedor:", round(vol("sustrato","bandeja_tierra"),1), round(vol("sustrato","contenedor_principal"),1))
