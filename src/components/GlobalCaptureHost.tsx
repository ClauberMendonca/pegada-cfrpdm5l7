import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { captureService } from '@/services/captureService'
import { notificarMudanca } from '@/services/actionService'

// PEGADA — captura de um toque, disponível em qualquer tela.
// Abre pelo botão central (abrirCaptura) ou pela tecla C fora de campos de texto.
// Enter salva pela operação "capturar"; Shift+Enter quebra linha.
const EVENTO = 'pegada:capturar'

export function abrirCaptura() {
  window.dispatchEvent(new Event(EVENTO))
}

function digitandoEmCampo(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function GlobalCaptureHost() {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const travado = useRef(false)

  useEffect(() => {
    const abrir = () => setAberto(true)
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (digitandoEmCampo(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setAberto(true)
    }
    window.addEventListener(EVENTO, abrir)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener(EVENTO, abrir)
      window.removeEventListener('keydown', tecla)
    }
  }, [])

  const salvar = useCallback(async () => {
    const valor = texto.trim()
    if (!valor || travado.current) return
    travado.current = true
    setSalvando(true)
    try {
      await captureService.create(valor)
      setTexto('')
      setAberto(false)
      notificarMudanca()
      toast.success('Capturado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível capturar.')
    } finally {
      travado.current = false
      setSalvando(false)
    }
  }, [texto])

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-xl rounded-t-[20px] border-border bg-card"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-[17px] font-semibold">Capturar</SheetTitle>
          <SheetDescription>Tire da cabeça agora. Você decide o que é depois.</SheetDescription>
        </SheetHeader>
        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              salvar()
            }
          }}
          placeholder="O que apareceu?"
          aria-label="Texto da captura"
          rows={3}
          className="mt-4 resize-none text-base"
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link
            to="/capturas"
            onClick={() => setAberto(false)}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver capturas
          </Link>
          <Button
            onClick={salvar}
            disabled={salvando || !texto.trim()}
            className="min-h-11 rounded-full px-6"
          >
            Guardar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default GlobalCaptureHost
