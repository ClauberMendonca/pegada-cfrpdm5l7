// PEGADA — Ajuda que desaparece: a dica aparece nas primeiras vezes e some
// sozinha, ou com um toque em "Entendi". A contagem fica neste aparelho.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const CHAVE = 'pegada.dicas'
function ler(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function gravar(id: string, n: number) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ ...ler(), [id]: n }))
  } catch {
    // Sem armazenamento, a dica só não é lembrada.
  }
}

export function Dica({ id, vezes = 3, children }: { id: string; vezes?: number; children: React.ReactNode }) {
  const [visivel, setVisivel] = useState(() => (ler()[id] || 0) < vezes)

  // Conta uma vez por dia em que a dica foi vista.
  useEffect(() => {
    if (!visivel) return
    const hoje = new Date().toISOString().slice(0, 10)
    const marca = `${id}@dia`
    try {
      if (localStorage.getItem(`${CHAVE}.${marca}`) === hoje) return
      localStorage.setItem(`${CHAVE}.${marca}`, hoje)
    } catch {
      return
    }
    gravar(id, (ler()[id] || 0) + 1)
  }, [id, visivel])

  if (!visivel) return null
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-secondary py-2.5 pl-4 pr-1" role="note" data-dica={id}>
      <p className="min-w-0 flex-1 py-1 text-sm leading-snug text-foreground">{children}</p>
      <button
        type="button"
        aria-label="Entendi, não mostrar mais esta dica"
        onClick={() => {
          gravar(id, 999)
          setVisivel(false)
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export default Dica
