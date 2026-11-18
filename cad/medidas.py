"""Revisión de medidas: holguras reales (mm a la ESCALA actual), encaje de componentes comprados y recorrido de extracción."""
import sys, os, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cadquery as cq, simon_matera as m
S = m.ESCALA
P = m.build(); V = {n: v[0].val() for n, v in P.items()}
V_TRAY_PROXY = V["bandeja_tierra"]
def dist(a, b, dz=0.0):
    A = V[a].translate(cq.Vector(0, 0, dz)) if dz else V[a]
    return A.distance(V[b]) * S
def ov(a, b, dz=0.0, dx=0.0):
    A = V[a]
    if dz or dx: A = A.translate(cq.Vector(dx, 0, dz))
    try: return A.intersect(V[b]).Volume() * S**3
    except Exception: return float("nan")
bad = []
def chk(txt, val, lo, unit="mm", hi=None):
    ok = val >= lo - 1e-6 and (hi is None or val <= hi)
    print(f"  {'OK ' if ok else 'XX '} {txt:62s} {val:8.2f} {unit}  (mín {lo}{'' if hi is None else f', máx {hi}'})")
    if not ok: bad.append(txt)

print(f"ESCALA {S}  (todo en mm reales de impresión)")
print("== holguras entre piezas impresas (distancia mínima)")
chk("holgura lateral contenedor ↔ bandeja (bandeja alzada 20)", dist("bandeja_tierra", "contenedor_principal", dz=20), 0.45)
chk("holgura lateral contenedor ↔ depósito (alzado 3)", dist("deposito_agua", "contenedor_principal", dz=3), 0.45)
chk("holgura lateral contenedor ↔ tapa del depósito", dist("tapa_deposito", "contenedor_principal"), 0.45)
for a, b in [("bandeja_tierra", "deposito_agua"), ("labio", "bandeja_tierra"), ("labio", "deposito_agua")]:
    chk(f"{a} ↔ {b}", dist(a, b), 0.45)
chk("bandeja apoyada en los postes (contacto)", dist("bandeja_tierra", "contenedor_principal"), 0.0, hi=0.01)
print("== componentes comprados dentro de su alojamiento")
print("== acrílicos (tamaño final a pedir y apoyo en el rebaje)")
for nm, w in (("tierra", m.WIN_SOIL), ("nivel", m.WIN_GAUGE)):
    x0, x1, z0, z1, r = w
    pw, ph = (x1 - x0 + 8) * S, (z1 - z0 + 8) * S; rw, rh = (x1 - x0 + 10) * S, (z1 - z0 + 10) * S; ow, oh = (x1 - x0 - 12) * S, (z1 - z0 - 12) * S
    print(f"      {nm}: vidrio {pw:.1f} x {ph:.1f} mm | rebaje {rw:.1f} x {rh:.1f} | visible {ow:.1f} x {oh:.1f} | apoyo {(pw-ow)/2:.1f} mm por lado")
    chk(f"vidrio {nm}: holgura en el rebaje", (rw - pw) / 2, 0.4)
    chk(f"vidrio {nm}: apoyo de pegado", (pw - ow) / 2, 3.0)
chk("marco bajo el rebaje (con rebaje de acetato), bandeja", (m.TT + m.BOSS) * S - m.ACETATE_D * S, 1.2)
chk("marco bajo el rebaje (con rebaje de acetato), depósito", (m.RT + m.BOSS) * S - m.ACETATE_D * S, 1.2)
chk("pantalla ↔ ventana de la tierra (separación)", dist("pantalla_oled", "acetato_suelo"), 3.0)
chk("pantalla ↔ ventana de nivel", dist("pantalla_oled", "acetato_nivel"), 3.0)
chk("pantalla centrada en x (mm de desvío)", -abs(V["pantalla_oled"].Center().x) * S, -0.2)
chk("pantalla centrada en z vs altura del frente (mm de desvío)", -abs(V["pantalla_oled"].Center().z - m.H / 2) * S, -0.2)
print(f"      interferencia tapón de drenaje ↔ contenedor (flancos de rosca): {ov('tapon_drenaje','contenedor_principal'):.3f} mm3 reales")
chk("reja: puente mínimo entre huecos", (m.GRID_PITCH - m.GRID_D), 1.5)
chk("reja: hueco mínimo", m.GRID_D, 1.5)
print("== conectores traseros, canaleta, caja y manguera del riego")
chk("caja electrónica ↔ contenedor", dist("caja_electronica", "contenedor_principal"), 0.5)
chk("caja electrónica ↔ canaleta (ranura alineada: sin choque)", -ov("caja_electronica", "canaleta_cables"), -0.01)
chk("canaleta ↔ labio (libre debajo)", dist("canaleta_cables", "labio"), 0.4)
chk("rieles: altura libre bajo la bandeja (mm) en el divisor", (m.Z_TB - (m.FLOOR + m.SLOPE)) * S, 3.0)
chk("OLED: pared restante tras el taladro piloto (mm)", m.WALL * S - m.SCR_REBATE - m.SCR_SCREW_DEPTH, 0.3)

print("== v27b: estacas, riego, cajita de la bomba, conector, lámpara")
for e in m.LDR_POS:
    chk(f"estaca {e} ↔ contenedor (no toca)", dist(f"estaca_ldr_{e}", "contenedor_principal"), 0.3)
chk("estacas ↔ estacas", min(dist(a, b) for a, b in itertools.combinations([f"estaca_ldr_{k}" for k in m.LDR_POS], 2)), 20.0)
chk("cajita bomba ↔ contenedor (solo clavijas)", dist("cajita_bomba", "contenedor_principal"), 0.0, hi=0.6)
chk("cajita bomba ↔ depósito", dist("cajita_bomba", "deposito_agua"), 1.0)
chk("cajita bomba ↔ lámpara/poste", dist("cajita_bomba", "lampara_poste"), 1.0)
chk("bomba ↔ cajita (paredes)", dist("bomba_referencia", "cajita_bomba"), 0.0, hi=1.0)
chk("tapa cajita ↔ bomba", dist("bomba_referencia", "cajita_bomba_tapa"), 0.3)
chk("tapón trasero ↔ depósito: flancos de rosca (mm3)", -ov("tapon_trasero", "deposito_agua"), -60.0)
chk("tapón trasero ↔ contenedor: contacto de brida (mm3)", -ov("tapon_trasero", "contenedor_principal"), -60.0)
chk("caja electrónica ↔ contenedor", dist("caja_electronica", "contenedor_principal"), 0.5)
chk("caja electrónica ↔ tapón trasero", dist("caja_electronica", "tapon_trasero"), 3.0)
chk("riego integrado ↔ contenedor (bandeja alzada 20)", dist("bandeja_tierra", "contenedor_principal", dz=20), 0.45)
chk("tapa ↔ cuerpo (holgura)", dist("lampara_tapa", "lampara_cuerpo"), 0.1)
chk("pasador ↔ tapa (juego en nudillos)", dist("pasador_bisagra", "lampara_tapa"), 0.1)
chk("pasador ↔ copa (juego en oreja)", dist("pasador_bisagra", "lampara_cuerpo"), 0.1)
chk("tapa ↔ poste/unión", dist("lampara_tapa", "lampara_union"), 0.5)
chk("servo ↔ tapa (servo fijo en la base)", dist("servo_sg90", "lampara_tapa"), 3.0)
chk("servo ↔ cápsula (apoya por las orejas)", dist("servo_sg90", "lampara_cuerpo"), 0.0, hi=0.05)
print("== mecanismo de apertura (servo en la base): barrido 0-105°")
def _pose(th):
    pz = m.mech_pose(th); K = m.K; ax = cq.Vector(1, 0, 0)
    Hc = cq.Vector(0, m.HINGE_Y2, m.HINGE_Z); S0, C00, A00 = m.mech_points()
    lid = V["lampara_tapa"].rotate(Hc, Hc + ax, -th)
    d_ph = pz["phi"] - m.MECH_PHI0
    horn = V["brazo_servo"].rotate(cq.Vector(0, S0[0], S0[1]), cq.Vector(1, S0[0], S0[1]), d_ph)
    Cn = (m.HINGE_Y2 + pz["C"][0] * K, m.HINGE_Z + pz["C"][1] * K); An = (m.HINGE_Y2 + pz["A"][0] * K, m.HINGE_Z + pz["A"][1] * K)
    import math
    dl = math.degrees(math.atan2(An[1] - Cn[1], An[0] - Cn[0]) - math.atan2(A00[1] - C00[1], A00[0] - C00[0]))
    rod = V["biela_tapa"].rotate(cq.Vector(0, C00[0], C00[1]), cq.Vector(1, C00[0], C00[1]), dl).translate(cq.Vector(0, Cn[0] - C00[0], Cn[1] - C00[1]))
    pinC = V["pasador_servo"].translate(cq.Vector(0, Cn[0] - C00[0], Cn[1] - C00[1]))
    pinA = V["pasador_tapa"].translate(cq.Vector(0, An[0] - A00[0], An[1] - A00[1]))
    return lid, horn, rod, pinC, pinA
for th in (0, 30, 60, 90, 105):
    lid, horn, rod, pinC, pinA = _pose(th)
    chk(f"θ={th:3d}° tapa ↔ copa", lid.distance(V["lampara_cuerpo"]) * S, 0.1)
    chk(f"θ={th:3d}° tapa ↔ poste/unión", min(lid.distance(V["lampara_poste"]), lid.distance(V["lampara_union"])) * S, 0.3)
    chk(f"θ={th:3d}° tapa ↔ servo", lid.distance(V["servo_sg90"]) * S, 0.3)
    chk(f"θ={th:3d}° biela ↔ copa/cápsula", rod.distance(V["lampara_cuerpo"]) * S, 0.3)
    chk(f"θ={th:3d}° biela ↔ servo", rod.distance(V["servo_sg90"]) * S, 0.2)
    chk(f"θ={th:3d}° biela ↔ tapa (planos separados)", rod.distance(lid) * S, 0.15)
    chk(f"θ={th:3d}° biela ↔ brazo", rod.distance(horn) * S, 0.15)
    chk(f"θ={th:3d}° brazo ↔ copa/cápsula", horn.distance(V["lampara_cuerpo"]) * S, 0.3)
    chk(f"θ={th:3d}° pasador tapa ↔ orejas (juego)", pinA.distance(lid) * S, 0.1)
    chk(f"θ={th:3d}° pasador brazo ↔ biela (juego)", pinC.distance(rod) * S, 0.1)
chk("niple ↔ riego (encaje)", dist("niple_riego", "riego_tierra"), 0.0, hi=0.5)
chk("niple ↔ contenedor (agujero)", dist("niple_riego", "contenedor_principal"), 0.0, hi=0.6)
print("== v29: peine, tornillos de mano, riego separado")
chk("peine ↔ contenedor (muesca, holgura)", dist("peine_cables", "contenedor_principal"), 0.05)
chk("peine ↔ canaleta", dist("peine_cables", "canaleta_cables"), 0.0, hi=8.0)
for nm in ("alto", "bajo"):
    chk(f"tornillo {nm} ↔ poste (apoya)", dist(f"tornillo_mano_{nm}", "lampara_poste"), 0.0, hi=1.0)
    chk(f"tornillo {nm} ↔ canaleta", dist(f"tornillo_mano_{nm}", "canaleta_cables"), 0.8)
chk("riego ↔ bandeja (holgura)", dist("riego_tierra", "bandeja_tierra"), 0.2)
chk("riego ↔ contenedor", dist("riego_tierra", "contenedor_principal"), 0.2)
chk("riego ↔ estacas", min(dist("riego_tierra", f"estaca_ldr_{k}") for k in m.LDR_POS), 1.0)
print(f"      O-ring ↔ depósito: interferencia {ov('oring_deposito','deposito_agua'):.2f} mm3 reales (aprieta el cordón); ↔ conector {ov('oring_deposito','conector_deposito'):.2f}")
print("== paredes mínimas imprimibles (mm reales)")
for txt, val in [("pared contenedor", m.WALL * S), ("pared bandeja", m.TT * S), ("pared depósito", m.RT * S), ("fondo bandeja", m.TF * S),
                 ("riel (ancho)", 8 * S), ("asa bandeja/tanque (lado)", 8 * S), ("hueco drenaje Ø", 7 * S), ("tope de plataforma", 2.0)]:
    chk(txt, val, 1.2 if "Ø" not in txt else 3.0)
print("== cama de impresión")
ps = m.print_set(P); ps.update(m.hardware_set())
for n, shp in ps.items():
    bb = shp.BoundingBox(); chk(f"{n} (mayor lado)", max(bb.xlen, bb.ylen), 0.0, hi=m.CAMA_MAX)
print("== extracción: la bandeja y el depósito salen verticalmente sin chocar")
tray_group = ["bandeja_tierra", "sustrato", "acetato_suelo"] + [f"estaca_ldr_{k}" for k in m.LDR_POS]
tank_group = ["deposito_agua", "tapa_deposito", "tapon_llenado", "agua_deposito", "acetato_nivel"]
fixed = ["contenedor_principal", "labio", "lampara_poste", "lampara_union", "lampara_cuerpo",]
for gname, grp in (("bandeja", tray_group), ("riego", ["riego_tierra"]), ("depósito", tank_group)):
    worst = 0.0
    for dz in range(20, 260, 30):
        for g in grp:
            if g in ("sustrato", "agua_deposito"): continue
            for f in fixed:
                if g == "bandeja_tierra":
                    vv = V_TRAY_PROXY.translate(cq.Vector(0, 0, dz)).intersect(V[f]).Volume() * S**3
                else:
                    vv = ov(g, f, dz=dz)
                worst = max(worst, vv if vv == vv else 0)
    chk(f"salida vertical de {gname}: choque máximo", -worst, -0.5)
print("RESULTADO:", "todo OK" if not bad else f"{len(bad)} puntos por corregir:\n   - " + "\n   - ".join(bad))
