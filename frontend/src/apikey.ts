// La API key de administración se guarda en el navegador (localStorage) para no pedirla en cada
// pestaña ni en cada orden. Solo se envía al backend como cabecera X-API-Key.
import { useEffect, useState } from 'react'

const KEY = 'simon.apikey'
const EVENT = 'simon:apikey'

export const getApiKey = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export const saveApiKey = (key: string): void => {
  try {
    if (key) localStorage.setItem(KEY, key)
    else localStorage.removeItem(KEY)
  } catch {
    /* sin almacenamiento: la clave queda solo en memoria */
  }
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: key }))
}

export const forgetApiKey = (): void => saveApiKey('')

/** Estado compartido por todas las pestañas y componentes de la app. */
export function useApiKey(): [string, (key: string) => void] {
  const [key, setKey] = useState(getApiKey)
  useEffect(() => {
    const fromStorage = (e: StorageEvent) => {
      if (e.key === KEY) setKey(e.newValue ?? '')
    }
    const fromApp = (e: Event) => setKey((e as CustomEvent<string>).detail ?? '')
    window.addEventListener('storage', fromStorage)
    window.addEventListener(EVENT, fromApp)
    return () => {
      window.removeEventListener('storage', fromStorage)
      window.removeEventListener(EVENT, fromApp)
    }
  }, [])
  const update = (next: string) => {
    saveApiKey(next)
    setKey(next)
  }
  return [key, update]
}
