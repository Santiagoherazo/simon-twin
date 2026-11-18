import json,sys
d=open("/home/claude/simon-twin/cad/visor/partes.json").read()
t=open("/home/claude/simon-twin/cad/visor/tpl.html").read().replace("__DATA__",d)
open("/home/claude/simon-twin/cad/visor/visor.html","w").write(t); print(len(t)/1e6,"MB")
