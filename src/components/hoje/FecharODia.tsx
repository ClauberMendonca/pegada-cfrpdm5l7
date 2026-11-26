// PEGADA — fechar o dia: opcional, uma pergunta por avanço que sobrou.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ActionItem } from '@/types/execution'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  sobras: ActionItem[]
  ocupadoId: string | null
  onAmanha: (a: ActionItem) => void
  onDevolver: (a: ActionItem) => void
}

export function FecharODia({ open, onOpenChange, sobras, ocupadoId, onAmanha, onDevolver }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md" data-fechar-o-dia>
        <DialogHeader>
          <DialogTitle>Fechar o dia</DialogTitle>
          <DialogDescription>
            {sobras.length === 0
              ? 'Nada ficou aberto em Hoje. Dia fechado.'
              : 'Para cada avanço que sobrou: fica para amanhã ou volta para o Mapa?'}
          </DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {sobras.map((a) => (
            <li key={a.id} className="rounded-2xl border border-border p-3" data-sobra>
              <p className="break-words text-base font-medium text-foreground">{a.title}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11 flex-1"
                  disabled={ocupadoId !== null}
                  aria-label={`Amanhã: ${a.title}`}
                  onClick={() => onAmanha(a)}
                >
                  Amanhã
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 flex-1"
                  disabled={ocupadoId !== null}
                  aria-label={`Devolver ao Mapa: ${a.title}`}
                  onClick={() => onDevolver(a)}
                >
                  Devolver ao Mapa
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" className="min-h-11" onClick={() => onOpenChange(false)}>
            {sobras.length === 0 ? 'Pronto' : 'Deixar como está'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FecharODia
