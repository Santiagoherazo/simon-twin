# Sistema de diseño de Simón

Una sola hoja de tokens (`frontend/src/styles.css`, al inicio) alimenta el gemelo, el celular y la administración (`admin.css` usa los mismos tokens).

## Idea
Los colores salen del propio equipo y cada subsistema conserva el suyo en todas las pantallas:

| Subsistema | Color | Dónde aparece |
|---|---|---|
| Agua | azul del tanque | sección Agua, medidor de agua útil, tecla de la mini bomba |
| Luz | ámbar de la lámpara | sección Luz, esquinas de las LDR, teclas de la luz externa y la luz indirecta |
| Suelo y aire | madera de la mesa | sección Suelo y aire |
| Planta | verde | anillo de aptitud, estado «está bien» |
| Alerta | rojo del marcador «!» | alertas, tanque vacío, «Apagar ahora» |

La interfaz es clara (blanco porcelana sobre la escena); el modo oscuro del sistema usa los mismos tokens. El carbón de la matera (`--carbon`) queda solo para la marca y los botones principales.

## Reglas
- **Una familia tipográfica**: Bricolage Grotesque (autoalojada, `@fontsource-variable`). Los números grandes usan `font-stretch: 80%` y peso 650; el texto, ancho normal.
- **Jerarquía**: en la ficha manda la aptitud (anillo grande) y la frase de estado; lo demás son lecturas separadas por filetes, no tarjetas dentro de tarjetas.
- **Sin franjas laterales de color** en alertas o listas: se usa un tinte de fondo y un punto.
- **Etiquetas en minúscula**, sin separadores «·» en el texto corrido.
- **Contraste**: los textos de color usan las variantes `--*-ink` (AA sobre claro y sobre carbón).
- **Movimiento**: un solo momento coreografiado (los anillos se dibujan al cargar) y respuestas a acciones (menús, teclas). Todo se apaga con `prefers-reduced-motion`.

## Verificación
`npx impeccable detect src/` y `npx impeccable detect <url>` (detector determinista de patrones genéricos y de contraste, requiere Chrome) deben dar 0 hallazgos.

## Gráficos según el equipo
`DeviceDetector` (`components/DeviceDetector.tsx`, con la lógica pura en `device.ts`) detecta si es PC, tableta o celular y deja `data-device` en `<html>`. Con los gráficos en **Auto** (lo normal) se elige así:

| Equipo | Calidad automática |
|---|---|
| PC | Alta |
| Tableta | Media |
| Celular | Sin 3D (solo datos) |
| Cualquiera sin aceleración gráfica | Baja (o sin 3D si no hay WebGL) |

Cómo se decide: `userAgentData.mobile` y el agente de usuario (iPhone, Android con o sin «Mobile», iPad), el puntero táctil y el tamaño de pantalla (para «ver como computador» y la app APK), y el renderizador de WebGL (SwiftShader/llvmpipe = sin GPU). El botón «Gráficos» de la barra recorre Auto, Alta, Media, Baja y Sin 3D; lo que se elige a mano se guarda, y `?q=high|medium|low|off` fuerza un nivel solo en esa visita. Si la escena va lenta en Auto, baja un escalón solo en esa visita sin guardarlo.

Pruebas: `npm test` (`device.test.ts`, `actuators.test.ts`).
