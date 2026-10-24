"""
Matera inteligente "Simón" — modelo paramétrico (CadQuery) -> STEP y STL para FreeCAD.

Uso:   pip install cadquery
       python simon_matera.py            # genera simon_matera.step (referencia), simon_matera.stl y imprimir/*.stl

Para imprimir en un servicio en línea: usa las piezas de imprimir/ (ya escaladas, orientadas y partidas si hacía falta).
Cambia ESCALA abajo: 0.4 = maqueta de escritorio (cabe en impresoras de 250 mm); 1.0 = tamaño real (el script parte el cuerpo,
el labio y el panel en dos mitades con clavijas de alineación).

Medidas en milímetros. Ejes: X = largo, Y = profundidad (el frente de la matera mira hacia -Y), Z = arriba.
Es la misma matera del gemelo 3D (frontend/src/scene/Planter.tsx, 1 unidad = 100 mm). Cambia los parámetros y vuelve a correr.
"""
import os
import cadquery as cq

# ------------------------- parámetros de impresión -------------------------
ESCALA = float(os.environ.get("ESCALA", 0.4))   # 0.4 = maqueta; 1.0 = tamaño real
CAMA_MAX = float(os.environ.get("CAMA_MAX", 250.0))   # lado útil de la cama de impresión del servicio (mm)
PANE_T = 2.5                 # espesor del acrílico/vidrio de las ventanas (mm)

# ------------------------- parámetros (mm) -------------------------
W, D = 580.0, 260.0          # largo y fondo exteriores del cuerpo
R = 62.0                     # radio de las esquinas (vista desde arriba)
H = 215.0                    # altura del cuerpo hasta el labio
WALL = 12.0                  # espesor de pared
FLOOR = 14.0                 # espesor del fondo
EDGE = 4.0                   # redondeo del borde superior exterior

SOIL_Z0 = 42.0               # base del sustrato (sobre la grava de drenaje)
SOIL_TOP = 205.0             # superficie del sustrato

# ventanas del frente: (x0, x1, z0, z1, radio)
WIN_SOIL = (-260.0, -40.0, 50.0, 195.0, 16.0)
WIN_GAUGE = (195.0, 240.0, 35.0, 175.0, 20.0)

LAMP_L, LAMP_W, LAMP_T = 620.0, 200.0, 12.0   # panel LED ovalado
LAMP_Z = 640.0                                # altura del panel (en el gemelo sube con la planta)
POLE_X, POLE_Y = 75.0, 98.0                   # poste: detrás de las plantas
POLE_W, POLE_D = 34.0, 30.0


def rrect(w, d, r, h, z0=0.0):
    return cq.Workplane("XY").workplane(offset=z0).rect(w, d).extrude(h).edges("|Z").fillet(r)


def window(x0, x1, z0, z1, r):
    """Cortador de ventana: atraviesa el frente (lado -Y)."""
    w, h = x1 - x0, z1 - z0
    c = cq.Workplane("XY").box(w, 80, h).edges("|Y").fillet(r)
    return c.translate(((x0 + x1) / 2, -D / 2 + 20, (z0 + z1) / 2))


# ------------------------- piezas -------------------------
RES = (185.0, 278.0)         # depósito de agua: x0, x1 (pegado a la pared derecha)
RES_T = 4.0                  # pared del depósito
FILL = (235.0, -60.0)        # boca de llenado (x, y)


def reservoir():
    """Depósito sellado (cuerpo hueco con tapa y agujero de llenado), a la derecha, detrás de la ventana de nivel."""
    x0, x1 = RES
    outer = cq.Workplane("XY").box(x1 - x0, D - 2 * WALL + 0.2, SOIL_TOP - FLOOR, centered=(False, True, False)).translate((x0, 0, FLOOR))
    cav = cq.Workplane("XY").box(x1 - x0 - 2 * RES_T, D - 2 * WALL - 2 * RES_T, SOIL_TOP - FLOOR - 2 * RES_T, centered=(False, True, False)).translate((x0 + RES_T, 0, FLOOR + RES_T))
    hole = cq.Workplane("XY").workplane(offset=SOIL_TOP - 20).center(*FILL).circle(16).extrude(40)
    return outer.cut(cav).cut(hole)


def pole_socket():
    """Cajón fijo a la pared trasera donde entra el poste de la lámpara (80 mm de encaje)."""
    w, d = POLE_W + 18, POLE_D + 18
    box = cq.Workplane("XY").box(w, D / 2 - WALL - (POLE_Y - d / 2) + 0.2, H - 6 - FLOOR, centered=(True, False, False)).translate((POLE_X, POLE_Y - d / 2, FLOOR))
    pocket = cq.Workplane("XY").box(POLE_W + 0.6, POLE_D + 0.6, 80, centered=(True, True, False)).translate((POLE_X, POLE_Y, H - 6 - 80))
    return box.cut(pocket)


def body():
    outer = rrect(W, D, R, H).faces(">Z").edges().fillet(EDGE)
    inner = rrect(W - 2 * WALL, D - 2 * WALL, R - WALL, H, z0=FLOOR)
    b = outer.cut(inner)
    for win in (WIN_SOIL, WIN_GAUGE):
        b = b.cut(window(*win))
        # rebaje por dentro para pegar el acrílico (la ventana queda con 5 mm de apoyo por lado)
        x0, x1, z0, z1, r = win
        reb = cq.Workplane("XY").box(x1 - x0 + 10, PANE_T + 0.4, z1 - z0 + 10).edges("|Y").fillet(r + 4)
        b = b.cut(reb.translate(((x0 + x1) / 2, -D / 2 + WALL - PANE_T / 2 + 0.2, (z0 + z1) / 2)))
    b = b.union(reservoir()).union(pole_socket())
    return b


def lip():
    o = rrect(W + 6, D + 6, R + 3, 10, z0=H - 6)
    i = rrect(W - 2 * 24, D - 2 * 24, R - 24, 10, z0=H - 6)
    return o.cut(i).faces(">Z").edges().fillet(2.5)


def soil():
    """Sustrato (solo para la vista de referencia; en la maqueta se usa tierra real)."""
    s = rrect(W - 2 * WALL - 0.4, D - 2 * WALL - 0.4, R - WALL, SOIL_TOP - SOIL_Z0, z0=SOIL_Z0)
    res = cq.Workplane("XY").box(290 - 185, D, SOIL_TOP - SOIL_Z0, centered=(False, True, False)).translate((185, 0, SOIL_Z0))
    return s.cut(res).cut(pole_socket())


def gauge():
    x0, x1, z0, z1, _ = WIN_GAUGE
    frame = cq.Workplane("XY").box(x1 - x0 + 8, 6, z1 - z0 + 10).translate(((x0 + x1) / 2, -D / 2 + WALL + 14, (z0 + z1) / 2))
    water = cq.Workplane("XY").box(x1 - x0 - 8, 8, (z1 - z0) * 0.6).translate(((x0 + x1) / 2, -D / 2 + WALL + 8, z0 + (z1 - z0) * 0.3))
    return frame, water


def lamp():
    panel = (
        cq.Workplane("XY").workplane(offset=LAMP_Z).slot2D(LAMP_L, LAMP_W, 0).extrude(LAMP_T).edges().fillet(4.0)
    )
    leds = cq.Workplane("XY").workplane(offset=LAMP_Z - 1.2).slot2D(LAMP_L - 60, LAMP_W - 35, 0).extrude(1.2)
    pole = cq.Workplane("XY").box(POLE_W, POLE_D, LAMP_Z - H + 6 + 80, centered=(True, True, False)).translate((POLE_X, POLE_Y, H - 6 - 80)).edges("|Z").fillet(9)
    joint = cq.Workplane("XY").box(POLE_W * 1.5, POLE_D * 1.3, 24).translate((POLE_X, POLE_Y - 4, LAMP_Z + LAMP_T / 2)).edges().fillet(6)
    return panel, leds, pole, joint


def fill_port():
    """Tapón de la boca de llenado: cabeza + espiga que entra en el agujero del depósito."""
    head = cq.Workplane("XY").workplane(offset=SOIL_TOP).center(*FILL).circle(28).workplane(offset=14).circle(22).loft()
    plug = cq.Workplane("XY").workplane(offset=SOIL_TOP - 14).center(*FILL).circle(15.4).extrude(14)
    return head.union(plug)


def probe():
    """Sensor capacitivo de humedad pegado a la cara visible del sustrato."""
    return cq.Workplane("XY").box(30, 4.5, 205 - 55, centered=(True, True, False)).translate((-75, -D / 2 + WALL - 2.5, 55))


def controller():
    return cq.Workplane("XY").box(95, 58, 36).translate((-400, -90, 18)).edges().fillet(4)


def build():
    """Todas las piezas (para el ensamble de referencia). El segundo valor indica si se imprime."""
    parts = {
        "cuerpo": (body(), (0.03, 0.035, 0.04), True),
        "labio": (lip(), (0.03, 0.035, 0.04), True),
        "sustrato": (soil(), (0.28, 0.19, 0.12), False),       # tierra real
        "sonda_humedad": (probe(), (0.12, 0.35, 0.22), False),  # sensor comprado
        "tapon_llenado": (fill_port(), (0.1, 0.11, 0.12), True),
        "controlador": (controller(), (0.1, 0.18, 0.3), False),  # placa/caja comprada
    }
    frame, water = gauge()
    parts["nivel_marco"] = (frame, (0.93, 0.95, 0.96), True)
    parts["nivel_agua"] = (water, (0.3, 0.65, 0.92), False)
    panel, leds, pole, joint = lamp()
    parts["lampara_panel"] = (panel, (0.03, 0.035, 0.04), True)
    parts["lampara_leds"] = (leds, (1.0, 0.85, 0.9), False)   # tira LED comprada
    parts["lampara_poste"] = (pole, (0.03, 0.035, 0.04), True)
    parts["lampara_union"] = (joint, (0.03, 0.035, 0.04), True)
    return parts


# ------------------------- preparación para imprimir -------------------------
def _half(shape, side):
    """Mitad x<0 (side=-1) o x>0 (side=+1) de una pieza."""
    big = 2000.0
    box = cq.Workplane("XY").box(big, big, big, centered=(False, True, True))
    if side < 0:
        box = box.translate((-big, 0, 0))
    return cq.Workplane("XY").newObject([shape]).intersect(box).val()


def split_pegs(wp, with_pegs):
    """Parte una pieza en x=0 y, si se pide, agrega clavijas de alineación en las paredes frontal y trasera."""
    shp = wp.val()
    A, B = _half(shp, -1), _half(shp, +1)
    if with_pegs:
        for y in (-124.0, 124.0):
            for z in (60.0, 160.0):
                peg = cq.Workplane("YZ").center(y, z).circle(4.0).extrude(12.0).val()          # sale de A hacia +x
                hole = cq.Workplane("YZ").center(y, z).circle(4.4).extrude(13.0).val()         # entra en B
                A = cq.Workplane("XY").newObject([A]).union(cq.Workplane("XY").newObject([peg])).val()
                B = cq.Workplane("XY").newObject([B]).cut(cq.Workplane("XY").newObject([hole])).val()
    return {"A": A, "B": B}


def orient(name, shp):
    """Apoya cada pieza en su cara más estable sobre la cama."""
    if name == "lampara_poste":                       # se imprime acostado
        shp = shp.rotate(cq.Vector(0, 0, 0), cq.Vector(0, 1, 0), 90)
    elif name == "tapon_llenado":                     # cabeza abajo
        shp = shp.rotate(cq.Vector(0, 0, 0), cq.Vector(1, 0, 0), 180)
    bb = shp.BoundingBox()
    return shp.translate(cq.Vector(-bb.xmin, -bb.ymin, -bb.zmin))


def print_set(parts):
    out = {}
    for name, (wp, _, printable) in parts.items():
        if not printable:
            continue
        shp = wp.val()
        longest = max(shp.BoundingBox().xlen, shp.BoundingBox().ylen) * ESCALA
        if name in ("cuerpo", "labio", "lampara_panel") and longest > CAMA_MAX:
            for k, half in split_pegs(wp, name == "cuerpo").items():
                out[f"{name}_mitad_{k}"] = half
        else:
            out[name] = shp
    final = {}
    for name, shp in out.items():
        base = name.split("_mitad_")[0]
        final[name] = orient(base, shp.scale(ESCALA))
    return final


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for d in ("referencia", "imprimir"):
        os.makedirs(os.path.join(here, d), exist_ok=True)
    parts = build()
    # ensamble de referencia a tamaño real (con tierra, agua, LEDs y sensores)
    asm = cq.Assembly(name="simon_matera")
    for name, (wp, rgb, _) in parts.items():
        asm.add(wp, name=name, color=cq.Color(*rgb))
        cq.exporters.export(wp, os.path.join(here, "referencia", f"{name}.stl"))
    asm.save(os.path.join(here, "simon_matera.step"))
    cq.exporters.export(cq.Workplane("XY").newObject([cq.Compound.makeCompound([wp.val() for wp, _, _ in parts.values()])]),
                        os.path.join(here, "simon_matera.stl"))

    # piezas para imprimir (escaladas y orientadas)
    ps = print_set(parts)
    for name, shp in ps.items():
        cq.exporters.export(cq.Workplane("XY").newObject([shp]), os.path.join(here, "imprimir", f"{name}.stl"))
    cq.exporters.export(cq.Workplane("XY").newObject([cq.Compound.makeCompound(list(ps.values()))]),
                        os.path.join(here, "imprimir", "todas_las_piezas.step"))
    print(f"ESCALA {ESCALA} · cama {CAMA_MAX:.0f} mm · paredes: cuerpo {WALL*ESCALA:.1f} mm, depósito {RES_T*ESCALA:.1f} mm")
    for name, shp in ps.items():
        bb = shp.BoundingBox()
        ok = max(bb.xlen, bb.ylen) <= CAMA_MAX and shp.isValid()
        print(f"{name:22s} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:6.1f} mm  vol={shp.Volume()/1000:7.1f} cm3  válida={shp.isValid()}  cabe={'sí' if ok else 'NO'}")
