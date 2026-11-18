// GINGA — FATIA 5B: BLOCO "Planejamento (opcional)" do ActionModal.
// Presentacional + rascunho local ao formulário: os 3 valores canônicos vivem
// no ActionModal (patch único), aqui entra apenas entrada/limpeza/validação.
// Recolher só muda apresentação, nunca valores. Sem novo seletor de fuso.

import React, { useId, useState } from 'react'
import { ChevronDown, CalendarClock } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CLEAR_DATE_NOTICE,
  SAVED_TZ_NOTE,
  UTC_FALLBACK_NOTICE,
  isValidPlannedDate,
  isValidPlannedTime,
  plannedDisplayLabel,
  type PlannedExecution,
} from '@/lib/plannedExecution'

interface PlannedExecutionFieldsProps {
  draft: PlannedExecution
  /** Fuso que SERIA usado num plano novo (perfil válido ou UTC explícito). */
  profileTimezone: string
  /** Rascunho capturou o fallback UTC (perfil ausente/inválido) — aviso fixo. */
  usingUtcFallback: boolean
  /** Edição: tupla persistida difere do fuso atual do perfil — nota discreta. */
  keepsSavedTimezone: boolean
  /** true = a tupla ainda é exatamente a original da abertura (campo intacto). */
  pristine: boolean
  error: string | null
  disabled: boolean
  onChangeDate: (value: string) => void
  onChangeTime: (value: string) => void
  onRemove: () => void
}

export const PlannedExecutionFields: React.FC<PlannedExecutionFieldsProps> = ({
  draft,
  profileTimezone,
  usingUtcFallback,
  keepsSavedTimezone,
  pristine,
  error,
  disabled,
  onChangeDate,
  onChangeTime,
  onRemove,
}) => {
  const uid = useId()
  const [open, setOpen] = useState(pristine && draft.date !== '')
  const dateId = `${uid}-planned-date`
  const timeId = `${uid}-planned-time`
  const helpId = `${uid}-planned-help`
  const timeHelpId = `${uid}-planned-time-help`
  const summaryId = `${uid}-planned-summary`

  const hasDraft = draft.date !== ''
  const summary = hasDraft
    ? (plannedDisplayLabel(draft) ?? 'Planejamento em revisão')
    : 'Sem planejamento'
  const dateInvalid =
    error !== null ||
    (!isValidPlannedDate(draft.date) && draft.date !== '') ||
    (!isValidPlannedTime(draft.time) && draft.time !== '')

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={helpId}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Planejamento (opcional)
          <span
            id={summaryId}
            className="block break-words text-xs font-normal text-muted-foreground"
          >
            {summary}
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={helpId} className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Quando você pretende executar este avanço. Não altera o prazo nem seleciona para Hoje.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={dateId} className="text-sm font-medium text-foreground">
                Data planejada (opcional)
              </Label>
              <Input
                id={dateId}
                type="date"
                value={draft.date}
                disabled={disabled}
                onChange={(e) => onChangeDate(e.target.value)}
                className={cn(
                  'min-h-11 border-input bg-card text-base text-foreground tabular-nums sm:text-sm',
                  dateInvalid && 'border-destructive',
                )}
                aria-invalid={dateInvalid}
                aria-describedby={`${summaryId} ${timeHelpId}${error ? ` ${helpId}-error` : ''}`}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={timeId} className="text-sm font-medium text-foreground">
                Hora planejada (opcional)
              </Label>
              <Input
                id={timeId}
                type="time"
                value={draft.time}
                disabled={disabled}
                onChange={(e) => onChangeTime(e.target.value)}
                className="min-h-11 border-input bg-card text-base text-foreground tabular-nums sm:text-sm"
                aria-describedby={timeHelpId}
              />
              <p id={timeHelpId} className="text-xs text-muted-foreground">
                Deixe vazio para planejar apenas o dia.
              </p>
            </div>
          </div>

          <p className="break-words text-xs text-muted-foreground">
            Fuso deste planejamento: {hasDraft ? draft.timezone : profileTimezone}
          </p>
          {usingUtcFallback && !hasDraft && (
            <p role="alert" className="break-words text-xs font-medium text-ginga-warning">
              {UTC_FALLBACK_NOTICE}
            </p>
          )}
          {hasDraft && keepsSavedTimezone && (
            <p className="break-words text-xs text-muted-foreground">{SAVED_TZ_NOTE}</p>
          )}

          {hasDraft && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onRemove}
              className="min-h-11 rounded-xl px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Remover planejamento
            </Button>
          )}
        </div>
      )}

      {error && (
        <p
          id={`${helpId}-error`}
          role="alert"
          className="break-words text-xs font-medium text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  )
}

export { CLEAR_DATE_NOTICE }
