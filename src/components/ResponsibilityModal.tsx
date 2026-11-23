/**
 * ENTREGA 3B — Formulário de Responsabilidade (Dialog do sistema).
 * Título obrigatório até 200, descrição opcional até 3000, contexto
 * Vida/Trabalho. Texto puro — sem IA, editor rico ou numeração. Rótulos
 * associados por useId; contadores/ajudas ligados; foco/Tab/Escape e
 * mobile/dvh pelo Dialog existente. Área de toque >= 44px.
 *
 * Escrita mínima: criação envia title/description/context (status inicial
 * 'ativa' no serviço); edição envia SOMENTE title/description/context — o
 * backend pode recusar mudar contexto com vínculos, e o formulário não
 * move/desvincula filhos como compensação. Trava síncrona de duplo envio;
 * cancelar/fechar sem envio não grava; falha preserva o texto e mostra
 * motivo seguro; resposta perdida não autoriza retry automático.
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Heart, Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { responsibilityService, CreateResponsibilityInput } from '@/services/responsibilityService'
import { Responsibility } from '@/types/execution'

export interface ResponsibilityModalProps {
  open: boolean
  /** Responsabilidade em edição; undefined/null = criação. */
  responsibility?: Responsibility | null
  /** Contexto global atual: pode preencher a escolha explícita visível. */
  globalContext?: 'todos' | 'vida' | 'trabalho'
  onOpenChange: (open: boolean) => void
  /** Chamado só após confirmação real de salvamento. */
  onSaved: (saved: Responsibility, created: boolean) => void
}

const TITLE_MAX = 200
const DESCRIPTION_MAX = 3000

type SaveOutcome =
  | { kind: 'ok'; saved: Responsibility; created: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'uncertain' }

export function ResponsibilityModal({
  open,
  responsibility,
  globalContext = 'todos',
  onOpenChange,
  onSaved,
}: ResponsibilityModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const titleHelpId = useId()
  const descriptionHelpId = useId()
  const contextGroupId = useId()
  const contextHelpId = useId()

  const editing = Boolean(responsibility)

  // Leituras/props mais antigas não substituem o texto editado: os campos
  // só são preenchidos quando o modal abre (troca de alvo/abertura).
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [context, setContext] = useState<'vida' | 'trabalho' | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    if (open) {
      setTitle(responsibility?.title ?? '')
      setDescription(responsibility?.description ?? '')
      const initial: 'vida' | 'trabalho' | '' =
        responsibility?.context ??
        (globalContext === 'vida' || globalContext === 'trabalho' ? globalContext : '')
      setContext(initial)
      setError(null)
      setBusy(false)
      busyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, responsibility?.id])

  const titleTooLong = title.length > TITLE_MAX
  const descriptionTooLong = description.length > DESCRIPTION_MAX
  const contextMissing = !editing && context === ''
  const canSave =
    !busy && title.trim().length > 0 && !titleTooLong && !descriptionTooLong && !contextMissing

  const saveOutcomeRef = useRef<SaveOutcome | null>(null)
  saveOutcomeRef.current = null

  const handleSave = async () => {
    if (busyRef.current) return // trava síncrona de duplo envio
    const trimmedTitle = title.trim()
    const finalContext = context
    if (!editing && finalContext !== 'vida' && finalContext !== 'trabalho') {
      setError('Escolha o contexto: Vida ou Trabalho.')
      return
    }
    if (!trimmedTitle || titleTooLong || descriptionTooLong) return

    busyRef.current = true
    setBusy(true)
    setError(null)

    try {
      if (editing && responsibility) {
        const saved = await responsibilityService.update(responsibility.id, {
          title: trimmedTitle,
          description,
          ...(finalContext === 'vida' || finalContext === 'trabalho'
            ? { context: finalContext }
            : {}),
        })
        saveOutcomeRef.current = { kind: 'ok', saved, created: false }
      } else {
        const payload: CreateResponsibilityInput = {
          title: trimmedTitle,
          description,
          context: finalContext as 'vida' | 'trabalho',
        }
        const saved = await responsibilityService.create(payload)
        saveOutcomeRef.current = { kind: 'ok', saved, created: true }
      }
    } catch (err) {
      saveOutcomeRef.current = {
        kind: 'error',
        message: getErrorMessage(err) || 'Não foi possível salvar. Tente novamente.',
      }
    } finally {
      const outcome = saveOutcomeRef.current
      busyRef.current = false
      setBusy(false)

      if (outcome?.kind === 'ok') {
        // Só fecha/limpa após confirmação real; estado local reinicia na
        // próxima abertura (sem apagar campos antes da confirmação).
        onSaved(outcome.saved, outcome.created)
        onOpenChange(false)
      } else if (outcome?.kind === 'error') {
        setError(outcome.message)
      } else if (outcome) {
        // Resposta perdida/incerta: sem retry automático, sem registro
        // otimista — formulário preservado; conferir o catálogo antes de
        // criar novamente.
        setError('A resposta não chegou. Confira no catálogo se foi salvo antes de tentar de novo.')
      }
    }
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && busyRef.current) return // não fecha no meio do envio
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar responsabilidade' : 'Nova responsabilidade'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Altere título, descrição ou contexto. O backend pode recusar mudar o contexto quando já existem itens vinculados.'
              : 'Um compromisso contínuo de Vida ou Trabalho. Ela começa ativa.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Título (obrigatório)</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={TITLE_MAX + 1}
              onChange={(e) => setTitle(e.target.value)}
              aria-describedby={titleHelpId}
              aria-invalid={titleTooLong}
              disabled={busy}
              placeholder="Ex.: Saúde, Família, Produto Pegada"
              className={cn(titleTooLong && 'border-destructive')}
            />
            <p id={titleHelpId} className="text-xs text-muted-foreground">
              {title.length}/{TITLE_MAX} caracteres{titleTooLong ? ' — título muito longo' : ''}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Descrição (opcional)</Label>
            <Textarea
              id={descriptionId}
              value={description}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={descriptionHelpId}
              aria-invalid={descriptionTooLong}
              disabled={busy}
              placeholder="Detalhes, motivação, critérios — texto simples."
              className={cn(descriptionTooLong && 'border-destructive')}
            />
            <p id={descriptionHelpId} className="text-xs text-muted-foreground">
              {description.length}/{DESCRIPTION_MAX} caracteres
            </p>
          </div>

          <fieldset
            id={contextGroupId}
            aria-describedby={contextHelpId}
            disabled={busy || editing}
            className="flex flex-col gap-1.5"
          >
            <legend className="text-sm font-medium leading-none">
              Contexto {editing ? '(não editável no formulário)' : '(obrigatório)'}
            </legend>
            <div role="radiogroup" aria-label="Contexto" className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                role="radio"
                aria-checked={context === 'vida'}
                onClick={() => setContext('vida')}
                className={cn(
                  'min-h-11 flex-1',
                  context === 'vida' && 'border-primary ring-1 ring-primary',
                )}
              >
                <Heart className="mr-2 h-4 w-4" aria-hidden="true" />
                Vida
              </Button>
              <Button
                type="button"
                variant="outline"
                role="radio"
                aria-checked={context === 'trabalho'}
                onClick={() => setContext('trabalho')}
                className={cn(
                  'min-h-11 flex-1',
                  context === 'trabalho' && 'border-primary ring-1 ring-primary',
                )}
              >
                <Briefcase className="mr-2 h-4 w-4" aria-hidden="true" />
                Trabalho
              </Button>
            </div>
            <p id={contextHelpId} className="text-xs text-muted-foreground">
              {editing
                ? 'Para proteger os vínculos existentes, o contexto não é alterado aqui.'
                : 'Em Todos, escolha explicitamente Vida ou Trabalho.'}
            </p>
          </fieldset>

          {error && (
            <p
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
            onClick={() => handleClose(false)}
            disabled={busy}
            className="min-h-11"
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave} className="min-h-11">
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar responsabilidade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
