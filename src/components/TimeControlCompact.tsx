// FATIA — REGISTRO DE TEMPO V1: controles de tempo embutidos em ActionRow e
// ProjectDetail (Iniciar tempo / leitura discreta / histórico / manual).

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { TimeEntry, TimeTargetType, timeService } from '@/services/timeService'
import { useRunningSeconds, useTimer } from '@/contexts/TimeContext'
import { formatDuration, sumEndedSeconds } from '@/lib/timeHelpers'
import { canStartTimer } from '@/lib/timeEligibility'
import { TimeEntryDialog, TimeHistoryDialog } from '@/components/TimeControl'

export interface TimeControlProps {
  targetType: TimeTargetType
  targetId: string
  targetTitle: string
  contextLabel?: string
  /** Estado atual do alvo (checagem de "Iniciar tempo" permitido). */
  targetStatus: string
  /** Ações: projeto ativo/rascunho quando houver. */
  projectStatus?: string | null
  /** Disparado após gravar/corrigir/anular para a tela recarregar totais. */
  onChanged?: () => void
}

/** Controle de tempo completo (ProjectDetail). */
export const TimeControl: React.FC<TimeControlProps> = ({
  targetType,
  targetId,
  targetTitle,
  contextLabel = '',
  targetStatus,
  projectStatus = null,
  onChanged,
}) => {
  const { running, pending, error, startTimer } = useTimer()
  const runningEntrySeconds = useRunningSeconds()
  const { toast } = useToast()
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [starting, setStarting] = useState(false)

  const isThisTargetRunning =
    running !== null &&
    running.target_type === targetType &&
    (targetType === 'action' ? running.action_id === targetId : running.project_id === targetId)

  const loadTotal = useCallback(async () => {
    try {
      const list = await timeService.listByTarget(targetType, targetId)
      setEntries(list)
    } catch {
      setEntries(null)
    }
  }, [targetType, targetId])

  useEffect(() => {
    loadTotal()
  }, [loadTotal])

  const totalSeconds = useMemo(() => sumEndedSeconds(entries || []), [entries])
  const startedHere = canStartTimer(targetType, targetStatus, projectStatus)

  const handleStart = async () => {
    if (starting || pending) return
    setStarting(true)
    const err = await startTimer(targetType, targetId, targetTitle)
    setStarting(false)
    if (err) {
      if (err.code === 'already-running') {
        toast({
          title: 'Já existe um cronômetro correndo',
          description: `${err.running?.target_title || 'Outro intervalo'} está em curso. Pause ou encerre no indicador global antes de iniciar outro.`,
          variant: 'destructive',
        })
      } else if (!(err.status === 409 && err.code === 'pending')) {
        toast({
          title: 'Não foi possível iniciar',
          description: err.message,
          variant: 'destructive',
        })
      }
      return
    }
    loadTotal()
    onChanged?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-xs text-muted-foreground tabular-nums"
        title="Tempo registrado (encerrado)"
      >
        {entries === null ? 'Tempo: —' : `Tempo: ${formatDuration(totalSeconds)}`}
      </span>

      {isThisTargetRunning ? (
        <Badge variant="secondary" className="font-medium">
          {`Em curso ${runningEntrySeconds > 0 ? formatDuration(runningEntrySeconds) : ''}`}
        </Badge>
      ) : startedHere ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleStart}
          disabled={starting || pending !== null}
        >
          {starting || pending?.kind === 'start' ? 'Iniciando…' : 'Iniciar tempo'}
        </Button>
      ) : (
        <span
          className="text-xs text-muted-foreground"
          title="Estado atual não inicia novo cronômetro"
        >
          Registro manual disponível
        </span>
      )}

      {error && isThisTargetRunning && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="Controles de tempo">
            Tempo ▾
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              Registrar tempo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
              Histórico de tempo
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <TimeHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        targetType={targetType}
        targetId={targetId}
        targetTitle={targetTitle}
        contextLabel={contextLabel}
        runningEntry={isThisTargetRunning ? running : null}
        onEntriesChanged={() => {
          loadTotal()
          onChanged?.()
        }}
        onEditEntry={(entry) => {
          setEditing(entry)
          setManualOpen(true)
        }}
      />

      <TimeEntryDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        targetType={targetType}
        targetId={targetId}
        targetTitle={targetTitle}
        contextLabel={contextLabel}
        editing={editing}
        onSaved={() => {
          setEditing(null)
          loadTotal()
          onChanged?.()
        }}
      />
    </div>
  )
}
