import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { captureService } from '@/services/captureService'
import { notificarMudanca } from '@/services/actionService'

// PEGADA — captura global: um campo único, sempre à mão em qualquer tela.
// Botão fixo (canto inferior direito) e atalho "C" no teclado. Enter salva
// pela operação capturar; Esc fecha. Sem diálogo: é o próprio campo.
export function GlobalCaptureHost() {
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [okAte, setOkAte] = useState(0)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const painelRef = useRef<HTMLDivElement>(null)

  const focar = useCallback(() => {
    requestAnimationFrame(() => areaRef.current?.focus())
  }, [])

  const abrir = useCallback(() => {
    setOpen(true)
    focar()
  }, [focar])

  const fechar = useCallback(() => {
    setOpen(false)
    setTexto('')
    setErro('')
  }, [])

  // Atalho global "C": ignora quando o foco está em campo de texto ou há
  // diálogo aberto (o campo do diálogo é onde a pessoa está escrevendo).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key !== 'c' && e.key !== 'C') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (t?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return
      if (open) return
      e.preventDefault()
      abrir()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, abrir])

  // Esc fecha (o campo não é um Dialog, então o Esc é nosso).
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fechar()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [open, fechar])

  async function salvar() {
    const t = texto.trim()
    if (!t || salvando) return
    setSalvando(true)
    setErro('')
    try {
      await captureService.create(t)
      setTexto('')
      setOkAte(Date.now() + 2500)
      notificarMudanca()
      focar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a captura.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      ref={painelRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center sm:items-end sm:px-6 sm:pb-6"
    >
      {open && (
        <div className="pointer-events-auto mb-3 w-full max-w-md rounded-lg border bg-card p-3 shadow-lg">
          <Textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void salvar()
              }
            }}
            rows={3}
            placeholder="O que veio à cabeça? Enter salva."
            aria-label="Nova captura"
            className="resize-none"
          />
          <div className="mt-2 flex min-h-5 items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground" role={erro ? 'alert' : undefined}>
              {erro ? (
                <span className="text-destructive">{erro}</span>
              ) : okAte > Date.now() ? (
                <span className="text-green-600 dark:text-green-400">Captura salva.</span>
              ) : (
                'Enter salva · Shift+Enter quebra linha · Esc fecha'
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={fechar}>
              Fechar
            </Button>
          </div>
        </div>
      )}
      {!open && (
        <Button
          size="icon"
          className="pointer-events-auto fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg sm:bottom-0 sm:right-0"
          aria-label="Nova captura (tecla C)"
          title="Nova captura (tecla C)"
          onClick={abrir}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </Button>
      )}
    </div>
  )
}
