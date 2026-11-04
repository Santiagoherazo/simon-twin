import type { CapacitorConfig } from '@capacitor/cli'

// Si defines CAP_SERVER_URL (p. ej. https://simon.zeusr2.duckdns.org) la app carga la web ya desplegada
// y no hace falta recompilar el APK para ver cambios. Sin ella, usa el build empaquetado (dist).
const remote = process.env.CAP_SERVER_URL?.trim()

const config: CapacitorConfig = {
  appId: 'co.simon.twin',
  appName: 'Simón',
  webDir: 'dist',
  server: remote
    ? { url: remote, cleartext: false }
    : {
        // http://localhost permite ws:// y http:// hacia tu servidor sin bloqueo de contenido mixto
        androidScheme: 'http',
        cleartext: true,
      },
  android: { allowMixedContent: true },
  backgroundColor: '#f3f1ec',
}

export default config
