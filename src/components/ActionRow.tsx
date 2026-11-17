import React, { useState } from 'react'
import { ActionItem, ActionStatus } from '@/types/execution'
import { formatCalendarDay } from '@/lib/datetime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CheckCircle2,
  Clock,
  MoreVertical,
  Star,
  StarOff,
  AlertTriangle,
  FolderKanban,
  MinusCircle,
  Play,
  Plus,
  Loader2,
  Timer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionDescriptionBlock } from '@/components/ActionDescriptionBlock'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { formatEntityTitle } from '@/lib/entityNumber'

interface ActionRowProps {
  action: ActionItem
  isNextAdvance?: boolean
  /** FATIA 3: gravação em andamento — desabilita controles e mostra pendência */
  saving?: boolean
  /** B1 (detalhe): motivo legível quando NOVA seleção de foco é bloqueada (null = pode). */
  focusBlockedReason?: string | null
  onToggleNextStep?: (id: string, current: boolean) => void
  onToggleTodaySelected?: (id: string, current: boolean) => void
  onStatusChange?: (id: string, status: ActionStatus, reason?: string) => void
  onOpenLogModal?: (action: ActionItem) => void
  onEdit?: (action: ActionItem) => void
  /** REGISTRO DE TEMPO V1: controles de tempo embutidos (iniciar/histórico/manual). */
  timeControl?: React.ReactNode
}

/** Botão de toque com área mínima de 44×44 px. */
const touchButton =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export const ActionRow: React.FC<ActionRowProps> = ({
  action,
  isNextAdvance = false,
  saving = false,
  focusBlockedReason = null,
  onToggleNextStep,
  onToggleTodaySelected,
  onStatusChange,
  onOpenLogModal,
  onEdit,
  timeControl,
}) => {
  const [waitingReason, setWaitingReason] = useState('')
  const [showReasonInput, setShowReasonInput] = useState(false)
  const [targetStatus, setTargetStatus] = useState<ActionStatus | null>(null)

  const getStatusBadge = (status: ActionStatus) => {
    switch (status) {
      case 'pronta':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-primary/30 bg-accent px-2.5 text-[13px] font-medium text-accent-foreground"
          >
            Pronta
          </Badge>
        )
      case 'em_andamento':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-ginga-info/30 bg-ginga-info-bg px-2.5 text-[13px] font-medium text-ginga-info"
          >
            Em andamento
          </Badge>
        )
      case 'aguardando':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-ginga-warning/30 bg-ginga-warning-bg px-2.5 text-[13px] font-medium text-ginga-warning"
          >
            Aguardando
          </Badge>
        )
      case 'bloqueada':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-destructive/30 bg-ginga-danger-bg px-2.5 text-[13px] font-medium text-destructive"
          >
            Bloqueada
          </Badge>
        )
      case 'feita':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-border bg-muted px-2.5 text-[13px] font-medium text-muted-foreground"
          >
            Feita
          </Badge>
        )
      case 'cancelada':
        return (
          <Badge
            variant="outline"
            className="rounded-full border-border px-2.5 text-[13px] font-medium text-muted-foreground line-through"
          >
            Cancelada
          </Badge>
        )
    }
  }

  const handleSelectStatus = (newStatus: ActionStatus) => {
    if (newStatus === 'aguardando' || newStatus === 'bloqueada') {
      setTargetStatus(newStatus)
      setShowReasonInput(true)
    } else {
      onStatusChange?.(action.id, newStatus)
    }
  }

  const confirmReasonStatus = () => {
    if (targetStatus) {
      onStatusChange?.(action.id, targetStatus, waitingReason)
      setShowReasonInput(false)
      setWaitingReason('')
      setTargetStatus(null)
    }
  }

  const isDone = action.status === 'feita'
  const isCanceled = action.status === 'cancelada'
  // B1 — bloqueio só impede NOVA seleção de foco; retirada explícita de flag já
  // gravada, leitura, edição, descrição, progresso, tempo e status continuam.
  const canSelectFocus = !isDone && !focusBlockedReason && !saving
  const focusBlockedLabel = focusBlockedReason
    ? `Seleção indisponível: ${focusBlockedReason}. Retirada de seleção existente continua permitida.`
    : null

  return (
    <div
      className={cn(
        'group relative rounded-2xl border bg-card p-4 transition-colors duration-150 sm:p-5',
        isNextAdvance
          ? 'border-primary/30 border-l-4 border-l-primary bg-accent'
          : 'border-border hover:border-primary/30',
        (isDone || isCanceled) && 'bg-muted/50',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox visual (20–24 px) dentro de botão de toque de 44 px */}
        <button
          type="button"
          onClick={() => onStatusChange?.(action.id, isDone ? 'pronta' : 'feita')}
          disabled={saving}
          aria-label={isDone ? 'Reabrir como pronta' : 'Marcar como concluída'}
          title={isDone ? 'Reabrir como pronta' : 'Marcar como concluída'}
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            saving && 'cursor-wait opacity-60',
          )}
        >
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors duration-150',
              isDone
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input text-transparent group-hover:border-primary',
            )}
            aria-hidden="true"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          {/* Título primeiro, metadados depois */}
          <h4
            className={cn(
              'flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1',
              'break-words text-base font-medium leading-snug text-foreground sm:text-lg',
              isDone && 'text-muted-foreground line-through',
              isNextAdvance && 'font-semibold',
            )}
          >
            <EntityNumberBadge kind="action" n={action.sequence_number} entityId={action.id} />
            {action.title}
          </h4>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {getStatusBadge(action.status)}
            <span className="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">
              {action.context === 'trabalho'
                ? 'Trabalho'
                : action.context === 'vida'
                  ? 'Vida'
                  : action.context}
            </span>

            {action.expand?.project_id && (
              <span
                className="flex max-w-xs items-center gap-1 truncate text-sm text-muted-foreground"
                title={action.expand.project_id.title}
              >
                <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {formatEntityTitle(
                    'project',
                    action.expand.project_id.sequence_number,
                    action.expand.project_id.title,
                  )}
                </span>
              </span>
            )}

            {action.deadline && (
              <span className="flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatCalendarDay(action.deadline)}
              </span>
            )}
          </div>

          {action.waiting_for && (
            <p className="mt-2 inline-block rounded-md border border-ginga-warning/30 bg-ginga-warning-bg px-2 py-1 text-sm text-ginga-warning">
              Motivo: {action.waiting_for}
            </p>
          )}

          {/* DESCRIÇÃO OPCIONAL: leitura completa inline, antes dos controles de execução */}
          <ActionDescriptionBlock
            description={action.description}
            idPrefix={`action-${action.id}`}
          />

          {/* REGISTRO DE TEMPO V1: controle de tempo discreto (não substitui progresso/status) */}
          {timeControl && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {timeControl}
            </div>
          )}

          {/* Segunda linha de controles: registrar progresso com texto visível, estrela e menu */}
          <div className="mt-2 flex items-center gap-1 sm:hidden">
            {onOpenLogModal && (
              <Button
                variant="ghost"
                onClick={() => onOpenLogModal(action)}
                className="min-h-11 gap-1.5 rounded-xl px-3 text-sm text-primary hover:bg-accent hover:text-primary"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Registrar progresso</span>
              </Button>
            )}
          </div>
        </div>

        {/* Controles à direita (sm+) */}
        <div className="flex shrink-0 items-center gap-1">
          {onOpenLogModal && (
            <Button
              variant="ghost"
              onClick={() => onOpenLogModal(action)}
              aria-label="Registrar progresso nesta ação"
              title="Registrar progresso nesta ação"
              className="hidden min-h-11 gap-1.5 rounded-xl px-3 text-sm text-primary hover:bg-accent hover:text-primary sm:inline-flex"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Registrar progresso</span>
            </Button>
          )}

          {/* Próximo avanço: estrela distinta de status Feita */}
          {onToggleNextStep && !isDone && (
            <button
              type="button"
              onClick={() => onToggleNextStep(action.id, action.is_next_step)}
              disabled={saving || (!action.is_next_step && !canSelectFocus)}
              aria-label={
                action.is_next_step ? 'Remover do próximo avanço' : 'Definir como próximo avanço'
              }
              title={
                action.is_next_step
                  ? 'Remover do próximo avanço'
                  : (focusBlockedLabel ?? 'Definir como próximo avanço')
              }
              aria-pressed={action.is_next_step}
              className={cn(
                touchButton,
                action.is_next_step && 'text-ginga-warning hover:text-ginga-warning',
                saving && 'cursor-wait',
              )}
            >
              <Star
                className={cn('h-5 w-5', action.is_next_step && 'fill-current')}
                aria-hidden="true"
              />
            </button>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={saving}
                aria-label="Mais ações da ação"
                title="Mais ações"
                className={cn(touchButton, 'h-11 w-11 p-0')}
              >
                <MoreVertical className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {onToggleTodaySelected && !isDone && (
                <DropdownMenuItem
                  onClick={() => onToggleTodaySelected(action.id, action.is_today_selected)}
                  disabled={!action.is_today_selected && !canSelectFocus}
                  title={action.is_today_selected ? undefined : (focusBlockedLabel ?? undefined)}
                  className="min-h-11 cursor-pointer gap-2"
                >
                  {action.is_today_selected ? (
                    <>
                      <MinusCircle className="h-4 w-4 text-muted-foreground" />
                      <span>Tirar de Hoje</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 text-primary" />
                      <span>Selecionar para Hoje</span>
                    </>
                  )}
                </DropdownMenuItem>
              )}

              {onToggleNextStep && !isDone && (
                <DropdownMenuItem
                  onClick={() => onToggleNextStep(action.id, action.is_next_step)}
                  disabled={!action.is_next_step && !canSelectFocus}
                  title={action.is_next_step ? undefined : (focusBlockedLabel ?? undefined)}
                  className="min-h-11 cursor-pointer gap-2"
                >
                  {action.is_next_step ? (
                    <>
                      <StarOff className="h-4 w-4 text-ginga-warning" />
                      <span>Remover do próximo avanço</span>
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 text-ginga-warning" />
                      <span>Definir como próximo avanço</span>
                    </>
                  )}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => handleSelectStatus('pronta')}
                disabled={saving}
                className="min-h-11 cursor-pointer"
              >
                Marcar como Pronta
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('em_andamento')}
                disabled={saving}
                className="min-h-11 cursor-pointer"
              >
                Marcar em Andamento
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('aguardando')}
                disabled={saving}
                className="min-h-11 cursor-pointer"
              >
                Marcar como Aguardando...
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('bloqueada')}
                disabled={saving}
                className="min-h-11 cursor-pointer"
              >
                Marcar como Bloqueada...
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('feita')}
                disabled={saving}
                className="min-h-11 cursor-pointer"
              >
                Concluir ação (Feita)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('cancelada')}
                disabled={saving}
                className="min-h-11 cursor-pointer text-muted-foreground"
              >
                Cancelar ação
              </DropdownMenuItem>

              {onEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onEdit(action)}
                    className="min-h-11 cursor-pointer"
                  >
                    Editar Detalhes
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Sub-form when selecting waiting/blocked */}
      {showReasonInput && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-ginga-warning" aria-hidden="true" />
            Descreva o que está impedindo ou pelo que está aguardando:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={waitingReason}
              onChange={(e) => setWaitingReason(e.target.value)}
              aria-label="Motivo"
              placeholder="Ex: Aguardando retorno do e-mail / Falta aprovação"
              className="min-h-11 flex-1 rounded-xl border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            />
            <div className="flex gap-2">
              <Button
                onClick={confirmReasonStatus}
                disabled={saving}
                className="min-h-11 flex-1 rounded-xl sm:flex-none"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowReasonInput(false)}
                className="min-h-11 flex-1 rounded-xl sm:flex-none"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
