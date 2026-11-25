// PEGADA — Privacidade da IA: o aviso da primeira vez. Nada é enviado antes
// de a pessoa ler e aceitar. Fica montado uma vez no app (Layout).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { registrarAvisoIA } from '@/lib/pegada/api'

export function AvisoIAHost() {
  const [aberto, setAberto] = useState(false)
  const responder = useRef<((v: boolean) => void) | null>(null)

  useEffect(() => {
    registrarAvisoIA(
      () =>
        new Promise<boolean>((resolve) => {
          responder.current = resolve
          setAberto(true)
        }),
    )
    return () => registrarAvisoIA(null)
  }, [])

  const fechar = (aceitou: boolean) => {
    setAberto(false)
    responder.current?.(aceitou)
    responder.current = null
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar(false)}>
      <DialogContent className="max-w-[min(480px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground" data-aviso-ia>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">Antes de usar a IA</DialogTitle>
          <DialogDescription className="sr-only">Aviso de privacidade da IA do Pegada</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-base leading-relaxed text-foreground">
          <p>
            Para sugerir, o Pegada envia à Anthropic, que fornece a IA, <strong>só o texto deste pedido</strong>.
            Os seus outros dados ficam aqui.
          </p>
          <p>
            Esse texto pode falar de família, saúde ou dinheiro. Escreva só o que você se sente à vontade para
            enviar. A IA sugere, e você decide.
          </p>
          <p className="text-sm text-muted-foreground">
            Você pode desligar a IA quando quiser em{' '}
            <Link to="/configuracoes" onClick={() => fechar(false)} className="underline underline-offset-4">
              Configurações
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" onClick={() => fechar(true)} className="h-[52px] rounded-full text-[17px] font-semibold">
            Entendi, usar a IA
          </Button>
          <Button type="button" variant="ghost" onClick={() => fechar(false)} className="h-11 rounded-full">
            Agora não
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AvisoIAHost
