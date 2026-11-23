import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { onPedidoRastro, PedidoRastro, PERGUNTA } from '@/lib/pegada/rastro'

/** Diálogo único da regra do rastro, montado uma vez no Layout. */
export function RastroPromptHost() {
  const [pedido, setPedido] = useState<PedidoRastro | null>(null)
  const [texto, setTexto] = useState('')

  useEffect(
    () =>
      onPedidoRastro((p) => {
        setTexto('')
        setPedido(p)
      }),
    [],
  )

  const fechar = (valor: string | null) => {
    pedido?.resolve(valor)
    setPedido(null)
  }

  return (
    <Dialog open={!!pedido} onOpenChange={(open) => !open && fechar(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pedido ? PERGUNTA[pedido.tipo] : ''}</DialogTitle>
          <DialogDescription>
            {pedido?.titulo}. Pensar também é avanço, mas ele se conclui deixando rastro.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && texto.trim()) fechar(texto.trim())
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => fechar(null)}>
            Cancelar
          </Button>
          <Button disabled={!texto.trim()} onClick={() => fechar(texto.trim())}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
