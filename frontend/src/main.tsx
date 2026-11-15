import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeviceDetector } from './components/DeviceDetector'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import './styles.css'
import './admin.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceDetector>
      <App />
    </DeviceDetector>
  </StrictMode>,
)

// PWA: registra el service worker solo en producción
if ('serviceWorker' in navigator && import.meta.env.PROD && !(window as any).Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
