// La API key de administración se guarda en el navegador (localStorage) para no pedirla en cada
// pestaña ni en cada orden. Solo se envía al backend como cabecera X-API-Key.
const KEY = 'simon.apikey'

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
}

export const forgetApiKey = (): void => saveApiKey('')
