import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'co.simon.twin',
  appName: 'Simón',
  webDir: 'dist',
  server: {
    // http://localhost (seguro para WebXR/gyro) permite ws:// y http:// hacia tu servidor local sin bloqueo de contenido mixto
    androidScheme: 'http',
    cleartext: true,
  },
  android: { allowMixedContent: true },
  backgroundColor: '#f3f1ec',
}

export default config
