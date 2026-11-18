"""
Simón — maqueta MODULAR para impresión 3D (CadQuery) -> STL/STEP.

Torre de tres niveles, de abajo hacia arriba:
  1. base_principal      placa con bolsillo para el depósito y una franja para la caja de electrónica
  2. deposito_agua       recibe el agua que drena; aloja la bomba (sumergida) sobre su soporte
  3. recipiente_tierra   lleva el sustrato; el fondo tiene huecos de drenaje y hace de tapa del depósito
Más:  soporte_bomba (bandeja para la bomba ya impresa)  y  tapon_llenado (para recargar el depósito).

Ciclo del agua: la bomba sube el agua por una manguera de 10 mm que pasa por el agujero con collar del recipiente
y riega el sustrato; el agua sobrante cae por los huecos al depósito (circuito cerrado).

Medidas en mm, tamaño real (sin escala). Ejes: X largo, Y fondo (frente = -Y), Z arriba.
La bomba: medidas calculadas de los STL de edcdadstuff (CC BY-SA 4.0): 101.6 x 53.1 x 66.8 mm acostada con la salida hacia arriba.
Uso:  python simon_modular.py
"""
import os, math
import cadquery as cq

here = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(here, "modular")

# ---------------- parámetros ----------------
L, D = 210.0, 140.0          # huella del depósito y del recipiente
R = 10.0                     # radio de esquinas
WALL = 2.4                   # pared (múltiplo de 0.4 mm)
FLOOR = 3.0
H_RES = 95.0                 # altura del depósito
H_PLANT = 95.0               # altura total del recipiente (incluye el aro de encaje)
LIP_H, LIP_T, LIP_CLR = 5.0, 1.6, 0.6   # aro de encaje bajo el recipiente
DRAIN_D, DRAIN_PITCH = 5.0, 22.0

# bomba (acostada: eje largo en X, salida hacia +Z)
PUMP_L, PUMP_W, PUMP_H = 101.6, 53.1, 66.8
OUTLET_OFF_X = 10.0          # la salida está a ~10 mm del extremo del rodete (z = -16 respecto a z = -26.2)
OUTLET_OFF_Y = 12.0          # y a +12 mm del eje de la bomba
TRAY_X0, TRAY_L, TRAY_W = -100.0, 112.0, 70.0
TRAY_T = 3.0
PAD_H = 7.2                  # el cuerpo redondo (radio 22.7) apoya en los dos apoyos; la lengüeta inferior (-26.9) queda a 3 mm de la bandeja
TUBE_D = 10.0

PLATE_X, PLATE_Y0, PLATE_Y1, PLATE_T = 230.0, -122.0, 75.0, 6.0
POCKET_CLR, POCKET_DEPTH = 0.5, 3.0
BOX_L, BOX_W = 137.8, 45.8   # caja de electrónica ya diseñada


def rbox(l, w, h, r, z0=0.0, cx=0.0, cy=0.0):
    return (cq.Workplane("XY").workplane(offset=z0).center(cx, cy).rect(l, w).extrude(h)
            .edges("|Z").fillet(min(r, l / 2 - 0.1, w / 2 - 0.1)))


def cyl(cx, cy, d, z0, h):
    return cq.Workplane("XY").workplane(offset=z0).center(cx, cy).circle(d / 2).extrude(h)


# ---------------- 1. base principal ----------------
def base_principal():
    cy = (PLATE_Y0 + PLATE_Y1) / 2
    b = rbox(PLATE_X, PLATE_Y1 - PLATE_Y0, PLATE_T, 8, 0, 0, cy)
    b = b.faces(">Z").edges().chamfer(1.0)
    b = b.cut(rbox(L + POCKET_CLR * 2, D + POCKET_CLR * 2, POCKET_DEPTH + 1, R + 0.5, PLATE_T - POCKET_DEPTH))
    # nicho para la caja de electrónica (franja delantera)
    b = b.cut(rbox(BOX_L + 1.2, BOX_W + 1.2, 3, 3, PLATE_T - 2, 0, -97))
    # cuatro huecos para tornillos M4 a la mesa y desagüe de la base
    for sx in (-1, 1):
        for sy in (PLATE_Y0 + 12, PLATE_Y1 - 12):
            b = b.cut(cyl(sx * (PLATE_X / 2 - 12), sy, 4.4, -1, PLATE_T + 2))
    return b


# ---------------- 2. depósito de agua ----------------
def deposito_agua():
    o = rbox(L, D, H_RES, R)
    o = o.faces(">Z").edges().chamfer(0.8)
    cav = rbox(L - 2 * WALL, D - 2 * WALL, H_RES, R - WALL, FLOOR)
    o = o.cut(cav)
    # paso del cable de la bomba (por encima del nivel máximo de agua)
    o = o.cut(cq.Workplane("YZ").workplane(offset=L / 2 - WALL - 1).center(0, H_RES - 7).circle(3.9).extrude(WALL + 2))
    # escotes de agarre arriba
    for sy in (-1, 1):
        o = o.cut(cq.Workplane("XY").workplane(offset=H_RES - 4).center(0, sy * D / 2).rect(40, 3 * WALL).extrude(5))
    return o


# ---------------- 3. soporte de la bomba ----------------
def soporte_bomba():
    t = rbox(TRAY_L, TRAY_W, TRAY_T, 3, 0, TRAY_X0 + TRAY_L / 2, 0)
    # topes de los extremos
    for sx in (-1, 1):
        t = t.union(rbox(3, TRAY_W, 14, 1, TRAY_T, TRAY_X0 + TRAY_L / 2 + sx * (TRAY_L / 2 - 1.5), 0))
    # dos apoyos transversales; pz = posición a lo largo de la bomba (z del STL, de -26.2 a 75.4)
    PADZ = (14.0, 60.0)
    for pz in PADZ:
        t = t.union(rbox(8, 30, PAD_H, 1, TRAY_T, TRAY_X0 + 4 + (pz + 26.2), 0))
    # ranuras para brida de 3 mm junto a cada apoyo (la brida rodea el cuerpo y pasa por debajo de la bandeja)
    for pz in PADZ:
        for sy in (-1, 1):
            t = t.cut(rbox(5, 3.4, TRAY_T + 1, 0.5, -0.1, TRAY_X0 + 4 + (pz + 26.2), sy * 26.5))
    return t


# ---------------- 4. recipiente de tierra ----------------
TUBE_XY = (TRAY_X0 + 4 + OUTLET_OFF_X + 0.0, OUTLET_OFF_Y)
FILL_XY = (78.0, 40.0)


def recipiente_tierra():
    inner_w, inner_d = L - 2 * WALL, D - 2 * WALL
    body = rbox(L, D, H_PLANT - LIP_H, R, LIP_H)
    body = body.cut(rbox(inner_w, inner_d, H_PLANT, R - WALL, LIP_H + FLOOR))
    # aro de encaje que entra en el depósito
    ow, od = inner_w - LIP_CLR, inner_d - LIP_CLR
    ring = rbox(ow, od, LIP_H, R - WALL - LIP_CLR / 2).cut(rbox(ow - 2 * LIP_T, od - 2 * LIP_T, LIP_H, R - WALL - 1.6))
    body = body.union(ring)
    # collar y agujero para la manguera de la bomba
    z_floor = LIP_H + FLOOR
    body = body.union(cyl(*TUBE_XY, TUBE_D + 12, z_floor, 6)).cut(cyl(*TUBE_XY, TUBE_D + 4, LIP_H - 1, 20))
    # chimenea de llenado
    body = body.union(cyl(*FILL_XY, 38, z_floor, H_PLANT - LIP_H - FLOOR - 12)).cut(cyl(*FILL_XY, 32, LIP_H - 1, H_PLANT))
    # huecos de drenaje
    n = 0
    xs = [(-4 + i) * DRAIN_PITCH for i in range(9)]
    ys = [(-2 + j) * DRAIN_PITCH for j in range(5)]
    for x in xs:
        for y in ys:
            if math.hypot(x - TUBE_XY[0], y - TUBE_XY[1]) < 20 or math.hypot(x - FILL_XY[0], y - FILL_XY[1]) < 26:
                continue
            body = body.cut(cyl(x, y, DRAIN_D, LIP_H - 1, FLOOR + 2)); n += 1
    body.drain_count = n
    return body


# ---------------- 5. tapón de llenado ----------------
def tapon_llenado():
    cap = cyl(0, 0, 42, 0, 4).faces(">Z").edges().chamfer(0.8)
    cap = cap.union(cyl(0, 0, 31.4, 4, 10))
    cap = cap.union(rbox(24, 5, 8, 1, 4, 0, 0))   # asa
    return cap


# ---------------- ensamblaje de referencia ----------------
Z_RES0 = PLATE_T - POCKET_DEPTH
Z_PLANT0 = Z_RES0 + H_RES - LIP_H


def build():
    parts = {
        "base_principal": (base_principal(), (0.74, 0.76, 0.80)),
        "deposito_agua": (deposito_agua().translate((0, 0, Z_RES0)), (0.35, 0.60, 0.85)),
        "soporte_bomba": (soporte_bomba().translate((0, 0, Z_RES0 + FLOOR)), (0.95, 0.60, 0.20)),
        "recipiente_tierra": (recipiente_tierra().translate((0, 0, Z_PLANT0)), (0.18, 0.62, 0.42)),
        "tapon_llenado": (tapon_llenado().translate((FILL_XY[0], FILL_XY[1], Z_PLANT0 + H_PLANT - 3)), (0.25, 0.25, 0.28)),
    }
    return parts


if __name__ == "__main__":
    parts = build()
    for name, (wp, _) in parts.items():
        v = wp.val()
        bb = v.BoundingBox()
        print(f"{name:20s} válida={v.isValid()} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:6.1f} mm  vol={v.Volume()/1000:7.1f} cm3")
        cq.exporters.export(wp, os.path.join(OUT, "referencia", f"{name}.stl"))
    for name in ("base_principal", "deposito_agua", "soporte_bomba", "tapon_llenado"):
        cq.exporters.export(build_part := {"base_principal": base_principal, "deposito_agua": deposito_agua, "soporte_bomba": soporte_bomba, "tapon_llenado": tapon_llenado}[name](), os.path.join(OUT, "imprimir", f"{name}.stl"))
    rt = recipiente_tierra()
    cq.exporters.export(rt, os.path.join(OUT, "imprimir", "recipiente_tierra.stl"))
    print("huecos de drenaje:", rt.drain_count)
    allp = cq.Compound.makeCompound([wp.val() for wp, _ in parts.values()])
    cq.exporters.export(cq.Workplane("XY").newObject([allp]), os.path.join(OUT, "simon_modular.step"))
