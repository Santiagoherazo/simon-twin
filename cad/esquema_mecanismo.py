"""Esquema 2D (vista lateral, mm reales relativos al eje de la bisagra) del mecanismo de apertura de la tapa a 0/30/60/90/105°. Lee los parámetros de simon_matera.py."""
import math, sys
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import simon_matera as m

RIM = (m.LAMP_CAV - 0.6 - (m.LAMP_CAV + 3.5)) / 2                 # borde superior de la pared de la copa (rel. bisagra)
FLOOR = (-6.0 - (m.LAMP_CAV + 3.5)) / 2                           # cara inferior del piso
SLAB = ((m.LAMP_CAV - (m.LAMP_CAV + 3.5)) / 2, (m.LAMP_T - (m.LAMP_CAV + 3.5)) / 2)
Ay, Az = m.MECH_A
def rot(p, t):
    t = math.radians(t); return (p[0] * math.cos(t) + p[1] * math.sin(t), -p[0] * math.sin(t) + p[1] * math.cos(t))
fig, axs = plt.subplots(1, 5, figsize=(18, 4.4))
for ax, th in zip(axs, (0, 30, 60, 90, 105)):
    pz = m.mech_pose(th); S = m.MECH_S; A = pz["A"]; C = pz["C"]
    ax.fill([-50, -5, -5, -7.5, -7.5, -50], [FLOOR, FLOOR, RIM, RIM, FLOOR + 2, FLOOR + 2], color="#8a8f96")          # copa (pared trasera + piso)
    ax.add_patch(plt.Rectangle((S[0] - 5.9, S[1] - 6.1), 22.7, 12.2, fc="#4a6fd1", alpha=.65))                         # servo
    ax.add_patch(plt.Rectangle((-5, FLOOR), 50, (S[1] + 6.1 + 1.8) - FLOOR, fc="none", ec="#555", ls=":"))              # cápsula
    slab = [(-50, SLAB[0]), (-2.7, SLAB[0]), (-2.7, SLAB[1]), (-50, SLAB[1])]
    tab = [(-4.8, Az - 3.2), (Ay, Az - 3.2), (Ay, SLAB[1]), (-4.8, SLAB[1])]
    for poly in (slab, tab): ax.fill(*zip(*[rot(p, th) for p in poly]), color="#222")
    ax.plot([S[0], C[0]], [S[1], C[1]], "-", color="#bbb", lw=4); ax.plot([C[0], A[0]], [C[1], A[1]], "-", color="#2a8", lw=3)
    ax.plot(*S, "ko"); ax.plot(*C, "ko"); ax.plot(*A, "ro"); ax.plot(0, 0, "k+", ms=12)
    ax.set_aspect("equal"); ax.set_xlim(-30, 45); ax.set_ylim(-26, 45); ax.set_title(f"θ={th}°  servo {pz['phi'] - m.MECH_PHI0:+.0f}°"); ax.grid(alpha=.3)
plt.tight_layout(); plt.savefig("vista_mecanismo.png", dpi=90)
