"""Exporta visor/partes.json: mallas cuantizadas de TODAS las piezas (mm, escala 0.5, bandeja sin reja) + jerarquía de ensambles, para el visor interactivo."""
import os, sys, json, base64, tempfile
os.environ["REJA"] = "0"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, trimesh, cadquery as cq, simon_matera as m
S = m.ESCALA
P = m.build()
tmp = tempfile.mkdtemp()
asm_of = {p: a for a, ps in m.ASSEMBLIES.items() for p in ps}
out = []
for name, (wp, rgb, pr) in P.items():
    shp = wp.val().scale(S)
    f = os.path.join(tmp, name + ".stl")
    m.export_stl(shp, f, 0.06 if name != "sustrato" else 0.5, 0.35)
    tm = trimesh.load(f, process=True)
    v = np.asarray(tm.vertices, dtype=np.float64); fc = np.asarray(tm.faces)
    lo, hi = v.min(0), v.max(0); sz = np.maximum(hi - lo, 1e-6)
    q = np.round((v - lo) / sz * 65535).astype(np.uint16)
    idx = fc.astype(np.uint16 if len(v) < 65536 else np.uint32)
    out.append(dict(name=name, asm=asm_of.get(name, "Otros"), rgb=[round(float(c), 3) for c in rgb], printable=bool(pr),
                    ref=name in m.REFERENCE_ONLY, hidden=name in m.HIDDEN_BY_DEFAULT,
                    lo=[round(float(x), 4) for x in lo], sz=[round(float(x), 4) for x in sz],
                    v=base64.b64encode(q.tobytes()).decode(), i=base64.b64encode(idx.tobytes()).decode(), i32=bool(len(v) >= 65536)))
    print(name, len(v), len(fc))
# tapa de la lámpara: gira sobre la bisagra; el servo queda FIJO en la base y mueve la tapa con brazo + biela (mecanismo biela-manivela)
p0 = m.mech_pose(0.0)
ROLE = {"brazo_servo": "horn", "biela_tapa": "rod", "pasador_servo": "pinC", "pasador_tapa": "pinA"}
for d in out:
    if d["name"] == "lampara_tapa":
        d["pivot"] = [0.0, m.HINGE_Y2 * S, m.HINGE_Z * S]; d["maxang"] = m.LAMP_OPEN
    if d["name"] in ROLE:
        d["mrole"] = ROLE[d["name"]]
MECH = dict(H=[m.HINGE_Y2 * S, m.HINGE_Z * S], S=list(m.MECH_S), c=m.MECH_C, ay=m.MECH_A[0], az=m.MECH_A[1], phi0=p0["phi"], L=p0["L"], sg=p0["sg"], C0=list(p0["C0"]))
meta = dict(assemblies=list(m.ASSEMBLIES.keys()), parts=out, mech=MECH)
os.makedirs("visor", exist_ok=True)
json.dump(meta, open("visor/partes.json", "w"), separators=(",", ":"))
print("MB", os.path.getsize("visor/partes.json") / 1e6)
