/**
 * 4B1 — Diálogo de cadastro/edição de Estratégia do Resultado aberto ACIMA da
 * ficha. Usuário não escolhe dono nem Resultado (vêm do contexto da ficha).
 * Gravação só em Salvar (uma chamada por clique); Cancelar/Escape/fechar não
 * gravam e ficam bloqueados enquanto o envio está em curso.
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { strategyService } from '@/services/strategyService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Strategy } from '@/types/execution'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 3000

export interface StrategyModalProps {
  open: boolean
  /** null = criação; objeto = edição do grupo indicado. */
  strategy: Strategy | null
  projectId: string
  /** Identificação do Resultado (R-N + título persistidos), só leitura. */
  projectLabel: string
  onOpenChange: (open: boolean) => void
  onSaved: (saved: Strategy, created: boolean) => void
}

export const StrategyModal: React.FC<StrategyModalProps> = ({
  open,
  strategy,
  projectId,
  projectLabel,
  onOpenChange,
  onSaved,
}) => {
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Inicializa só ao abrir ou ao trocar de grupo/Resultado (não a cada update do objeto).
  useEffect(() => {
    if (!open) return
    // O campo já começa a frase: a forma de escrever conduz ao conceito.
    setTitle(strategy?.title ?? 'Por meio de ')
    setDescription(strategy?.description ?? '')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, strategy?.id, projectId])

  const handleSave = async () => {
    if (busyRef.current) return
    const trimmed = title.trim()
    if (!trimmed || trimmed.toLowerCase() === 'por meio de') {
      setError('Informe um título para a estratégia.')
      return
    }
    if (trimmed.length > TITLE_MAX || description.length > DESCRIPTION_MAX) {
      setError('Título ou descrição acima do limite permitido.')
      return
    }
    const targetProject = projectId
    const targetId = strategy?.id ?? null
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const saved = targetId
        ? await strategyService.update(targetId, { title: trimmed, description })
        : await strategyService.create(targetProject, { title: trimmed, description })
      busyRef.current = false
      // Sucesso de um Resultado já trocado/desmontado não fecha nem altera o diálogo atual.
      if (!mountedRef.current || projectRef.current !== targetProject) return
      setBusy(false)
      onSaved(saved, targetId === null)
      onOpenChange(false)
    } catch (err: unknown) {
      busyRef.current = false
      if (!mountedRef.current || projectRef.current !== targetProject) return
      setBusy(false)
      setError(getErrorMessage(err) || 'Não foi possível salvar. Tente novamente.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busyRef.current) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{strategy ? 'Editar estratégia' : 'Nova estratégia'}</DialogTitle>
          <DialogDescription className="break-words">{projectLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={titleId}>Título</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={TITLE_MAX}
              required
              aria-required="true"
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11"
            />
            <p className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span>Uma aposta sobre o caminho. Pode ser trocada sem mudar o resultado.</span>
              <span>
                {title.length}/{TITLE_MAX}
              </span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={descriptionId}>Descrição (opcional)</Label>
            <Textarea
              id={descriptionId}
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={5}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-24"
            />
            <p className="text-right text-xs text-muted-foreground">
              {description.length}/{DESCRIPTION_MAX}
            </p>
          </div>

          {error && (
            <p
              id={errorId}
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="min-h-11"
          >
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={handleSave} className="min-h-11">
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
