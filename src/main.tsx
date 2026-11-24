/* Ponto de entrada do app: desenha o componente raiz e registra o service worker */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'

createRoot(document.getElementById('root')!).render(<App />)

// App instalável no celular (PWA). Só em produção, para não atrapalhar o modo dev.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
