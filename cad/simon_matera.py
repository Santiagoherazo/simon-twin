"""
Matera inteligente "Simón" — modelo paramétrico (CadQuery) -> STEP y STL para FreeCAD.   (v25: 3 piezas)

Uso:   pip install cadquery
       python simon_matera.py            # genera simon_matera.step (referencia), simon_matera.stl y imprimir/*.stl

LAS 3 PIEZAS (más tapa del depósito, labio, lámpara y accesorios):
  1. contenedor_principal  (morado) recoge todo: cuenca inferior que recibe el agua que drena, divisor, postes que sostienen la
                           bandeja, hueco para el depósito y el cajón del poste de la lámpara.
  2. bandeja_tierra        (negro)  recipiente de la tierra con huecos de drenaje; se levanta con las asas para vaciar la cuenca.
  3. deposito_agua         (rojo)   depósito con soporte para la bomba ya impresa, ventana de nivel y boca de llenado
                           (tapa_deposito + tapon_llenado). Se levanta con su asa.

Para imprimir en un servicio en línea: usa las piezas de imprimir/ (ya escaladas, orientadas y partidas si hacía falta).
ESCALA 0.5 = maqueta (la bomba real solo cabe desde ~0.5); 1.0 = tamaño real. Las piezas grandes se parten en dos mitades con clavijas.

Medidas en milímetros. Ejes: X = largo, Y = profundidad (el frente de la matera mira hacia -Y), Z = arriba.
Es la misma matera del gemelo 3D (frontend/src/scene/Planter.tsx, 1 unidad = 100 mm). Cambia los parámetros y vuelve a correr.
Todo el modelo está en "unidades de diseño" (tamaño real de la matera); el script lo escala con ESCALA al exportar para imprimir.
Los componentes comprados (bomba, sensores, caja electrónica) se dibujan/imprimen a su medida REAL, nunca escalada.
"""
import os
import cadquery as cq

# ------------------------- parámetros de impresión -------------------------
ESCALA = float(os.environ.get("ESCALA", 0.5))   # 0.5 = maqueta; 1.0 = tamaño real
CAMA_MAX = float(os.environ.get("CAMA_MAX", 250.0))   # lado útil de la cama de impresión del servicio (mm)
PANE_T = 2.5                 # espesor del acrílico/vidrio de las ventanas (mm, REAL)
K = 1.0 / ESCALA             # convierte mm reales -> unidades de diseño

# ------------------------- parámetros (unidades de diseño) -------------------------
W, D = 580.0, 260.0          # largo y fondo exteriores del contenedor
R = 62.0                     # radio de las esquinas (vista desde arriba)
H = 215.0                    # altura del contenedor hasta el labio
WALL = 12.0                  # espesor de pared del contenedor
FLOOR = 14.0                 # espesor del fondo
EDGE = 4.0                   # redondeo del borde superior exterior
CL = 1.0                     # holgura entre piezas desmontables (0,5 mm a escala 0.5)
BOSS = 0.0                   # refuerzo interior de la pared alrededor de las ventanas (deja >= 1,5 mm de marco bajo el rebaje del acrílico)

SOIL_TOP = 205.0             # borde superior de bandeja y depósito
Z_TB = 46.0                  # altura a la que queda el fondo de la bandeja (sobre los postes)
TT, TF = 6.0, 6.0            # pared y fondo de la bandeja
RT = 6.0                     # pared del depósito
DIV = (136.0, 142.0)         # divisor entre la cuenca de la bandeja y el hueco del depósito
TRAY_X1 = DIV[0] - CL        # extremo derecho de la bandeja
TANK_X0 = DIV[1] + CL        # extremo izquierdo del depósito
TANK_TOP = SOIL_TOP - RT     # el depósito llega aquí; la tapa cierra de 199 a 205
Y_IN = D / 2 - WALL - CL     # cara exterior (frontal) de bandeja/depósito

# ventanas del frente: (x0, x1, z0, z1, radio) — dentro del tramo recto (las esquinas curvan desde |x|=228)
WIN_SOIL = (-222.0, -45.0, 56.0, 190.0, 16.0)    # bandeja
WIN_GAUGE = (172.0, 222.0, 35.0, 175.0, 18.0)    # depósito (nivel del agua)

LAMP_L, LAMP_W, LAMP_T = 620.0, 200.0, 42.0   # cuerpo ovalado de la lámpara (hueco para LEDs, servo y puertas)
LAMP_CAV = 32.0               # profundidad de la cavidad (techo de 10)
LAMP_Z = 620.0                                # altura del panel (en el gemelo sube con la planta)
POLE_X, POLE_Y = 0.0, 98.0                    # poste: al CENTRO, detrás de las plantas
POLE_W, POLE_D = 34.0, 30.0
POLE_CH = (14.0, 12.0)        # canal interior del poste para el cable (7 x 6 mm reales)
DOOR_Y = 86.0                 # eje de las bisagras de las puertas (y = ±)
SERVO = (22.7, 12.2, 22.5)    # micro servo SG90 (mm reales): largo, ancho, alto

# ------------------------- hardware confirmado (medidas REALES en mm, no se escalan) -------------------------
LDR_D = 5.2                  # fotorresistencia de 5 mm (agujero con holgura)
PUMP_L, PUMP_W, PUMP_H = 55.0, 41.0, 36.0     # minibomba sumergible DC30A-1230 (12 V, 4,8 W, 240 L/h): cuerpo 55 x 41 x 36 mm (VERIFICA con tu pieza)
PUMP_NZ = ((-6.0, 8.5, 14.0), (8.0, 13.0, 13.0))   # boquillas en el extremo +Y: (x, Ø, largo) mm reales: salida (púa) y entrada (inclinada); altura supuesta = mitad del cuerpo
PUMP_OUT_ALONG, PUMP_OUT_ACROSS = 10.0, 12.0  # salida: 10 mm del extremo del rodete y +12 mm del eje (VERIFICA con tu bomba impresa)
PUMP_TUBE_D, PUMP_CABLE_D = 10.0, 6.0
CR_L, CR_W, CR_T = 108.0, 52.0, 2.5           # plataforma-soporte de la bomba (real)
DHT_HOLE = (13.0, 16.5)      # ventana para el DHT11 (cuerpo azul) en la caja electrónica
ESP_BOARD = (52.0, 29.0)     # ESP32 DevKit
RELAY_BOARD = (51.0, 26.0)   # módulo de 2 relés
PUMP_C = (202.0, 0.0)        # centro de la bomba dentro del depósito (x, y) en unidades de diseño
LDR_POS = {"NO": (-246.0, 90.0), "NE": (110.0, 90.0), "SO": (-246.0, -90.0), "SE": (110.0, -90.0)}   # esquinas de la tierra (x, y)
FILL = (175.0, -80.0)        # boca de llenado (x, y) en la tapa
# ultrasonido HC-SR04 (medidas reales, VERIFICA con tu módulo): placa 45 x 20 x 1.6, cápsulas Ø16 que sobresalen 12 mm, separadas 26 mm
US_BOARD, US_CAN_D, US_CAN_H, US_PITCH = (45.0, 20.0, 1.6), 16.0, 12.0, 26.0
US_C = (174.0, 40.0)         # centro del soporte sobre la tapa (x, y) en unidades de diseño
US_HOLDER_H = 20.0           # altura del soporte (real): deja las cápsulas 5 mm reales sobre la tapa
US_MIN_RANGE = 20.0          # distancia mínima del módulo (mm reales)
TUBE_XY = (PUMP_C[0] + PUMP_OUT_ACROSS * K, PUMP_C[1] - (PUMP_L / 2 - PUMP_OUT_ALONG) * K)   # salida de la manguera
CABLE_XY = (250.0, -60.0)    # paso del cable de la bomba
DS_XZ = (-200.0, 175.0)      # paso del cable del DS18B20 (pared trasera)
# pantalla OLED 0.96" I2C (la más pequeña; medidas reales, VERIFICA con tu módulo): placa 27.3 x 27.8 x 1.2, vidrio 1.5 mm. Son "los ojos" de la planta
SCR_PCB, SCR_GLASS_T = (27.3, 27.8, 1.2), 1.5
SCR_Z = H / 2                # centrada en el frente: x = 0 y a media altura
SCR_REBATE = 3.2             # profundidad del nicho exterior (placa + vidrio + holgura), mm reales
SCR_HOLES = (23.5, 23.8)     # separación de los 4 agujeros de la placa SSD1306 0.96" (VERIFICA con tu módulo), taladro piloto M2 Ø1.8 mm
SCR_SCREW_DEPTH = 2.2        # profundidad del taladro piloto en la pared (mm reales)
# reja del fondo de la bandeja (mm reales): huecos lo más pequeños que se imprimen bien
GRID_D, GRID_PITCH = 2.0, 4.0
GRID_ON = os.environ.get("REJA", "1") == "1"   # REJA=0 -> fondo macizo (versión ligera para Tinkercad)

RAILS_Y = (-45.0, 45.0)      # rieles longitudinales (en la dirección del agua) que sostienen la bandeja; la bandeja se apoya además en un reborde perimetral
LEDGE_W = 9.0                # ancho del reborde de apoyo bajo las paredes de la bandeja
SOIL_FILL = SOIL_TOP - 18.0   # nivel de la tierra (queda por debajo de los tubos de riego integrados)
PIPE_Y = (-58.0, -20.0, 20.0, 58.0)   # ramales de riego integrados a la bandeja (paralelos a X)
PIPE_ZC = SOIL_TOP - 7.0      # eje de los tubos: su cara superior se aplana al ras del borde (la bandeja se imprime boca abajo)
BRK_Z0 = 150.0                # base de los soportes de esquina de las LDR
LDR_CORE_R, LDR_THREAD_R, LDR_PITCH_R = 3.2, 4.6, 3.0     # rosca de la estaca de la LDR (mm reales)
LDR_BORE_R = (LDR_THREAD_R + 0.3) * K
PM_PEGS = []   # sin clavijas: la cajita de la bomba se pega al extremo derecho del contenedor (v40)
PM_PEG_R, PM_PEG_L = 3.0, 10.0
TS_MAJOR, TS_CORE, TS_PITCH = 3.2, 2.2, 2.0   # tornillo de mano (mm reales): rosca gruesa de paso 2, fácil de roscar con los dedos
TS_X, TS_Z = 11.0, (185.0, 160.0)          # posición (x, z) de los 2 tornillos de mano en la pared trasera, detrás del poste
CAN_X = (-92.0, -2.0)                       # canaleta de cables (x de diseño) en la cara trasera
COMB_HALF = 31.0                            # medio ancho del peine pasacables (diseño)
COMB_Z0 = SOIL_TOP + 0.5                    # fondo de la muesca del peine
PM_WALL = 4.0                  # pared de la cajita de la bomba (2 mm reales)
ACETATE_D = 1.0              # profundidad (unid. de diseño = 0,5 mm reales) del rebaje interior para el acetato
SPLIT_X = 60.0               # plano de corte del contenedor y del labio (evita ventanas y el cajón del poste)

# desagüe de la cuenca (lado izquierdo) con tapón roscado, y suelo inclinado hacia él (medidas de la rosca REALES, mm)
SLOPE = 24.0                 # desnivel del suelo de la cuenca entre el extremo izquierdo y el divisor (unidades de diseño)
DR_MAJOR, DR_CORE, DR_PITCH, DR_LEN = 6.0, 5.0, 2.0, 8.0     # rosca del tapón: Ø12, paso 2, 8 mm de rosca
DR_X0 = -W / 2 - 14.0        # cara exterior del abultamiento del desagüe
DR_Z = FLOOR + (DR_MAJOR + 0.3) * K      # eje del desagüe: el borde inferior del agujero queda a ras del suelo
HOSE_ID = 8.0                # manguera interior 8 mm (exterior 10): púa del ducto de riego y de los conectores del depósito (mismo tamaño que la salida de las minibombas)
# conectores traseros del depósito (roscados M12 x 2 como el tapón del desagüe): A = desagüe (bajo), B = salida de la bomba hacia el riego (alto)
PORT_A = (215.0, FLOOR + RT + 13.0)     # (x, z) de diseño: conector/tapón trasero único del depósito
PORT_HOLE_D = 13.0           # taladro en la pared trasera del contenedor (mm reales)
PORT_THREAD_LEN = 7.0        # rosca engranada: pared del depósito (3) + refuerzo interior (4), mm reales
HX = 77.0                    # x de diseño por donde pasa la manguera del riego sobre la pared trasera (alineada con el colector del ducto)
CX = -59.0                   # x de diseño del paso de cables y canaleta hacia la caja electrónica


# ------------------------- ayudas -------------------------
def rrect(w, d, r, h, z0=0.0):
    return cq.Workplane("XY").workplane(offset=z0).rect(w, d).extrude(h).edges("|Z").fillet(r)


def bx(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def env(inset=0.0, z0=0.0, h=1.0):
    """Prisma con la forma de la cavidad del contenedor, reducida 'inset' + holgura por lado."""
    i = WALL + CL + inset
    return rrect(W - 2 * i, D - 2 * i, R - i, h, z0=z0)


def window(x0, x1, z0, z1, r):
    """Cortador de ventana: atraviesa el frente (lado -Y) del contenedor."""
    w, h = x1 - x0, z1 - z0
    c = cq.Workplane("XY").box(w, 80, h).edges("|Y").fillet(r)
    return c.translate(((x0 + x1) / 2, -D / 2 + 20, (z0 + z1) / 2))


def pane_cuts(win, wall_t, m=6.0):
    """Abertura por donde se ve (la ventana menos un marco de 6 u por lado) en la pared frontal de una pieza desmontable."""
    x0, x1, z0, z1, r = win
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    op = cq.Workplane("XY").box(x1 - x0 - 2 * m, wall_t + 4, z1 - z0 - 2 * m).edges("|Y").fillet(max(r - m, 1.0))
    return op.translate((cx, -Y_IN + wall_t / 2, cz))


def acetato(win, wall_t):
    """Lámina de acetato (referencia) pegada en el rebaje interior de la ventana."""
    x0, x1, z0, z1, r = win
    return (cq.Workplane("XY").box(x1 - x0 - 0.4, ACETATE_D * 0.7, z1 - z0 - 0.4).edges("|Y").fillet(r)
            .translate(((x0 + x1) / 2, -Y_IN + wall_t - ACETATE_D * 0.5, (z0 + z1) / 2)))


def acetate_cut(win, wall_t):
    """Rebaje en la cara INTERIOR de la ventana (hacia adentro, 0,5 mm reales) para pegar una lámina de acetato del tamaño de la ventana."""
    x0, x1, z0, z1, r = win
    yf = -Y_IN + wall_t
    return (cq.Workplane("XY").box(x1 - x0, ACETATE_D + 2.0, z1 - z0).edges("|Y").fillet(r)
            .translate(((x0 + x1) / 2, yf - ACETATE_D + (ACETATE_D + 2.0) / 2, (z0 + z1) / 2)))


def marco_ventana(win, margin=8.0, t=2.4, inner=None):
    """Marco (bisel) exterior que se pega alrededor de una ventana del frente; abertura = ventana (o 'inner' = (ancho, alto))."""
    x0, x1, z0, z1, r = win
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    iw, ih = inner if inner else (x1 - x0, z1 - z0)
    bez_o = cq.Workplane("XY").box(x1 - x0 + 2 * margin, t, z1 - z0 + 2 * margin).edges("|Y").fillet(r + margin)
    bez_i = cq.Workplane("XY").box(iw, t + 4, ih).edges("|Y").fillet(min(r, 3.0))
    return bez_o.cut(bez_i).translate((cx, -D / 2 - t / 2, cz))


def cyl_y(cx, cz, d, y0, y1):
    return cq.Workplane("XZ").center(cx, cz).circle(d / 2).extrude(-(y1 - y0)).translate((0, y0, 0))


def _helix(r_ref, pitch, height, pts):
    """Sólido helicoidal a lo largo de +Z (rosca): perfil pts=[(r, z)...] barrido sobre una hélice de radio r_ref."""
    helix = cq.Wire.makeHelix(pitch, height, r_ref)
    return cq.Workplane("XZ").polyline(pts).close().sweep(cq.Workplane("XY").add(helix), isFrenet=True)


HOSE_NOTCH_R = 7.6              # radio del canal en U para la púa de la manguera (la púa mide 7,2)


def cont_window(win, m=6.0):
    """Ventana del contenedor: abertura (la ventana menos 6 u por lado) + rebaje en la cara INTERIOR para pegar el acetato."""
    x0, x1, z0, z1, r = win
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    op = cq.Workplane("XY").box(x1 - x0 - 2 * m, WALL + 6, z1 - z0 - 2 * m).edges("|Y").fillet(max(r - m, 1.0)).translate((cx, -D / 2 + WALL / 2, cz))
    yf = -D / 2 + WALL
    rc = (cq.Workplane("XY").box(x1 - x0, ACETATE_D + 2.0, z1 - z0).edges("|Y").fillet(r).translate((cx, yf - ACETATE_D + (ACETATE_D + 2.0) / 2, cz)))
    return op.union(rc)


def pole_socket_box():
    """(x0, x1, y0) del cajón del poste (sin holgura)."""
    w, d = POLE_W + 18, POLE_D + 18
    return POLE_X - w / 2, POLE_X + w / 2, POLE_Y - d / 2


def pole_socket():
    """Cajón fijo a la pared trasera donde entra el poste de la lámpara (80 mm de encaje)."""
    w, d = POLE_W + 18, POLE_D + 18
    box = cq.Workplane("XY").box(w, D / 2 - WALL - (POLE_Y - d / 2) + 0.2, H - 6 - FLOOR, centered=(True, False, False)).translate((POLE_X, POLE_Y - d / 2, FLOOR))
    pocket = cq.Workplane("XY").box(POLE_W + 0.3, POLE_D + 0.3, 80, centered=(True, True, False)).translate((POLE_X, POLE_Y, H - 6 - 80))
    return box.cut(pocket)


# ------------------------- 1. CONTENEDOR PRINCIPAL (morado) -------------------------
def contenedor_principal():
    outer = rrect(W, D, R, H).faces(">Z").edges().fillet(EDGE)
    cav = rrect(W - 2 * WALL, D - 2 * WALL, R - WALL, H, z0=FLOOR)
    b = outer.cut(cav)
    # divisor: separa la cuenca de la bandeja del hueco del depósito (se funde con paredes y fondo)
    div = rrect(W - 2 * WALL + 2, D - 2 * WALL + 2, R - WALL + 1, SOIL_TOP - FLOOR + 1, z0=FLOOR - 1).intersect(bx(DIV[0], DIV[1], -300, 300, 0, 400))
    b = b.union(div)
    # apoyo de la bandeja SIN postes: reborde perimetral bajo sus paredes (frente, fondo y lado del divisor) y dos rieles en el sentido del agua.
    # El extremo izquierdo queda libre para que el agua llegue al desagüe.
    b = b.union(bx(DIV[0] - LEDGE_W, DIV[0], -D / 2 + WALL - 1, D / 2 - WALL + 1, FLOOR - 1, Z_TB))
    for ry in RAILS_Y:
        b = b.union(bx(-262, DIV[0] - LEDGE_W + 1, ry - 4, ry + 4, FLOOR - 1, Z_TB))
    b = b.union(pole_socket())
    # suelo de la cuenca inclinado hacia el desagüe de la izquierda (cuña que se funde con paredes y fondo)
    xl, xr = -W / 2 + WALL, DIV[0]
    zf = lambda x: FLOOR + SLOPE * (x - xl) / (xr - xl)
    wedge = (cq.Workplane("XZ").polyline([(-W / 2, zf(-W / 2)), (xr, zf(xr)), (xr, FLOOR - 1), (-W / 2, FLOOR - 1)]).close().extrude(300, both=True))
    b = b.union(wedge.intersect(rrect(W - 2 * WALL + 2, D - 2 * WALL + 2, R - WALL + 1, 60, z0=FLOOR - 1)))
    # desagüe: abultamiento con base plana (se imprime sin soportes), agujero Ø12,6 y rosca interna para el tapón
    Rb = (DR_MAJOR + 0.3 + 3.0) * K
    boss = cq.Workplane("YZ").center(0, DR_Z).circle(Rb).extrude(14.0 + WALL + 1).translate((DR_X0, 0, 0))
    boss = boss.union(bx(DR_X0, DR_X0 + 14.0 + WALL + 1, -Rb, Rb, 0, DR_Z))
    b = b.union(boss)
    b = b.cut(cq.Workplane("YZ").center(0, DR_Z).circle((DR_MAJOR + 0.3) * K).extrude(40).translate((DR_X0 - 1, 0, 0)))
    try:
        nut = _helix(DR_MAJOR + 0.3, DR_PITCH, DR_LEN, [(DR_MAJOR + 0.9, -0.8), (DR_CORE + 0.3, -0.2), (DR_CORE + 0.3, 0.2), (DR_MAJOR + 0.9, 0.8)])
        nut = nut.rotate((0, 0, 0), (0, 1, 0), 90)
        nut = cq.Workplane("XY").newObject([nut.val().scale(K)]).translate((DR_X0, 0, DR_Z))
        b = b.union(nut)
    except Exception as e:
        print("AVISO: rosca interna del desagüe no generada:", e)
    # ventanas del frente (la bandeja y el depósito traen su propio acrílico)
    for wn in (WIN_SOIL, WIN_GAUGE):
        b = b.cut(cont_window(wn))
    # taladros traseros para los dos conectores de manguera del depósito
    for (px, pz) in (PORT_A,):
        b = b.cut(cyl_y(px, pz, PORT_HOLE_D * K, D / 2 - WALL - 2, D / 2 + 5))
    # paso de la manguera del riego sobre la pared trasera: muesca abierta por arriba (la tapa tiene su canal encima)
    b = b.cut(cyl_y(HX, PIPE_ZC, 2 * HOSE_NOTCH_R, D / 2 - WALL - 2, D / 2 + 3))      # agujero redondo para el niple de la manguera
    # peine pasacables: muesca abierta por arriba en la pared trasera (z 205,5 .. labio) donde se apoyan los cables de los sensores
    b = b.cut(bx(CX - COMB_HALF - 0.4, CX + COMB_HALF + 0.4, D / 2 - WALL - 1.0, D / 2 + 1.0, COMB_Z0, H + 2))
    # paso de los cables de la lámpara: sale por la base del poste (esquina izquierda), atraviesa el cajón y la pared y cae a la canaleta
    b = b.cut(bx(POLE_X - 13.5, POLE_X - 3.5, POLE_Y + 6, D / 2 + 1.0, H - 6 - 80 - 1, H - 6 - 80 + 19))
    # tornillos de mano (rosca gruesa) detrás del poste: presionan su cara trasera y lo dejan firme
    for tz in TS_Z:
        b = b.cut(cyl_y(TS_X, tz, 2 * (TS_MAJOR + 0.3) * K, POLE_Y + POLE_D / 2 - 0.3, D / 2 + 1.0))
        try:
            nt = _helix(TS_MAJOR + 0.3, TS_PITCH, 6.0, [(TS_MAJOR + 0.9, -0.8), (TS_CORE + 0.3, -0.2), (TS_CORE + 0.3, 0.2), (TS_MAJOR + 0.9, 0.8)])
            nt = nt.rotate((0, 0, 0), (1, 0, 0), 90)
            b = b.union(cq.Workplane("XY").newObject([nt.val().scale(K)]).translate((TS_X, D / 2 - 1.0, tz)))
        except Exception as e:
            print("AVISO: rosca del tornillo de mano no generada:", e)
    # paso del cable del DS18B20 (pared trasera) — diámetro real
    b = b.cut(cyl_y(DS_XZ[0], DS_XZ[1], (6.5 + 0.5) * K, D / 2 - WALL - 2, D / 2 + 5))
    # pantalla OLED centrada en el frente: nicho exterior (la placa se pega con el vidrio hacia afuera) + abertura en cruz para pines y cables
    pw, ph = (SCR_PCB[0] + 0.6) * K, (SCR_PCB[1] + 0.6) * K
    b = b.cut(bx(-pw / 2, pw / 2, -D / 2 - 1, -D / 2 + SCR_REBATE * K, SCR_Z - ph / 2, SCR_Z + ph / 2))
    b = b.cut(bx(-12 * K, 12 * K, -D / 2 - 1, -D / 2 + WALL + 2, SCR_Z - 10 * K, SCR_Z + 10 * K))
    b = b.cut(bx(-6 * K, 6 * K, -D / 2 - 1, -D / 2 + WALL + 2, SCR_Z - 13.2 * K, SCR_Z + 13.2 * K))
    # 4 taladros piloto M2 en las esquinas de la placa (tornillos desde el frente a través de los agujeros de la placa)
    for sx in (-1, 1):
        for sz in (-1, 1):
            b = b.cut(cq.Workplane("XZ").center(sx * SCR_HOLES[0] / 2 * K, SCR_Z + sz * SCR_HOLES[1] / 2 * K).circle(0.9 * K)
                      .extrude(-(SCR_SCREW_DEPTH * K + 1.0)).translate((0, -D / 2 + SCR_REBATE * K - 1.0, 0)))
    # rebaje EXTERIOR para el acetato que protege la pantalla (se pega por fuera con silicona)
    b = b.cut(bx(-pw / 2 - 3, pw / 2 + 3, -D / 2 - 1, -D / 2 + ACETATE_D, SCR_Z - ph / 2 - 3, SCR_Z + ph / 2 + 3))
    # alojamiento de la bomba externa: 2 agujeros ciegos en la pared del extremo derecho para las clavijas de la cajita
    for (py, pz) in PM_PEGS:
        b = b.cut(cq.Workplane("YZ").center(py, pz).circle(PM_PEG_R + 0.4).extrude(-(PM_PEG_L + 0.5)).translate((W / 2 + 0.01, 0, 0)))
    return b


def labio():
    """Marco superior: tapa el canto de las paredes (z >= H, sin invadir). Con un canal inferior para los cables, en la parte trasera."""
    o = rrect(W + 6, D + 6, R + 3, 10, z0=H)
    i = rrect(W - 2 * WALL + 2, D - 2 * WALL + 2, R - WALL + 1, 10, z0=H)
    l = o.cut(i).faces(">Z").edges().fillet(2.5)
    return l


# ------------------------- 2. BANDEJA DE LA TIERRA (negro) -------------------------
def _tray_solids():
    outer = env(0, Z_TB, SOIL_TOP - Z_TB).intersect(bx(-400, TRAY_X1, -300, 300, 0, 400))
    cav = env(TT, Z_TB + TF, SOIL_TOP - Z_TB).intersect(bx(-400, TRAY_X1 - TT, -300, 300, 0, 400))
    sx0, sx1, sy0 = pole_socket_box()
    outer = outer.cut(bx(sx0 - CL, sx1 + CL, sy0 - CL, 300, 0, 400))
    wallzone = bx(sx0 - CL - TT, sx1 + CL + TT, sy0 - CL - TT, 300, 0, 400)
    cav = cav.cut(wallzone)
    return outer, cav, wallzone


def bandeja_tierra():
    outer, cav, wallzone = _tray_solids()
    # el fondo se construye aparte (placa con la reja de huecos) y se funde con las paredes: así la operación es ligera
    cav_open = env(TT, Z_TB - 1, SOIL_TOP - Z_TB + 1).intersect(bx(-400, TRAY_X1 - TT, -300, 300, 0, 400)).cut(wallzone)
    t = outer.cut(cav_open)
    # fondo en reja: matriz de huecos mínimos (Ø2 mm, paso 4 mm a escala 0.5) en todo el piso, lejos de las paredes, del cajón del poste y del canal de la pantalla
    sx0, sx1, sy0 = pole_socket_box()
    pitch, rad = GRID_PITCH * K, GRID_D * K / 2
    x0, x1, hy, rc = -W / 2 + WALL + CL + TT, TRAY_X1 - TT, D / 2 - WALL - CL - TT, R - WALL - CL - TT
    cxc, cyc = x0 + rc, hy - rc
    pts, mg = [], 7.0
    for i in range(int((x1 - x0) // pitch) + 1):
        for j in range(int((2 * hy) // pitch) + 1):
            x, y = x0 + mg + i * pitch, -hy + mg + j * pitch
            if x > x1 - mg or y > hy - mg:
                continue
            if x < cxc and (x - cxc) ** 2 + (abs(y) - cyc) ** 2 > (rc - mg) ** 2 and abs(y) > cyc:
                continue
            if sx0 - CL - TT - mg < x < sx1 + CL + TT + mg and y > sy0 - CL - TT - mg:
                continue
            if abs(x) < 29 + mg and y < -Y_IN + TT + 27 + mg:
                continue
            pts.append((x, y))
    slab = env(TT - 0.5, Z_TB, TF).intersect(bx(-400, TRAY_X1, -300, 300, 0, 400)).cut(bx(sx0 - CL, sx1 + CL, sy0 - CL, 300, 0, 400))
    if GRID_ON:
        slab = slab.cut(cq.Workplane("XY").workplane(offset=Z_TB - 1).pushPoints(pts).circle(rad).extrude(TF + 2))
    t = t.union(slab)
    # ventana de la tierra: rebaje + abertura en la pared frontal
    t = t.cut(pane_cuts(WIN_SOIL, TT)).cut(acetate_cut(WIN_SOIL, TT))
    # paso del cable del DS18B20 (pared trasera de la bandeja)
    t = t.cut(cyl_y(DS_XZ[0], DS_XZ[1], (6.5 + 0.5) * K, D / 2 - WALL - TT - 2, D / 2))
    # muesca de la pared trasera por donde sale la púa del riego (abierta por arriba; el fondo queda por encima de la tierra)
    t = t.cut(cyl_y(HX, PIPE_ZC, 2 * HOSE_NOTCH_R, D / 2 - WALL - CL - TT - 1, D / 2))
    # asiento en el borde de la pared izquierda para la barra del sistema de riego (queda al ras)
    t = t.cut(bx(-W / 2 + WALL + CL - 1.0, -W / 2 + WALL + CL + TT, -66, 66, SOIL_TOP - 6.0, SOIL_TOP + 1))
    # riego integrado + soportes de esquina de las LDR + asas al ras del borde (la bandeja se imprime boca abajo, sin soportes)
    t = t.union(_brackets()).union(probe_clips())
    for xc in (112.0,):
        lug = bx(-300 if xc < 0 else xc - 11, xc + 11 if xc < 0 else 300, -26, 26, SOIL_TOP - 8, SOIL_TOP).cut(cq.Workplane("XY").workplane(offset=SOIL_TOP - 9).center(xc, 0).circle(7).extrude(10))
        t = t.union(lug.intersect(env(0, 0, 400)).intersect(bx(-400, TRAY_X1, -300, 300, 0, 400)))
    # el riego integrado se entrega como sólido propio solapado con la bandeja (la unión B-Rep de tubos con las paredes sale inválida);
    # al exportar, las mallas se unen en un único cuerpo hermético
    return t


def _bracket_one(cx, cy):
    """Escuadra de esquina: pilar con taladro roscado para la estaca de la LDR y dos aletas que se funden con las paredes de la bandeja."""
    sx, sy = (-1 if cx < 0 else 1), (-1 if cy < 0 else 1)
    r = 16.0
    boss = cq.Workplane("XY").workplane(offset=BRK_Z0).center(cx, cy).circle(r).extrude(SOIL_TOP - BRK_Z0)
    wall_x = sx * (W / 2 - WALL - CL - TT + 3.0) if cx < 0 else TRAY_X1 - TT + 3.0
    rx = bx(min(cx, wall_x), max(cx, wall_x), cy - 4, cy + 4, BRK_Z0 + 20, SOIL_TOP)
    ry = bx(cx - 4, cx + 4, min(cy, sy * (D / 2 - WALL - CL - TT + 3.0)), max(cy, sy * (D / 2 - WALL - CL - TT + 3.0)), BRK_Z0 + 20, SOIL_TOP)
    # rampa a 45° bajo el pilar (de la pared hacia el pilar): el pilar ya no empieza en el aire y se imprime sin soportes
    dirw = 1.0 if wall_x > cx else -1.0
    far = cx - dirw * r
    dist = abs(wall_x - far)
    zlow = max(BRK_Z0 - dist, 2.0)
    ramp = (cq.Workplane("XZ", origin=(0, cy + r, 0)).polyline([(far, BRK_Z0), (wall_x, zlow), (wall_x, SOIL_TOP), (far, SOIL_TOP)]).close().extrude(2 * r))
    foot = cq.Workplane("XY").workplane(offset=0).center(cx, cy).circle(r).extrude(SOIL_TOP).union(bx(min(cx, wall_x), max(cx, wall_x), cy - r, cy + r, 0, SOIL_TOP))
    ramp = ramp.intersect(foot)
    return boss.union(rx).union(ry).union(ramp)


def _brackets(bore=True):
    allb = None
    for (cx, cy) in LDR_POS.values():
        b = _bracket_one(cx, cy)
        allb = b if allb is None else allb.union(b)
    allb = allb.intersect(env(0, 0, 400).intersect(bx(-400, TRAY_X1, -300, 300, 0, 400)))
    if bore:
        for (cx, cy) in LDR_POS.values():
            allb = allb.cut(cq.Workplane("XY").workplane(offset=BRK_Z0 + 3).center(cx, cy).circle(LDR_BORE_R).extrude(SOIL_TOP - BRK_Z0))
            try:
                allb = allb.union(_ldr_nut(cx, cy))
            except Exception as e:
                print("AVISO: rosca de la escuadra LDR no generada:", e)
    return allb


def riego_integrado():
    """Riego integrado a la bandeja: 4 ramales perforados (paralelos a X) + colector en Y + púa trasera de manguera. Todo al ras del borde,
    así la bandeja se imprime boca abajo sin soportes. Devuelve (sólido unido a la bandeja, referencia). Gotea a través de orificios que crecen con la distancia."""
    xm, xl = HX, -W / 2 + WALL + CL + TT + 1.0
    zc = PIPE_ZC
    def cyx(x0, x1, y, r):
        return cq.Workplane("YZ").center(y, zc).circle(r).extrude(x1 - x0).translate((x0, 0, 0))
    def cyy(y0, y1, x, r):
        return cq.Workplane("XZ").center(x, zc).circle(r).extrude(-(y1 - y0)).translate((0, y0, 0))
    ymax = PIPE_Y[-1]
    col = cyy(-ymax - 9, D / 2 - WALL - CL - TT - 1.0, xm, 9.0)
    sol = col.union(bx(-W / 2 + WALL + CL - 0.5, -W / 2 + WALL + CL + TT + 8.0, -64, 64, SOIL_TOP - 5.6, SOIL_TOP))   # barra de apoyo en el asiento de la pared izquierda
    for y in PIPE_Y:
        sol = sol.union(cyx(xl, xm, y, 8.0))
    sol = sol.intersect(bx(-400, 400, -300, 300, 0, SOIL_TOP))                      # cara superior plana al ras del borde
    # canal interior
    sol = sol.cut(cyy(-ymax - 5, D / 2 - WALL - CL - TT - 1.0, xm, 5.0))
    sol = sol.cut(cyy(D / 2 - WALL - CL - TT - 10.0, D / 2 - WALL - CL - TT, xm, 7.0))     # alojamiento del niple (Ø14 de diseño)
    for y in PIPE_Y:
        sol = sol.cut(cyx(xl + 4, xm, y, 4.5))
    # goteo: Ø1,0 mm real cerca del colector -> Ø1,6 mm real en el extremo lejano (hacia abajo), y los ramales exteriores también hacia las paredes
    pitch = 36.0
    n = int((xm - 8 - (xl + 8)) // pitch) + 1
    for i in range(n):
        x = xm - 14 - i * pitch
        rad = 1.0 + 0.6 * i / max(n - 1, 1)
        for y in PIPE_Y:
            sol = sol.cut(cq.Workplane("XY").workplane(offset=zc - 12).center(x, y).circle(rad).extrude(12))
            if abs(y) > 40:
                sgn = 1 if y > 0 else -1
                inc = cq.Workplane("XY").workplane(offset=-20).circle(rad).extrude(20).rotate((0, 0, 0), (1, 0, 0), sgn * 45).translate((x, y, zc))
                sol = sol.cut(inc)
    return sol, None


def _ldr_nut(cx, cy):
    """Rosca interna del taladro de la escuadra (mismo paso/hélice que la estaca, media vuelta desfasada)."""
    nut = _helix(LDR_BORE_R, LDR_PITCH_R * K, 15.0 * K, [(LDR_BORE_R + 0.6 * K, -1.2 * K), (LDR_CORE_R * K + 0.3 * K, -0.25 * K), (LDR_CORE_R * K + 0.3 * K, 0.25 * K), (LDR_BORE_R + 0.6 * K, 1.2 * K)])
    z_start = SOIL_TOP - 22.0 * K + 1.5 * K
    return cq.Workplane("XY").newObject([nut.val()]).translate((cx, cy, z_start))


def niche_ext():
    return bx(-14.5 * K, 14.5 * K, -Y_IN + TT - 0.01, -Y_IN + TT + 13.5 * K, SCR_Z - 15.5 * K, SOIL_TOP)


def niche_int():
    cut = bx(-13 * K, 13 * K, -Y_IN + TT - 0.01, -Y_IN + TT + 12 * K, SCR_Z - 14 * K, SOIL_TOP + 1)
    return cut.union(bx(-13 * K, 13 * K, -Y_IN - 1, -Y_IN + TT + 1, SCR_Z - 14 * K, SCR_Z + 14 * K))


def soil():
    """Sustrato (solo referencia; en la maqueta se usa tierra real)."""
    outer, cav, _ = _tray_solids()
    return cav.intersect(bx(-400, 400, -300, 300, 0, SOIL_FILL)).cut(_brackets(bore=False))


# ------------------------- 3. DEPÓSITO DE AGUA (rojo) -------------------------
def _tank_cavity():
    return env(RT, FLOOR + RT, 400).intersect(bx(TANK_X0 + RT, 400, -300, 300, 0, 400)).intersect(bx(-400, 400, -300, 300, 0, TANK_TOP + 1))


TK_HY, TK_HX = 14.0, 8.0          # desnivel del suelo del depósito: hacia atrás (donde está la salida) y hacia el eje de la salida


def _tank_slopes():
    """Cuñas que inclinan el suelo del depósito hacia la salida trasera (punto más bajo en la esquina de la toma)."""
    z0 = FLOOR + RT
    yb = Y_IN - RT
    x0, x1 = TANK_X0 + RT, 290.0
    wy = cq.Workplane("YZ").polyline([(-yb, z0 + TK_HY), (yb, z0), (yb, z0 - 1), (-yb, z0 - 1)]).close().extrude(x1 - x0).translate((x0, 0, 0))
    px = PORT_A[0]
    wx1 = cq.Workplane("XZ").polyline([(x0, z0 + TK_HX), (px, z0), (px, z0 - 1), (x0, z0 - 1)]).close().extrude(yb, both=True)
    wx2 = cq.Workplane("XZ").polyline([(px, z0), (x1, z0 + TK_HX), (x1, z0 - 1), (px, z0 - 1)]).close().extrude(yb, both=True)
    return wy.union(wx1).union(wx2).intersect(_tank_cavity())


def _port_boss(px, pz):
    """Refuerzo interior (8 mm de diseño) + taladro roscado M12 x 2 en la pared trasera del depósito para un conector de manguera."""
    Rb = (DR_MAJOR + 0.3 + 3.0) * K
    return cyl_y(px, pz, 2 * Rb, Y_IN - RT - 20.0, Y_IN - RT + 1.0)


def _port_bore(px, pz):
    return cyl_y(px, pz, 2 * (DR_MAJOR + 0.3) * K, Y_IN - RT - 18.0, Y_IN + 2.0)


def _port_nut(px, pz):
    nut = _helix(DR_MAJOR + 0.3, DR_PITCH, PORT_THREAD_LEN - 2.0, [(DR_MAJOR + 0.9, -0.8), (DR_CORE + 0.3, -0.2), (DR_CORE + 0.3, 0.2), (DR_MAJOR + 0.9, 0.8)])
    nut = nut.rotate((0, 0, 0), (1, 0, 0), 90)                       # el eje +Z pasa a -Y: entra desde la cara trasera hacia adentro
    return cq.Workplane("XY").newObject([nut.val().scale(K)]).translate((px, Y_IN - 10.0, pz))


def deposito_agua():
    outer = env(0, FLOOR, TANK_TOP - FLOOR).intersect(bx(TANK_X0, 400, -300, 300, 0, 400))
    t = outer.cut(_tank_cavity()).union(_tank_slopes())
    for (px, pz) in (PORT_A,):
        t = t.union(_port_boss(px, pz)).cut(_port_bore(px, pz))
        try:
            t = t.union(_port_nut(px, pz))
        except Exception as e:
            print("AVISO: rosca interna del conector no generada:", e)
    t = t.cut(pane_cuts(WIN_GAUGE, RT)).cut(acetate_cut(WIN_GAUGE, RT))
    return t


def tapa_deposito():
    """Tapa: placa (z 199..205) + tapón que entra en el depósito; agujeros de llenado, manguera y cable; asa para levantar el depósito.
    Se pega al depósito con silicona."""
    plate = env(0, TANK_TOP, RT).intersect(bx(TANK_X0, 400, -300, 300, 0, 400))
    plug = env(RT + 0.4, TANK_TOP - 4, 4.2).intersect(bx(TANK_X0 + RT + 0.4, 400, -300, 300, 0, 400))
    lid = plate.union(plug)
    lid = lid.cut(cq.Workplane("XY").workplane(offset=TANK_TOP - 10).center(*FILL).circle(16).extrude(30))
    for sy in (-1, 1):                                # ventanas acústicas del ultrasonido
        lid = lid.cut(cq.Workplane("XY").workplane(offset=TANK_TOP - 10).center(US_C[0], US_C[1] + sy * US_PITCH / 2 * K).circle((US_CAN_D + 1.0) * K / 2).extrude(30))
    hx = 212.0                                        # asa (entre el soporte del ultrasonido y los agujeros de la manguera)
    for sy in (-1, 1):
        lid = lid.union(bx(hx - 4, hx + 4, sy * 40 - 4, sy * 40 + 4, SOIL_TOP - 1, SOIL_TOP + 22))
    lid = lid.union(bx(hx - 4, hx + 4, -44, 44, SOIL_TOP + 14, SOIL_TOP + 22))
    return lid


def tapon_drenaje():
    """Tapón roscado del desagüe (medidas reales): cabeza Ø16 con ranura para destornillador de pala (1,8 x 1,5 mm), rosca Ø12 paso 2.
    Sella con la rosca + una arandela de goma o cinta de teflón. Eje a lo largo de +Z; la cabeza está en z=0..3 y la cara exterior en z=0."""
    head = cq.Workplane("XY").circle(8.0).extrude(3.0)
    head = head.cut(cq.Workplane("XY").box(18.0, 1.8, 1.5, centered=(True, True, False)))
    core = cq.Workplane("XY").workplane(offset=3.0).circle(DR_CORE).extrude(DR_LEN + 0.5)
    pl = head.union(core)
    try:
        th = _helix(DR_CORE - 0.6, DR_PITCH, DR_LEN - 2.0, [(DR_CORE - 0.6, -0.8), (DR_MAJOR, -0.2), (DR_MAJOR, 0.2), (DR_CORE - 0.6, 0.8)]).translate((0, 0, 4.0))
        pl = pl.union(th)
    except Exception as e:
        print("AVISO: rosca del tapón no generada:", e)
    return pl


def fill_port():
    """Tapón de la boca de llenado: cabeza + espiga que entra en el agujero de la tapa."""
    head = cq.Workplane("XY").workplane(offset=SOIL_TOP).center(*FILL).circle(28).workplane(offset=14).circle(22).loft()
    plug = cq.Workplane("XY").workplane(offset=SOIL_TOP - 14).center(*FILL).circle(15.4).extrude(14)
    pl = head.union(plug)
    return pl.cut(cq.Workplane("XY").box(56.0, 3.6, 5.0, centered=(True, True, False)).translate((FILL[0], FILL[1], SOIL_TOP + 14 - 5)))   # ranura para destornillador de pala


def gauge():
    """Ventana de nivel: marco exterior (se pega sobre el contenedor) y acetato interior."""
    return marco_ventana(WIN_GAUGE), acetato(WIN_GAUGE, RT)


def tank_water():
    """Agua de referencia: nivel a z=120 dentro del depósito, sin la bomba ni su plataforma."""
    w = _tank_cavity().intersect(bx(-400, 400, -300, 300, 0, 120)).cut(_tank_slopes())
    for (px, pz) in (PORT_A,):
        w = w.cut(_port_boss(px, pz))
    return w


# ------------------------- lámpara, sensores, caja -------------------------
SERVO_Y = -60.0                                 # desplazamiento en Y del servo sobre la tapa
HINGE_Y2 = LAMP_W / 2 + 10.0                    # eje de las bisagras (borde trasero de la tapa, a lo largo de X)
HINGE_Z = LAMP_Z + LAMP_CAV + 3.5
LAMP_OPEN = 105.0                               # ángulo máximo de apertura (la tapa queda recostada hacia atrás)
HINGE_LUG = (156.0, 182.0)                      # x de la oreja fija de la copa (y su espejo); la tapa lleva dos nudillos a cada lado
HINGE_KN = ((126.0, 154.0), (184.0, 212.0))
# --- mecanismo de apertura: servo FIJO en la copa (cápsula trasera) -> brazo -> biela -> oreja de la tapa (biela-manivela; mm reales relativos al eje de la bisagra)
MECH_S = (24.0, -12.0)          # eje del servo (y, z)
MECH_C = 12.0                   # longitud del brazo (manivela)
MECH_A = (5.0, -3.0)             # punto de la oreja de la tapa donde se une la biela
MECH_PHI0 = 70.0               # ángulo del brazo con la tapa cerrada (desde +Y hacia +Z)
XF = 100.0                      # x de la cara del eje del servo (unidades de diseño)
T_HORN, T_ROD, T_TAB = (0.3, 2.3), (2.6, 4.4), (4.7, 8.7)    # posiciones en x (mm reales) medidas desde la cara del servo: brazo, biela, oreja de la tapa


def mech_pose(theta_deg):
    """Posición (mm reales, y-z relativos a la bisagra) de A (oreja), C (extremo del brazo) y ángulo del brazo para una apertura dada."""
    import math
    t = math.radians(theta_deg)
    ay, az = MECH_A
    A = (ay * math.cos(t) + az * math.sin(t), -ay * math.sin(t) + az * math.cos(t))
    C0 = (MECH_S[0] + MECH_C * math.cos(math.radians(MECH_PHI0)), MECH_S[1] + MECH_C * math.sin(math.radians(MECH_PHI0)))
    L = math.hypot(ay - C0[0], az - C0[1])
    dy, dz = A[0] - MECH_S[0], A[1] - MECH_S[1]
    d = math.hypot(dy, dz); ang = math.atan2(dz, dy); b = math.acos(max(-1, min(1, (MECH_C ** 2 + d * d - L * L) / (2 * MECH_C * d))))
    p0 = math.atan2(*(C0[1] - MECH_S[1], C0[0] - MECH_S[0])); a0 = math.atan2(az - MECH_S[1], ay - MECH_S[0]) - p0   # rama inicial
    d0 = math.hypot(ay - MECH_S[0], az - MECH_S[1]); b0 = math.acos(max(-1, min(1, (MECH_C ** 2 + d0 * d0 - L * L) / (2 * MECH_C * d0))))
    sg = 1.0 if abs(((math.atan2(az - MECH_S[1], ay - MECH_S[0]) + b0) - p0 + math.pi) % (2 * math.pi) - math.pi) < abs(((math.atan2(az - MECH_S[1], ay - MECH_S[0]) - b0) - p0 + math.pi) % (2 * math.pi) - math.pi) else -1.0
    ph = ang + sg * b
    C = (MECH_S[0] + MECH_C * math.cos(ph), MECH_S[1] + MECH_C * math.sin(ph))
    return dict(A=A, C=C, phi=math.degrees(ph), L=L, sg=sg, C0=C0)


def servo_geom():
    """Posiciones del servo y su cápsula en unidades de diseño (eje del servo en X, cara del eje en x=XF)."""
    sxl = SERVO[2] * K
    g = dict(sxl=sxl, XP=XF - 6.9 * K, SV_Y=HINGE_Y2 + MECH_S[0] * K, SV_Z=HINGE_Z + MECH_S[1] * K)
    g["ya"], g["yb"] = g["SV_Y"] - 5.9 * K, g["SV_Y"] + (SERVO[0] - 5.9) * K
    g["za"], g["zb"] = g["SV_Z"] - SERVO[1] * K / 2, g["SV_Z"] + SERVO[1] * K / 2
    return g


def lamp():
    """Lámpara: CUERPO fijo (copa ovalada unida al poste) con un canal continuo para tira LED en TODO el contorno interior ,
    piso liso y orejas de bisagra; y TAPA (losa oscura) que abre hacia atrás como una caneca, girando sobre la bisagra. El servo va en la base (cápsula trasera). Piso hueco para que entre luz natural."""
    z0 = LAMP_Z
    wall = 5.0
    top = z0 + LAMP_CAV - 0.6
    cup = cq.Workplane("XY").workplane(offset=z0 - 6.0).slot2D(LAMP_L, LAMP_W, 0).extrude(top - (z0 - 6.0))
    cup = cup.cut(cq.Workplane("XY").workplane(offset=z0 + 2.0).slot2D(LAMP_L - 2 * wall, LAMP_W - 2 * wall, 0).extrude(LAMP_CAV + 2.0))
    zg0, zg1 = z0 + 2.5, z0 + 24.5                                       # canal continuo (22 de alto = 11 mm: tira de 10 mm) en toda la pared interior
    grv = (cq.Workplane("XY").workplane(offset=zg0).slot2D(LAMP_L - 2 * wall + 4.0, LAMP_W - 2 * wall + 4.0, 0).extrude(zg1 - zg0)
           .cut(cq.Workplane("XY").workplane(offset=zg0 - 1).slot2D(LAMP_L - 2 * wall, LAMP_W - 2 * wall, 0).extrude(zg1 - zg0 + 2)))
    cup = cup.cut(grv)
    FR = 15.0                                                            # PISO HUECO: queda solo un aro de 7,5 mm (soporta la tira LED) y un puente trasero para el poste; el resto es abierto para que pase luz natural
    win = cq.Workplane("XY").workplane(offset=z0 - 7.0).slot2D(LAMP_L - 2 * FR, LAMP_W - 2 * FR, 0).extrude(10.0)
    win = win.cut(bx(-30.0, 30.0, 50.0, 130.0, z0 - 8.0, z0 + 4.0))
    cup = cup.cut(win)
    cup = cup.cut(bx(-7, 7, 82, 94, z0 - 7.0, z0 + 3.0))                 # paso del cable desde el poste hacia el interior
    for xe in (-1, 1):                                                   # orejas fijas de la bisagra en el borde trasero de la copa
        x0, x1 = sorted((xe * HINGE_LUG[0], xe * HINGE_LUG[1]))
        cup = cup.union(bx(x0, x1, 94.0, HINGE_Y2 + 8.0, z0 + LAMP_CAV - 14.0, z0 + LAMP_CAV + 11.0))
        cup = cup.cut(cq.Workplane("YZ").center(HINGE_Y2, HINGE_Z).circle(3.6).extrude(x1 - x0 + 2.0).translate((x0 - 1.0, 0, 0)))
    cup = cup.cut(bx(XF + 2.0 * K, XF + 9.4 * K, 92.0, 101.5, z0 + 12.0, z0 + LAMP_CAV + 2.0))               # ranura en la pared trasera: por ahí pasan la oreja de la tapa y la biela al abrir
    g = servo_geom()                                                       # cápsula del servo pegada a la pared trasera de la copa (el servo queda en la BASE)
    px0, px1 = XF - g["sxl"] - 0.6 - 3.0, g["XP"]
    py0, py1 = 97.0, g["yb"] + 4.9 * K + 2.0
    pz0, pz1 = z0 - 6.0, g["zb"] + 0.6 + 3.0
    cup = cup.union(bx(px0, px1, py0, py1, pz0, pz1).edges("|X").fillet(2.0))
    cup = cup.cut(bx(px0 + 3.0, px1 + 1.0, g["ya"] - 0.6, g["yb"] + 0.6, g["za"] - 0.6, g["zb"] + 0.6))                    # bolsillo del servo (entra por la cara +X)
    cup = cup.cut(cq.Workplane("YZ").center(g["SV_Y"] + 6.0 * K, g["SV_Z"]).circle(2.8 * K).extrude(6.0).translate((px0 - 1.0, 0, 0)))   # salida del cable del servo (hacia el poste)
    for ye in (g["ya"] - 4.9 * K + 2.8 * K, g["yb"] + 4.9 * K - 2.8 * K):                                                                    # guías para tornillos de las orejas del servo
        cup = cup.cut(cq.Workplane("YZ").center(ye, g["SV_Z"]).circle(0.75 * K).extrude(-10.0).translate((g["XP"] + 0.1, 0, 0)))
    body = cup
    # referencia de LED: solo la tira del contorno (piso liso, sin LED)
    ring = (cq.Workplane("XY").workplane(offset=zg0 + 0.5).slot2D(LAMP_L - 2 * wall + 3.6, LAMP_W - 2 * wall + 3.6, 0).extrude(zg1 - zg0 - 1.0)
            .cut(cq.Workplane("XY").workplane(offset=zg0).slot2D(LAMP_L - 2 * wall + 1.2, LAMP_W - 2 * wall + 1.2, 0).extrude(zg1 - zg0 + 1)))
    leds = ring
    # tapa: losa con labio de centrado, agujeros de las guías, paso de la columna y cajón del servo SG90 (abierto por arriba)
    SK_T, SK_H = 4.0, 18.0                                               # faldón: pared 4 y 18 de alto, cubre el borde de la copa como la tapa de una caja
    Lo, Wo = LAMP_L + 2 * (SK_T + 0.6), LAMP_W + 2 * (SK_T + 0.6)
    lid = cq.Workplane("XY").workplane(offset=z0 + LAMP_CAV).slot2D(Lo, Wo, 0).extrude(LAMP_T - LAMP_CAV).faces(">Z").edges().fillet(3.0)
    skirt = (cq.Workplane("XY").workplane(offset=z0 + LAMP_CAV - SK_H).slot2D(Lo, Wo, 0).extrude(SK_H + 0.1)
             .cut(cq.Workplane("XY").workplane(offset=z0 + LAMP_CAV - SK_H - 1).slot2D(LAMP_L + 1.2, LAMP_W + 1.2, 0).extrude(SK_H + 2.0)))
    skirt = skirt.cut(bx(-400, 400, 10.0, 200, z0 + LAMP_CAV - SK_H - 2, z0 + LAMP_CAV + 1))    # sin faldón del lado de la bisagra: al abrir giraría contra la copa
    lid = lid.union(skirt)
    for xe in (-1, 1):                                                   # bisagra: 2 nudillos de la tapa a cada lado de la oreja fija + hueco para esa oreja
        x0, x1 = sorted((xe * HINGE_LUG[0], xe * HINGE_LUG[1])); x0 -= 2.0; x1 += 2.0
        lid = lid.cut(bx(x0, x1, 82.0, HINGE_Y2 + 10.0, z0 + LAMP_CAV - 1.0, z0 + LAMP_T + 6.0))
        for kn in HINGE_KN:
            k0, k1 = sorted((xe * kn[0], xe * kn[1]))
            lid = lid.union(bx(k0, k1, 88.0, HINGE_Y2 + 8.0, z0 + LAMP_CAV, z0 + LAMP_T))                       # nudillo al ras de la cara superior (la tapa se imprime boca abajo, plana)
            bcyl = cq.Workplane("YZ").center(HINGE_Y2, HINGE_Z).circle(7.8).extrude(k1 - k0).translate((k0, 0, 0)).intersect(bx(k0 - 1, k1 + 1, 80.0, 130.0, z0 + LAMP_CAV - 6.0, z0 + LAMP_T))
            lid = lid.union(bcyl)                                                                          # nudillo redondo (R 7,8) que da carne alrededor del eje y no roza la pared de la copa al girar
        bx0, bx1 = sorted((xe * HINGE_KN[0][0], xe * HINGE_KN[1][1])); bx0 -= 2.0; bx1 += 2.0
        lid = lid.cut(cq.Workplane("YZ").center(HINGE_Y2, HINGE_Z).circle(3.6).extrude(bx1 - bx0).translate((bx0, 0, 0)))
    Ay, Az = HINGE_Y2 + MECH_A[0] * K, HINGE_Z + MECH_A[1] * K               # oreja de la tapa: toma la biela del servo (queda fuera del arco de la pared de la copa)
    tx0, tx1 = XF + T_TAB[0] * K, XF + T_TAB[1] * K
    tab = bx(tx0, tx1, HINGE_Y2 - 9.6, Ay, Az - 3.2 * K, z0 + LAMP_T)                                      # oreja al ras de la cara superior de la tapa
    tab = tab.union(cq.Workplane("YZ").center(Ay, Az).circle(3.2 * K).extrude(tx1 - tx0).translate((tx0, 0, 0)))
    tab = tab.cut(cq.Workplane("YZ").center(Ay, Az).circle(1.2 * K).extrude(tx1 - tx0 + 2).translate((tx0 - 1, 0, 0)))
    lid = lid.union(tab)
    doors = {"tapa": lid}
    # poste hueco (canal para el cable) y collar
    pole_h = LAMP_Z - H + 6 + 80
    pole = cq.Workplane("XY").box(POLE_W, POLE_D, pole_h - 40, centered=(True, True, False)).translate((POLE_X, POLE_Y, H - 6 - 80)).edges("|Z").fillet(9)
    pole = pole.cut(cq.Workplane("XY").box(POLE_CH[0], POLE_CH[1], pole_h, centered=(True, True, False)).translate((POLE_X, POLE_Y, H - 6 - 80 - 1)).edges("|Z").fillet(2.5))
    pole = pole.cut(bx(POLE_X - 13.0, POLE_X + 3.0, POLE_Y, POLE_Y + POLE_D / 2 + 1, H - 6 - 80 - 1, H - 6 - 80 + 19))      # salida trasera del cable (base)
    joint = (cq.Workplane("XY").workplane(offset=z0 - 60.0).center(POLE_X, POLE_Y - 8).rect(POLE_W * 1.5, 42.0).extrude(60.0 + 1.0)
             .edges("|Z").fillet(8).faces("<Z").edges().fillet(2.5))
    joint = joint.cut(cq.Workplane("XY").box(POLE_CH[0], POLE_CH[1], 62.0, centered=(True, True, False)).translate((POLE_X, POLE_Y, z0 - 61)).edges("|Z").fillet(2.5))
    joint = joint.cut(bx(-7, 7, 82, 104, z0 - 14.0, z0 + 1.5))          # ranura bajo el piso: lleva el cable del canal del poste al paso del piso
    return body, leds, doors, pole, joint


def servo_ref():
    """Micro servo SG90 de referencia FIJO en la cápsula de la copa (eje hacia +X, orejas apoyadas en la cara de la cápsula); unidades de diseño."""
    g = servo_geom()
    body = bx(XF - g["sxl"], XF, g["ya"], g["yb"], g["za"], g["zb"])
    ears = bx(XF - 6.9 * K, XF - 4.4 * K, g["ya"] - 4.9 * K, g["yb"] + 4.9 * K, g["za"], g["zb"])
    shaft = cq.Workplane("YZ").center(g["SV_Y"], g["SV_Z"]).circle(2.4 * K).extrude(4.0 * K).translate((XF, 0, 0))
    return body.union(ears).union(shaft)


def _planar(yz_a, yz_b, width, x0, x1):
    """Barra plana entre dos puntos (y,z) de diseño, con extremos redondos, extruida de x0 a x1."""
    import math
    my, mz = (yz_a[0] + yz_b[0]) / 2, (yz_a[1] + yz_b[1]) / 2
    ln = math.hypot(yz_b[0] - yz_a[0], yz_b[1] - yz_a[1]); ang = math.degrees(math.atan2(yz_b[1] - yz_a[1], yz_b[0] - yz_a[0]))
    return cq.Workplane("YZ").center(my, mz).slot2D(ln + width, width, ang).extrude(x1 - x0).translate((x0, 0, 0))


def mech_points():
    """Puntos de diseño (y,z) del eje S, del extremo del brazo C0 y de la oreja A con la tapa cerrada."""
    p = mech_pose(0.0)
    S = (HINGE_Y2 + MECH_S[0] * K, HINGE_Z + MECH_S[1] * K)
    return S, (HINGE_Y2 + p["C0"][0] * K, HINGE_Z + p["C0"][1] * K), (HINGE_Y2 + MECH_A[0] * K, HINGE_Z + MECH_A[1] * K)


def horn_ref():
    """Brazo (el de plástico que trae el servo), apuntando a C0; la biela se une a 12 mm del eje."""
    S, C0, A0 = mech_points()
    arm = _planar(S, C0, 4.4 * K, XF + T_HORN[0] * K, XF + T_HORN[1] * K)
    return arm.cut(cq.Workplane("YZ").center(*C0).circle(0.9 * K).extrude(4.0 * K).translate((XF, 0, 0)))


def biela_real():
    """Biela impresa (mm reales, plana): barra de 6,4 mm con dos agujeros de Ø2,4 (pasadores de alambre Ø2) separados la longitud calculada."""
    p = mech_pose(0.0); L = p["L"]
    t = T_ROD[1] - T_ROD[0]
    return cq.Workplane("XY").center(L / 2, 0).slot2D(L + 6.4, 6.4).extrude(t).cut(cq.Workplane("XY").circle(1.2).extrude(t)).cut(cq.Workplane("XY").center(L, 0).circle(1.2).extrude(t))


def pin_ref(yz, x0, x1):
    return cq.Workplane("YZ").center(*yz).circle(1.0 * K).extrude((x1 - x0) * K).translate((XF + x0 * K, 0, 0))


def probe():
    """Sensor capacitivo de humedad (referencia, necesario para regar por humedad): va PEGADO a la pared trasera de la bandeja, fuera de la ventana,
    sujeto con dos pinzas. Se entierra ~60 mm reales en la tierra."""
    return cq.Workplane("XY").box(30, 4.5, 195 - 62, centered=(True, True, False)).translate((-75, D / 2 - WALL - CL - TT - 2.4 - 0.4, 62))


def probe_clips():
    """Dos pinzas que sujetan el sensor a la pared trasera de la bandeja."""
    out = None
    for zc in (150.0, 105.0):
        c = bx(-75 - 20, -75 + 20, D / 2 - WALL - CL - TT - 7.0, D / 2 - WALL - CL - TT, zc, zc + 6)
        c = c.cut(bx(-75 - 16, -75 + 16, D / 2 - WALL - CL - TT - 5.2, D / 2 - WALL - CL - TT - 0.3, zc - 1, zc + 7))
        out = c if out is None else out.union(c)
    return out


def stake_ldr():
    """Soporte roscado de la fotorresistencia (medidas reales, se imprime de pie). Se ENROSCA en la escuadra de esquina de la bandeja (no en la tierra):
    punta cónica con rosca (paso 3 mm), collarín que apoya en la escuadra, mástil corto y cabezal cilíndrico con el alojamiento de la LDR arriba.
    El cable sale por un orificio lateral bajo el collarín."""
    core_r, pitch, z0, z1 = LDR_CORE_R, LDR_PITCH_R, 5.6, 24.6
    spike = cq.Workplane("XY").circle(0.8).workplane(offset=5.0).circle(core_r).loft().union(cq.Workplane("XY").workplane(offset=5.0).circle(core_r).extrude(21.0))   # punta cónica + núcleo cilíndrico (la rosca queda dentro del núcleo en todo su recorrido)
    collar = (cq.Workplane("XY").workplane(offset=26).circle(4.3).extrude(3.0).faces(">Z").edges().chamfer(0.8))
    post = cq.Workplane("XY").workplane(offset=29).circle(3.4).extrude(11.0)
    head = cq.Workplane("XY").workplane(offset=40).circle(4.2).extrude(8.0).faces(">Z").edges().chamfer(0.6)
    st = spike.union(collar).union(post).union(head)
    thread = None
    try:
        helix = cq.Wire.makeHelix(pitch, z1 - z0, core_r - 1.0)
        prof = (cq.Workplane("XZ").polyline([(core_r - 1.0, -1.2), (LDR_THREAD_R, -0.25), (LDR_THREAD_R, 0.25), (core_r - 1.0, 1.2)]).close())
        thread = prof.sweep(cq.Workplane("XY").add(helix), isFrenet=True).translate((0, 0, z0))
    except Exception as e:
        print("AVISO: no se pudo generar la rosca helicoidal:", e)
    socket = cq.Workplane("XY").workplane(offset=48 - 6).circle(LDR_D / 2).extrude(6.2)
    wire = cq.Workplane("XY").workplane(offset=30).circle(1.3).extrude(14)
    exitc = cq.Workplane("XZ").workplane(offset=0).center(0, 31.0).circle(1.5).extrude(-8)
    st = st.cut(socket).cut(wire).cut(exitc)
    if thread is None:
        return st
    fused = st.union(thread, tol=1e-3)                                    # un solo sólido B-rep (sin cuerpos solapados)
    if len(fused.solids().vals()) != 1 or not fused.val().isValid():
        print("AVISO: la rosca de la estaca no se fusionó en un solo sólido")
        return cq.Workplane("XY").newObject([cq.Compound.makeCompound([st.val(), thread.val()])])
    return fused


def soporte_ultrasonido():
    """Soporte del HC-SR04 sobre la tapa del depósito (medidas reales, se pega a la tapa con silicona). Dos taladros Ø17 por donde miran las
    cápsulas hacia el agua; la placa se asienta en un nicho de 3 mm y se sujeta con una gota de pegamento; hueco en un extremo para el cable."""
    bw, bl = US_CAN_D + 8.0, US_BOARD[0] + 5.0      # 24 x 50 mm
    h = US_HOLDER_H
    blk = cq.Workplane("XY").box(bw, bl, h, centered=(True, True, False)).edges("|Z").fillet(2.0)
    pocket = cq.Workplane("XY").box(US_BOARD[1] + 0.6, US_BOARD[0] + 0.6, 3.1, centered=(True, True, False)).translate((0, 0, h - 3))
    blk = blk.cut(pocket)
    for sy in (-1, 1):
        blk = blk.cut(cq.Workplane("XY").circle((US_CAN_D + 1.0) / 2).extrude(h + 1).translate((0, sy * US_PITCH / 2, -0.5)))
    blk = blk.cut(cq.Workplane("XY").box(12.0, 6.0, 4.0, centered=(True, True, False)).translate((0, bl / 2 - 1.5, h - 3)))     # salida del cable
    return blk


def ultrasonido_ref():
    """Módulo HC-SR04 de referencia (placa + 2 cápsulas), en mm reales."""
    z0 = US_HOLDER_H - 3.0
    board = cq.Workplane("XY").box(US_BOARD[1], US_BOARD[0], US_BOARD[2], centered=(True, True, False)).translate((0, 0, z0))
    for sy in (-1, 1):
        board = board.union(cq.Workplane("XY").circle(US_CAN_D / 2).extrude(US_CAN_H).translate((0, sy * US_PITCH / 2, z0 - US_CAN_H)))
    return board


def oring_ref():
    """O-ring de referencia (cordón 1,6 mm, Ø interior 10 mm) para la ranura del conector/tapón. Medidas reales."""
    return cq.Workplane("XZ").center(5.8, 25.55).circle(0.8).revolve(360, (-5.8, -25.55, 0), (-5.8, 1 - 25.55, 0))


def conector_deposito(plug=False):
    """Conector roscado M12 x 2 para la pared trasera del depósito (medidas REALES; eje +Z, punta exterior en z=0 para el conector).
    Conector: púa para manguera 8 mm interior (como la salida de las minibombas) + brida cónica + caña lisa + rosca + púa interior.
    Tapón (plug=True): la misma brida, caña y rosca pero cerrada y con ranura para destornillador de pala; se cambia por el conector.
    En ambos casos la brida apoya en la cara trasera del contenedor y la rosca entra en la pared del depósito: ASEGURA el depósito al contenedor."""
    rb, rr = (HOSE_ID - 0.8) / 2, (HOSE_ID + 0.6) / 2
    z_fl = 17.0                                                  # cara de apoyo de la brida (contra el contenedor)
    if not plug:
        c = cq.Workplane("XY").circle(rb).extrude(14.0)
        for z in (5.0, 10.0):
            c = c.union(cq.Workplane("XY").workplane(offset=z).circle(rr).extrude(1.6))
        c = c.union(cq.Workplane("XY").workplane(offset=12.0).circle(rr + 0.2).workplane(offset=5.0).circle(9.0).loft())
    else:
        c = cq.Workplane("XY").workplane(offset=z_fl - 4.0).circle(9.0).extrude(4.0).faces("<Z").edges().chamfer(0.8)
        c = c.cut(cq.Workplane("XY").box(13.0, 2.0, 2.0, centered=(True, True, False)).translate((0, 0, z_fl - 2.0)))     # ranura de destornillador
    c = c.union(cq.Workplane("XY").workplane(offset=z_fl).circle(5.6).extrude(6.5))
    c = c.union(cq.Workplane("XY").workplane(offset=23.5).circle(6.0).extrude(5.0))                               # collar liso (asienta en el taladro liso del depósito)
    c = c.cut(cq.Workplane("XY").workplane(offset=24.6).circle(7.0).circle(5.0).extrude(1.9))                    # ranura del O-ring (cordón 1,6 mm)
    c = c.union(cq.Workplane("XY").workplane(offset=28.5).circle(DR_CORE).extrude(PORT_THREAD_LEN))
    z_in = 28.5 + PORT_THREAD_LEN
    if not plug:
        inner = cq.Workplane("XY").workplane(offset=z_in).circle(rb).extrude(13.5)
        for z in (z_in + 5.5, z_in + 10.5):
            inner = inner.union(cq.Workplane("XY").workplane(offset=z).circle(rr).extrude(1.6))
        c = c.union(inner)
    try:
        th = _helix(DR_CORE - 0.6, DR_PITCH, PORT_THREAD_LEN - 3.0, [(DR_CORE - 0.6, -0.8), (DR_MAJOR, -0.2), (DR_MAJOR, 0.2), (DR_CORE - 0.6, 0.8)]).translate((0, 0, 29.5))
        c = c.union(th)
    except Exception as e:
        print("AVISO: rosca del conector no generada:", e)
    if not plug:
        c = c.cut(cq.Workplane("XY").workplane(offset=-0.1).circle(2.3).extrude(z_in + 13.8))
    return c


# ------------------------- cajita externa de la bomba -------------------------
def pump_ref(xc=0.0, yc=0.0, zb=0.0, flip=True):
    """Volumen de la minibomba DC30A-1230 (referencia, mm reales -> diseño): cuerpo 55 x 41 x 36 apoyado sobre su cara grande, con las dos boquillas
    (salida con púa Ø8,5 e entrada Ø13) saliendo por el extremo +Y a media altura. El cable sale por el extremo opuesto."""
    L, Wd, Hh = PUMP_L * K, PUMP_W * K, PUMP_H * K
    p = bx(-Wd / 2, Wd / 2, -L / 2, L / 2, zb, zb + Hh).edges("|Z").fillet(3.0)
    for (nx, nd, nl) in PUMP_NZ:
        p = p.union(cq.Workplane("XZ").center(nx * K, zb + Hh / 2).circle(nd * K / 2).extrude(-(nl * K)).translate((0, L / 2 - 1.0, 0)))
    p = p.union(cq.Workplane("XZ").center(8.0 * K, zb + 6.0 * K).circle(1.5 * K).extrude(10.0 * K).translate((0, -L / 2 + 1.0, 0)))   # cable
    return p.translate((xc, yc, 0))


PM_ZB = PM_WALL + 0.5                       # la base de la bomba apoya (con 0,25 mm de holgura) en el fondo de la cajita
PM_IN_X = (-(PUMP_W / 2 + 1.0) * K, (PUMP_W / 2 + 1.0) * K)    # interior: cuerpo + 1 mm por lado
PM_IN_Y = (-(PUMP_L / 2 + 1.0) * K, (PUMP_L / 2 + 1.0) * K)
PM_IN_H = PM_ZB + PUMP_H * K + 4.0
PM_X0 = W / 2 + 0.5 + PM_WALL - PM_IN_X[0]      # x de diseño del eje de la bomba: la cajita queda pegada al extremo derecho del contenedor


def pump_box():
    """Cajita adicional pegada al lado del depósito (extremo derecho del contenedor) que aloja la minibomba DC30A-1230: bolsillo a su medida (1 mm de holgura),
    dos agujeros redondos traseros (entrada y salida de manguera), muesca del cable y clavijas de anclaje. Origen en el eje de la bomba."""
    ox0, ox1 = PM_IN_X[0] - PM_WALL, PM_IN_X[1] + PM_WALL
    oy0, oy1 = PM_IN_Y[0] - PM_WALL, PM_IN_Y[1] + PM_WALL
    zt = PM_IN_H + PM_WALL
    shell = bx(ox0, ox1, oy0, oy1, 0, zt).edges("|Z").fillet(8.0).cut(bx(PM_IN_X[0], PM_IN_X[1], PM_IN_Y[0], PM_IN_Y[1], PM_WALL, zt + 1))
    zn = PM_ZB + PUMP_H * K / 2
    for (nx, nd, nl) in PUMP_NZ:                                         # solo dos agujeros redondos en la pared trasera: entrada y salida
        shell = shell.cut(cq.Workplane("XZ").center(nx * K, zn).circle((nd / 2 + 0.5) * K).extrude(-(PM_WALL + 4.0)).translate((0, PM_IN_Y[1] - 1.0, 0)))
    # muesca del cable: pequeña "U" redondeada en el borde superior de la pared -Y (la tapa la cierra y queda un ojal liso de Ø5 mm); sin soportes
    rn, zc = 2.5 * K, zt - 3.0 * K
    notch = cq.Workplane("XZ").center(8.0 * K, zc).circle(rn).extrude(-(PM_WALL + 2.0)).translate((0, oy0 - 1.0, 0))
    notch = notch.union(bx(8.0 * K - rn, 8.0 * K + rn, oy0 - 1.0, oy0 + PM_WALL + 1.0, zc, zt + 1.0))
    shell = shell.cut(notch)
    for (py, pz) in PM_PEGS:                                           # clavijas hacia el contenedor (cara izquierda)
        shell = shell.union(cq.Workplane("YZ").center(py, pz).circle(PM_PEG_R).extrude(-(PM_PEG_L)).translate((ox0, 0, 0)))
    return shell


def pump_box_lid():
    """Tapa de la cajita de la bomba (se asienta en el borde, con labio interior)."""
    ox0, ox1 = PM_IN_X[0] - PM_WALL, PM_IN_X[1] + PM_WALL
    oy0, oy1 = PM_IN_Y[0] - PM_WALL, PM_IN_Y[1] + PM_WALL
    t = 4.0
    lid = bx(ox0, ox1, oy0, oy1, 0, t).edges("|Z").fillet(8.0)
    lip = bx(PM_IN_X[0] + 0.6, PM_IN_X[1] - 0.6, PM_IN_Y[0] + 0.6, PM_IN_Y[1] - 0.6, t, t + 5).cut(bx(PM_IN_X[0] + 4, PM_IN_X[1] - 4, PM_IN_Y[0] + 4, PM_IN_Y[1] - 4, t - 0.1, t + 6))
    lid = lid.union(lip)
    return lid                                          # tapa lisa: sin ranuras (la caja solo tiene los 2 huecos de manguera)


CAN_L = 95.0


def canaleta_cables():
    """Canaleta en U (medidas REALES, 50 mm de ancho) que se pega en la pared trasera: recibe los cables que salen del peine y los de la lámpara y los baja
    hasta la ranura de la caja electrónica. Abierta hacia la pared (la pared hace de tapa); ventana en el extremo inferior hacia la caja. Se imprime de pie."""
    L, w, d, t = CAN_L, (CAN_X[1] - CAN_X[0]) / K, 6.0, 2.0
    ch = cq.Workplane("XY").box(w, d, L, centered=(True, False, False))
    ch = ch.cut(cq.Workplane("XY").box(w - 2 * t, d - t + 0.1, L + 0.2, centered=(True, False, False)).translate((0, -0.1, -0.1)))
    ch = ch.cut(cq.Workplane("XY").box(40.0, t * 3, 10.0, centered=(True, False, False)).translate((0, d - t - 0.1, 0.8)))        # ventana hacia la ranura de la caja
    return ch


def peine_cables():
    """Peine pasacables (medidas REALES): bloque que llena la muesca de la pared trasera; 6 canales semicirculares Ø4 abiertos por arriba, para tender
    cada cable (con su conector ya puesto) desde arriba. El labio queda encima y los sujeta. Eje Y = espesor de la pared; el origen es el centro de la cara interior."""
    w, d, h = COMB_HALF * 2 / K - 0.6, WALL / K - 0.4, (H - COMB_Z0) / K - 0.2
    c = cq.Workplane("XY").box(w, d, h, centered=(True, False, False))
    for i in range(-3, 3):
        c = c.cut(cq.Workplane("XZ").center((i + 0.5) * 5.0, h).circle(2.0).extrude(-(d + 2.0)).translate((0, -1.0, 0)))
    return c


def tornillo_mano():
    """Tornillo de mano (medidas REALES): perilla estriada Ø9 para roscar con los dedos y espiga de rosca gruesa (paso 2). Eje +Z; la punta en z=0."""
    L = 8.5
    shank = cq.Workplane("XY").circle(TS_CORE).extrude(L)
    knob = cq.Workplane("XY").workplane(offset=L).circle(4.5).extrude(5.0).faces(">Z").edges().chamfer(0.6)
    for i in range(10):
        a = i * 36.0
        import math
        knob = knob.cut(cq.Workplane("XY").workplane(offset=L - 0.1).center(4.5 * math.cos(math.radians(a)), 4.5 * math.sin(math.radians(a))).circle(0.9).extrude(5.2))
    t = shank.union(knob)
    try:
        th = _helix(TS_CORE - 0.6, TS_PITCH, 6.5, [(TS_CORE - 0.6, -0.8), (TS_MAJOR, -0.2), (TS_MAJOR, 0.2), (TS_CORE - 0.6, 0.8)]).translate((0, 0, 1.0))
        t = t.union(th)
    except Exception as e:
        print("AVISO: rosca del tornillo de mano no generada:", e)
    return t


def niple_riego():
    """Niple de la manguera del riego (unidades de diseño, eje Y): tubo que atraviesa los dos agujeros redondos de la pared trasera y entra a presión en el
    extremo del colector, base redonda del mismo diámetro que la púa (apoya en la cara exterior del contenedor) y púa con 2 anillos. Se saca hacia atrás
    para poder levantar el riego."""
    y0, y1 = D / 2 - WALL - CL - TT - 9.0, D / 2 + 27.0
    n = cyl_y(HX, PIPE_ZC, 2 * 6.8, y0, y1)
    n = n.union(cyl_y(HX, PIPE_ZC, 2 * 8.6, D / 2, D / 2 + 3.0))
    for yy in (D / 2 + 10.0, D / 2 + 19.0):
        n = n.union(cyl_y(HX, PIPE_ZC, 2 * 8.6, yy, yy + 3.2))
    return n.cut(cyl_y(HX, PIPE_ZC, 2 * 4.4, y0 - 1.0, y1 + 1.0))


def electronics_box():
    """Caja del ESP32 + módulo de 2 relés con pasacables, ranura USB y ventana para el DHT11. Medidas reales."""
    iw = ESP_BOARD[0] + RELAY_BOARD[0] + 14
    idp = max(ESP_BOARD[1], RELAY_BOARD[1]) + 12
    ih, t = 24.0, 2.4
    box = cq.Workplane("XY").box(iw + 2 * t, idp + 2 * t, ih + t, centered=(True, True, False)).edges("|Z").fillet(3)
    box = box.cut(cq.Workplane("XY").box(iw, idp, ih + 0.1, centered=(True, True, False)).translate((0, 0, t)))
    box = box.cut(cq.Workplane("XY").box(t * 3, 14, 9, centered=(True, True, False)).translate((-(iw / 2 + t / 2), 0, t + 5)))
    box = box.cut(cq.Workplane("XY").box(46, t * 3, 10, centered=(True, True, False)).translate((6, idp / 2 + t / 2, t + 6)))
    box = box.cut(cq.Workplane("XY").box(DHT_HOLE[0], t * 3, DHT_HOLE[1], centered=(True, True, False)).translate((0, -(idp / 2 + t / 2), t + 4)))
    for sx in (-1, 1):
        ear = cq.Workplane("XY").box(12, 12, t, centered=(True, True, False)).translate((sx * (iw / 2 + t + 2), 0, 0))
        box = box.union(ear.faces(">Z").workplane().hole(3.4))
    return box


def electronics_lid():
    iw = ESP_BOARD[0] + RELAY_BOARD[0] + 14
    idp = max(ESP_BOARD[1], RELAY_BOARD[1]) + 12
    t = 2.4
    lid = cq.Workplane("XY").box(iw + 2 * t, idp + 2 * t, t, centered=(True, True, False)).edges("|Z").fillet(3)
    lip_ = cq.Workplane("XY").box(iw - 0.6, idp - 0.6, 3, centered=(True, True, False)).translate((0, 0, t))
    lip_ = lip_.cut(cq.Workplane("XY").box(iw - 4, idp - 4, 3.1, centered=(True, True, False)).translate((0, 0, t)))
    lid = lid.union(lip_)
    for i in range(-3, 4):
        lid = lid.cut(cq.Workplane("XY").box(2.2, idp * 0.55, t + 0.2, centered=(True, True, False)).translate((i * 8.0, 0, -0.1)))
    return lid


# ------------------------- ensamble -------------------------
BOX_POS = ((CAN_X[0] + CAN_X[1]) / 2 + 6.0, 190.0)   # caja electrónica DETRÁS de la matera, con su ranura frente a la canaleta


def _real(shape, rot=None, tr=(0, 0, 0)):
    """Pieza construida en mm reales -> unidades de diseño (escala K), con rotación opcional y traslación."""
    v = shape.val().scale(K)
    if rot:
        v = v.rotate(cq.Vector(0, 0, 0), cq.Vector(*rot[0]), rot[1])
    return cq.Workplane("XY").newObject([v]).translate(tr)


def build():
    """Todas las piezas (ensamble de referencia en unidades de diseño). El tercer valor indica si se imprime."""
    P = {}
    # --- contenedor
    P["contenedor_principal"] = (contenedor_principal(), (0.42, 0.27, 0.62), True)
    P["labio"] = (labio(), (0.30, 0.20, 0.45), True)
    pw, ph = (SCR_PCB[0] + 0.6) * K, (SCR_PCB[1] + 0.6) * K
    P["pantalla_oled"] = (bx(-SCR_PCB[0] / 2 * K, SCR_PCB[0] / 2 * K, -D / 2 + SCR_GLASS_T * K, -D / 2 + (SCR_GLASS_T + SCR_PCB[2]) * K, SCR_Z - SCR_PCB[1] / 2 * K, SCR_Z + SCR_PCB[1] / 2 * K)
                          .union(bx(-12.5 * K, 12.5 * K, -D / 2, -D / 2 + SCR_GLASS_T * K, SCR_Z - 9.6 * K, SCR_Z + 9.6 * K)), (0.05, 0.08, 0.12), False)
    pd = tapon_drenaje().rotate((0, 0, 0), (0, 1, 0), 90)
    P["tapon_drenaje"] = (cq.Workplane("XY").newObject([pd.val().scale(K)]).translate((DR_X0 - 3.0 * K, 0, DR_Z)), (0.30, 0.30, 0.32), True)
    # --- bandeja de tierra (con escuadras de las LDR) y sistema de riego independiente
    P["bandeja_tierra"] = (bandeja_tierra(), (0.08, 0.09, 0.10), True)
    P["riego_tierra"] = (riego_integrado()[0], (0.15, 0.55, 0.85), True)
    P["niple_riego"] = (niple_riego(), (0.30, 0.30, 0.32), True)
    P["sustrato"] = (soil(), (0.28, 0.19, 0.12), False)
    P["sonda_humedad"] = (probe(), (0.12, 0.35, 0.22), False)
    P["acetato_suelo"] = (acetato(WIN_SOIL, TT), (0.7, 0.85, 0.95), False)
    for name, (lx, ly) in LDR_POS.items():
        P[f"estaca_ldr_{name}"] = (_real(stake_ldr(), tr=(lx, ly, SOIL_TOP - 26 * K)), (0.8, 0.55, 0.2), False)
    # --- depósito de agua
    P["deposito_agua"] = (deposito_agua(), (0.78, 0.20, 0.20), True)
    P["tapa_deposito"] = (tapa_deposito(), (0.62, 0.14, 0.14), True)
    P["tapon_llenado"] = (fill_port(), (0.30, 0.30, 0.32), True)
    P["agua_deposito"] = (tank_water(), (0.3, 0.65, 0.92), False)
    frame, pn = gauge()
    P["acetato_nivel"] = (pn, (0.7, 0.85, 0.95), False)
    P["soporte_ultrasonido"] = (_real(soporte_ultrasonido(), tr=(US_C[0], US_C[1], SOIL_TOP)), (0.55, 0.12, 0.12), True)
    P["ultrasonido_referencia"] = (_real(ultrasonido_ref(), tr=(US_C[0], US_C[1], SOIL_TOP)), (0.1, 0.35, 0.75), False)
    px, pz = PORT_A
    P["tapon_trasero"] = (_real(conector_deposito(plug=True), rot=((1, 0, 0), 90), tr=(px, D / 2 + 17.0 * K, pz)), (0.30, 0.30, 0.32), True)
    P["conector_deposito"] = (_real(conector_deposito(), rot=((1, 0, 0), 90), tr=(px, D / 2 + 17.0 * K, pz)), (0.30, 0.30, 0.32), True)
    P["oring_deposito"] = (_real(oring_ref(), rot=((1, 0, 0), 90), tr=(px, D / 2 + 17.0 * K, pz)), (0.05, 0.05, 0.05), False)
    # --- cajita externa de la bomba
    P["cajita_bomba"] = (pump_box().translate((PM_X0, 0, 0)), (0.20, 0.45, 0.75), True)
    P["cajita_bomba_tapa"] = (pump_box_lid().translate((PM_X0, 0, PM_IN_H + PM_WALL)), (0.16, 0.38, 0.65), True)
    P["bomba_referencia"] = (pump_ref(PM_X0, 0.0, PM_ZB, True), (0.2, 0.4, 0.9), False)
    # --- electrónica
    bxp = _real(electronics_box(), rot=((0, 0, 1), 180), tr=(BOX_POS[0], BOX_POS[1], 0))
    P["caja_electronica"] = (bxp, (0.1, 0.11, 0.12), True)
    P["caja_tapa"] = (_real(electronics_lid(), rot=((0, 0, 1), 180), tr=(BOX_POS[0], BOX_POS[1], 26.4 * K)), (0.1, 0.11, 0.12), True)
    P["canaleta_cables"] = (_real(canaleta_cables(), tr=((CAN_X[0] + CAN_X[1]) / 2, D / 2, COMB_Z0 - CAN_L * K)), (0.22, 0.24, 0.28), True)
    P["peine_cables"] = (_real(peine_cables(), tr=(CX, D / 2 - WALL + 0.2, COMB_Z0 + 0.1)), (0.55, 0.45, 0.2), True)
    for nm, tz in zip(("alto", "bajo"), TS_Z):
        P[f"tornillo_mano_{nm}"] = (_real(tornillo_mano(), rot=((1, 0, 0), -90), tr=(TS_X, POLE_Y + POLE_D / 2, tz)), (0.9, 0.75, 0.2), True)
    # --- lámpara
    body, leds, doors, pole, joint = lamp()
    P["lampara_cuerpo"] = (body, (0.55, 0.57, 0.6), True)
    P["lampara_tapa"] = (doors["tapa"], (0.04, 0.045, 0.05), True)
    P["lampara_leds"] = (leds, (1.0, 0.85, 0.9), False)
    P["servo_sg90"] = (servo_ref(), (0.1, 0.25, 0.7), False)
    S_, C0_, A0_ = mech_points()
    P["brazo_servo"] = (horn_ref(), (0.9, 0.9, 0.92), False)
    pm = mech_pose(0.0)
    rod = _planar(C0_, A0_, 6.4 * K, XF + T_ROD[0] * K, XF + T_ROD[1] * K)
    for pt in (C0_, A0_):
        rod = rod.cut(cq.Workplane("YZ").center(*pt).circle(1.2 * K).extrude(6.0 * K).translate((XF, 0, 0)))
    P["biela_tapa"] = (rod, (0.3, 0.55, 0.85), True)
    P["pasador_servo"] = (pin_ref(C0_, 1.0, 5.0), (0.75, 0.75, 0.78), False)
    P["pasador_tapa"] = (pin_ref(A0_, 2.6, 9.4), (0.75, 0.75, 0.78), False)
    pins = None                                                                  # pasadores de la bisagra: varilla Ø3 mm x 46 mm real (clavo/alambre rígido), uno por lado
    for xe in (-1, 1):
        x0, x1 = sorted((xe * (HINGE_KN[0][0] + 1.0), xe * (HINGE_KN[1][1] - 1.0)))
        p_ = cq.Workplane("YZ").center(HINGE_Y2, HINGE_Z).circle(3.0).extrude(x1 - x0).translate((x0, 0, 0))
        pins = p_ if pins is None else pins.union(p_)
    P["pasador_bisagra"] = (pins, (0.75, 0.75, 0.78), False)
    P["lampara_poste"] = (pole, (0.03, 0.035, 0.04), True)
    P["lampara_union"] = (joint, (0.03, 0.035, 0.04), True)
    return P


# Ensambles (jerarquía para el visor y el STEP): cada hoja es una pieza independiente. 'oculta' = piezas alternativas/ de referencia que arrancan apagadas.
ASSEMBLIES = {
    "Contenedor principal": ["contenedor_principal", "labio", "pantalla_oled", "tapon_drenaje", "tornillo_mano_alto", "tornillo_mano_bajo"],
    "Bandeja de tierra": ["bandeja_tierra", "sustrato", "sonda_humedad", "acetato_suelo", "estaca_ldr_NO", "estaca_ldr_NE", "estaca_ldr_SO", "estaca_ldr_SE"],
    "Sistema de riego": ["riego_tierra", "niple_riego"],
    "Depósito de agua": ["deposito_agua", "tapa_deposito", "tapon_llenado", "agua_deposito", "acetato_nivel", "soporte_ultrasonido", "ultrasonido_referencia", "tapon_trasero", "conector_deposito", "oring_deposito"],
    "Cajita de la bomba": ["cajita_bomba", "cajita_bomba_tapa", "bomba_referencia"],
    "Electrónica y cables": ["caja_electronica", "caja_tapa", "canaleta_cables", "peine_cables"],
    "Lámpara": ["lampara_cuerpo", "lampara_tapa", "lampara_leds", "servo_sg90", "brazo_servo", "biela_tapa", "pasador_servo", "pasador_tapa", "pasador_bisagra", "lampara_poste", "lampara_union"],
}
HIDDEN_BY_DEFAULT = ("conector_deposito",)
REFERENCE_ONLY = ("oring_deposito", "pasador_bisagra", "brazo_servo", "pasador_servo", "pasador_tapa", "sustrato", "sonda_humedad", "acetato_suelo", "acetato_nivel", "agua_deposito", "ultrasonido_referencia", "bomba_referencia", "pantalla_oled", "lampara_leds", "servo_sg90")


# ------------------------- preparación para imprimir -------------------------
REAL = ("caja_electronica", "caja_tapa", "soporte_ultrasonido", "tapon_drenaje", "tapon_trasero", "conector_deposito", "canaleta_cables", "peine_cables", "tornillo_mano_alto", "tornillo_mano_bajo", "biela_tapa")   # medidas reales: NO se escalan con ESCALA
PEGS = [(-124.0, 60.0, 4.0), (-124.0, 160.0, 4.0), (124.0, 60.0, 4.0), (124.0, 160.0, 4.0), (-60.0, 7.0, 3.2), (60.0, 7.0, 3.2)]


def _half(shape, side, x0=0.0):
    big = 2000.0
    box = cq.Workplane("XY").box(big, big, big, centered=(False, True, True)).translate((x0, 0, 0))
    if side < 0:
        box = box.translate((-big, 0, 0))
    return cq.Workplane("XY").newObject([shape]).intersect(box).val()


def split_pegs(wp, with_pegs, x0=0.0):
    """Parte una pieza en x=0 y, si se pide, agrega clavijas de alineación (paredes y fondo)."""
    shp = wp.val()
    A, B = _half(shp, -1, x0), _half(shp, +1, x0)
    if with_pegs:
        for (y, z, r) in PEGS:
            peg = cq.Workplane("YZ").center(y, z).circle(r).extrude(12.0).translate((x0, 0, 0)).val()
            hole = cq.Workplane("YZ").center(y, z).circle(r + 0.4).extrude(13.0).translate((x0, 0, 0)).val()
            A = cq.Workplane("XY").newObject([A]).union(cq.Workplane("XY").newObject([peg])).val()
            B = cq.Workplane("XY").newObject([B]).cut(cq.Workplane("XY").newObject([hole])).val()
    return {"A": A, "B": B}


def orient(name, shp):
    """Apoya cada pieza en su cara más estable sobre la cama."""
    if name == "lampara_poste":
        shp = shp.rotate(cq.Vector(0, 0, 0), cq.Vector(0, 1, 0), 90)
    elif name in ("riego_tierra", "lampara_tapa"):
        shp = shp.rotate(cq.Vector(0, 0, 0), cq.Vector(1, 0, 0), 180)          # boca abajo: la cara plana queda sobre la cama (riego al ras, tapa de la lámpara plana), sin soportes
    elif name in ("tapon_llenado", "tapon_drenaje", "tapon_trasero"):
        shp = shp.rotate(cq.Vector(0, 0, 0), cq.Vector(1, 0, 0), 180)
    bb = shp.BoundingBox()
    return shp.translate(cq.Vector(-bb.xmin, -bb.ymin, -bb.zmin))


def print_set(parts):
    out = {}
    for name, (wp, _, printable) in parts.items():
        if not printable or name in REAL or name.startswith("estaca"):
            continue
        shp = wp.val()
        longest = max(shp.BoundingBox().xlen, shp.BoundingBox().ylen) * ESCALA
        if name in ("contenedor_principal", "labio", "lampara_cuerpo", "lampara_tapa") and longest > CAMA_MAX:
            for k, half in split_pegs(wp, name == "contenedor_principal", SPLIT_X if name in ("contenedor_principal", "labio") else 0.0).items():
                out[f"{name}_mitad_{k}"] = half
        else:
            out[name] = shp
    final = {}
    for name, shp in out.items():
        base = name.split("_mitad_")[0]
        final[name] = orient(base, shp.scale(ESCALA))
    return final


def hardware_set():
    """Piezas de los componentes (tamaño real). La estaca de LDR va 4 veces."""
    out = {"estaca_ldr_x4": stake_ldr().val(), "caja_electronica": electronics_box().val(), "caja_tapa": electronics_lid().val(), "soporte_ultrasonido": soporte_ultrasonido().val(),
           "tapon_drenaje": tapon_drenaje().val(), "tapon_trasero": conector_deposito(plug=True).val(), "conector_deposito": conector_deposito().val(), "canaleta_cables": canaleta_cables().val(), "peine_cables": peine_cables().val(), "tornillo_mano_x2": tornillo_mano().val(), "biela_tapa": biela_real().val()}
    return {k: orient(k, v) for k, v in out.items()}


def _mesh(shape, tol, ang):
    import numpy as np, trimesh
    vs, tr = shape.tessellate(tol, ang)
    V = np.round(np.array([[v.x, v.y, v.z] for v in vs], dtype=np.float64), 3)      # rejilla de 1 µm: evita astillas numéricas en las uniones
    return trimesh.Trimesh(V, np.array(tr, dtype=np.int64).reshape(-1, 3), process=True)


def export_stl(shape, path, tol=0.05, ang=0.3, union=True):
    """STL binario propio (la exportación estándar agota la memoria con la reja de 1200 huecos). Si la forma es un compuesto de varios
    sólidos que se solapan (ducto, estaca con rosca), sus mallas se UNEN con un motor de booleanas de mallas para entregar un único cuerpo hermético."""
    import numpy as np, trimesh
    if isinstance(shape, cq.Workplane):
        shape = shape.val()
    sols = shape.Solids()
    if len(sols) > 1 and union:
        try:
            meshes = [_mesh(sd, tol, ang) for sd in sols]
            tm = trimesh.boolean.union(meshes, engine="manifold")
        except Exception as e:
            print("AVISO: unión de mallas falló en", os.path.basename(path), e)
            tm = trimesh.util.concatenate([_mesh(sd, tol, ang) for sd in sols])
    else:
        tm = _mesh(shape, tol, ang)
    V = np.asarray(tm.vertices, dtype=np.float32); T = np.asarray(tm.faces, dtype=np.int64)
    try:                                                                  # ida y vuelta por el motor de mallas: garantiza variedad (manifold) en float32
        import manifold3d as _m3
        mm = _m3.Mesh(vert_properties=V, tri_verts=T.astype(np.uint32)); mm.merge()
        man = _m3.Manifold(mm)
        if man.status() != _m3.Error.NoError:
            raise RuntimeError(str(man.status()))
        try:
            man = man.simplify(1e-3)                                       # funde triángulos degenerados/astillas (1 µm)
        except Exception:
            pass
        out = man.to_mesh()
        V = np.asarray(out.vert_properties, dtype=np.float32)[:, :3]; T = np.asarray(out.tri_verts, dtype=np.int64)
    except Exception as e:
        print("AVISO: no se pudo garantizar la variedad de", os.path.basename(path), e)
    a2 = np.linalg.norm(np.cross(V[T][:, 1].astype(np.float64) - V[T][:, 0], V[T][:, 2].astype(np.float64) - V[T][:, 0]), axis=1)
    T = T[a2 > 1e-9]                                                      # quita triángulos de área cero (astillas residuales)
    tri = V[T]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln == 0] = 1
    rec = np.zeros(len(T), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n / ln; rec["v"] = tri
    with open(path, "wb") as f:
        f.write(b"Simon matera v25".ljust(80, b" ")); f.write(np.uint32(len(T)).tobytes()); f.write(rec.tobytes())


if __name__ == "__main__":
    import shutil
    here = os.path.dirname(os.path.abspath(__file__))
    for d in ("referencia", "imprimir"):
        p = os.path.join(here, d)
        for f in os.listdir(p) if os.path.isdir(p) else []:
            fp = os.path.join(p, f)
            if os.path.isfile(fp) and f.endswith((".stl", ".step")):
                os.remove(fp)
        os.makedirs(p, exist_ok=True)
    parts = build()
    asm = cq.Assembly(name="simon_matera")
    for name, (wp, rgb, _) in parts.items():
        asm.add(wp, name=name, color=cq.Color(*rgb))
        export_stl(wp, os.path.join(here, "referencia", f"{name}.stl"), 0.1, 0.3)
    asm.save(os.path.join(here, "simon_matera.step"))
    export_stl(cq.Compound.makeCompound([wp.val() for wp, _, _ in parts.values()]), os.path.join(here, "simon_matera.stl"), 0.1, 0.3, union=False)
    ps = print_set(parts)
    ps.update(hardware_set())
    for name, shp in ps.items():
        export_stl(shp, os.path.join(here, "imprimir", f"{name}.stl"))
    cq.exporters.export(cq.Workplane("XY").newObject([cq.Compound.makeCompound(list(ps.values()))]),
                        os.path.join(here, "imprimir", "todas_las_piezas.step"))
    print(f"ESCALA {ESCALA} · cama {CAMA_MAX:.0f} mm · paredes: contenedor {WALL*ESCALA:.1f} mm, bandeja {TT*ESCALA:.1f} mm, depósito {RT*ESCALA:.1f} mm")
    for name, shp in ps.items():
        bb = shp.BoundingBox()
        ok = max(bb.xlen, bb.ylen) <= CAMA_MAX and shp.isValid()
        print(f"{name:26s} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:6.1f} mm  vol={shp.Volume()/1000:7.1f} cm3  válida={shp.isValid()}  cabe={'sí' if ok else 'NO'}")
