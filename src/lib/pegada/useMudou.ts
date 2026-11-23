import { useEffect, useRef } from 'react'

/** Recarrega a tela quando algo muda fora dela (ex.: Desfazer num aviso). */
export function usePegadaMudou(recarregar: () => unknown) {
  const ref = useRef(recarregar)
  ref.current = recarregar
  useEffect(() => {
    const h = () => {
      void ref.current()
    }
    window.addEventListener('pegada:mudou', h)
    return () => window.removeEventListener('pegada:mudou', h)
  }, [])
}
