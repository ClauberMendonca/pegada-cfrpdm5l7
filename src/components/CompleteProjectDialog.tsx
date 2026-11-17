import React, { useState } from 'react'
import { Project } from '@/types/execution'
import { projectService } from '@/services/projectService'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface CompleteProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  onCompleted: () => void
}

/**
 * BLOCO 5.4 — Concluir projeto como decisão explícita diante da condição de
 * término. Substitui a gravação imediata do comando Concluir: mostra a
 * completion_condition atual em texto puro, o efeito (encerra o planejamento
 * de novas ações, preservando ações e históricos) e só grava após confirmação.
 * Guarda apenas de interface: usa a alteração de status existente
 * (projectService.update) e o enum atual ('concluido'). Não concluir ações,
 * não parar tempo, não produzir progresso, não tocar em outros projetos.
 */
export const CompleteProjectDialog: React.FC<CompleteProjectDialogProps> = ({
  isOpen,
  onClose,
  project,
  onCompleted,
}) => {
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const completionCondition =
    typeof project.completion_condition === 'string' ? project.completion_condition.trim() : ''

  const handleConfirm = async () => {
    if (isSaving) return
    setIsSaving(true)
    setErrorMessage(null)
    try {
      await projectService.update(project.id, { status: 'concluido' })
      toast({ title: 'Projeto concluído', description: 'Planejamento de novas ações encerrado.' })
      onCompleted()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível concluir o projeto.'
      setErrorMessage(msg)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Cancelar/fechar/Escape nunca gravam. Durante a gravação o fechamento
        // por fora fica bloqueado para não esconder o resultado.
        if (!open && !isSaving) {
          setErrorMessage(null)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-[min(520px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <CheckCircle2 className="w-5 h-5 text-ginga-success" />
            Concluir projeto
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Decisão explícita — confirme a condição de término antes de encerrar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5 rounded-xl border border-border bg-muted p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
              Condição de término
            </span>
            {completionCondition ? (
              <p className="text-sm text-foreground whitespace-pre-wrap">{completionCondition}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Condição de término não definida
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
              Efeito desta decisão
            </span>
            <p className="text-sm text-foreground">
              Concluir encerra o planejamento de novas ações em{' '}
              <span className="font-medium">{project.title}</span>. Ações, registros de progresso e
              históricos de tempo existentes continuam legíveis e preservados.
            </p>
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setErrorMessage(null)
              onClose()
            }}
            disabled={isSaving}
            className="min-h-11 rounded-xl"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className="min-h-11 rounded-xl"
          >
            {isSaving ? 'Concluindo...' : 'Confirmar conclusão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
