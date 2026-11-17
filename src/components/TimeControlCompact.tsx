// FATIA — REGISTRO DE TEMPO V1: controles de tempo embutidos em ActionRow e
// ProjectDetail (Iniciar tempo / leitura discreta / histórico / manual).

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { TimeEntry, TimeTargetType, timeService } from '@/services/timeService'
import { useRunningSeconds, useTimer } from '@/contexts/TimeContext'
import { formatDuration, sumEndedSeconds } from '@/lib/timeHelpers'
import { canStartNewTimer, canStartNewTimerForProject } from '@/lib/timeEligibility'
import { ActionItem, Project } from '@/types/execution'
import { TimeEntryDialog, TimeHistoryDialog } from '@/components/TimeControl'

type TimeServiceWithProjectList = typeof timeService & {
  listByProject: (projectId: string) => Promise<TimeEntry[]>
}

type TimerWithRevision = ReturnType<typeof useTimer> & { revision?: number }

const serviceWithProjectList = timeService as TimeServiceWithProjectList

async function listProjectEntries(projectId: string): Promise<TimeEntry[]> {
  if (typeof serviceWithProjectList.listByProject !== 'function') {
    throw new Error('A consulta de tempo do projeto ainda não está disponível.')
  }
  return serviceWithProjectList.listByProject(projectId)
}

function useTimeRevision(): number {
  const timer = useTimer() as TimerWithRevision
  return timer.revision ?? 0
}

/**
 * Totais de um alvo individual. O erro fica disponível para a UI e não
 * substitui uma falha por zero.
 */
export function useTargetTimeTotals(
  targetType: TimeTargetType,
  targetId: string | null | undefined,
): { seconds: number; loading: boolean; error: string | null; reload: () => void } {
  const [seconds, setSeconds] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const revision = useTimeRevision()

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!targetId) {
      setSeconds(0)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    timeService
      .listByTarget(targetType, targetId)
      .then((list) => {
        if (!cancelled) setSeconds(sumEndedSeconds(list))
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Não foi possível carregar o tempo.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [targetType, targetId, tick, revision])

  return { seconds, loading, error, reload }
}

/** Totais de UMA ação (soma das entradas válidas dela). */
export function useActionTimeTotals(actionId: string | null | undefined) {
  return useTargetTimeTotals('action', actionId)
}

/**
 * Totais de UM projeto. Uma consulta traz o projeto e todas as ações dele;
 * cada registro é filtrado pelo tipo e somado uma única vez.
 */
export function useProjectTimeTotals(projectId: string | null | undefined): {
  totalSeconds: number
  fromActionsSeconds: number
  directSeconds: number
  entries: TimeEntry[] | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const revision = useTimeRevision()

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!projectId) {
      setEntries(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    listProjectEntries(projectId)
      .then((list) => {
        if (!cancelled) setEntries(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Não foi possível carregar o tempo do projeto.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick, revision])

  const fromActionsSeconds = useMemo(
    () => sumEndedSeconds((entries ?? []).filter((entry) => entry.target_type === 'action')),
    [entries],
  )
  const directSeconds = useMemo(
    () => sumEndedSeconds((entries ?? []).filter((entry) => entry.target_type === 'project')),
    [entries],
  )

  return {
    totalSeconds: fromActionsSeconds + directSeconds,
    fromActionsSeconds,
    directSeconds,
    entries,
    loading,
    error,
    reload,
  }
}

interface TimeControlProps {
  targetType: TimeTargetType
  targetId: string
  targetTitle: string
  contextLabel?: string
  /** Estado atual do alvo (checagem de "Iniciar tempo" permitido). */
  targetStatus: string
  /** Estado real do projeto da ação, quando houver. */
  projectStatus?: string | null
  /** Diferencia ação independente de ação com projeto ainda não resolvido. */
  actionHasProject?: boolean
  /** Código persistido do alvo ("P-3"/"A-12"); só apresentação, nunca gravado. */
  targetNumberCode?: string | null
  /** Entradas já carregadas pelo pai; evita uma chamada por ActionRow. */
  entries?: TimeEntry[]
  entriesLoading?: boolean
  entriesError?: string | null
  onRetryEntries?: () => void
  /** Disparado após gravar/corrigir/anular para a tela recarregar totais. */
  onChanged?: () => void
}

/** Controle de tempo completo (ProjectDetail e ActionRow). */
export const TimeControl: React.FC<TimeControlProps> = ({
  targetType,
  targetId,
  targetTitle,
  contextLabel = '',
  targetStatus,
  projectStatus = null,
  actionHasProject,
  targetNumberCode = null,
  entries: providedEntries,
  entriesLoading = false,
  entriesError = null,
  onRetryEntries,
  onChanged,
}) => {
  const timer = useTimer()
  const { running, pending, error: timerError, startTimer, isReconciling } = timer
  const revision = (timer as TimerWithRevision).revision ?? 0
  const liveRunningSeconds = useRunningSeconds()
  const { toast } = useToast()
  const [localEntries, setLocalEntries] = useState<TimeEntry[] | null>(null)
  const [localEntriesError, setLocalEntriesError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const isThisTargetRunning = Boolean(
    running &&
    (running.status === 'running' || running.status === 'paused') &&
    running.target_type === targetType &&
    (targetType === 'action' ? running.action_id === targetId : running.project_id === targetId),
  )

  const loadEntries = useCallback(async () => {
    if (providedEntries !== undefined) return
    let cancelled = false
    setLocalEntriesError(null)
    try {
      const list = await timeService.listByTarget(targetType, targetId)
      if (!cancelled) setLocalEntries(list)
    } catch (err: unknown) {
      if (!cancelled) {
        setLocalEntriesError(
          err instanceof Error ? err.message : 'Não foi possível carregar o tempo registrado.',
        )
      }
    }
    return () => {
      cancelled = true
    }
  }, [providedEntries, targetType, targetId, revision])

  useEffect(() => {
    if (providedEntries === undefined) void loadEntries()
  }, [providedEntries, loadEntries])

  const entries = providedEntries ?? localEntries
  const entriesLoadingNow =
    entriesLoading || (providedEntries === undefined && entries === null && !localEntriesError)
  const entriesErrorNow = entriesError ?? localEntriesError
  const historyEntries = entries ?? []
  const totalSeconds = useMemo(() => sumEndedSeconds(historyEntries), [historyEntries])
  const runningEntrySeconds =
    running?.status === 'paused' ? Number(running.duration_seconds) || 0 : liveRunningSeconds

  const projectForEligibility = projectStatus
    ? ({ status: projectStatus } as Pick<Project, 'status'>)
    : null
  const startedHere =
    targetType === 'action'
      ? canStartNewTimer(
          {
            status: targetStatus as ActionItem['status'],
            project_id: actionHasProject ? targetId : undefined,
          },
          projectForEligibility,
          actionHasProject,
        )
      : canStartNewTimerForProject({
          status: targetStatus as Project['status'],
        })

  const refreshEntries = useCallback(async () => {
    if (providedEntries === undefined) await loadEntries()
    onChanged?.()
  }, [providedEntries, loadEntries, onChanged])

  const handleStart = async () => {
    if (starting || pending || isReconciling || isThisTargetRunning) return
    setStarting(true)
    setStartError(null)
    const err = await startTimer(targetType, targetId, targetTitle)
    setStarting(false)
    if (err) {
      setStartError(err.message || 'Não foi possível iniciar o cronômetro.')
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
    setStartError(null)
    await refreshEntries()
  }

  const retryEntries = onRetryEntries ?? (() => void loadEntries())
  const openManual = () => {
    setHistoryOpen(false)
    setEditing(null)
    setManualOpen(true)
  }
  const closeManual = (open: boolean) => {
    setManualOpen(open)
    if (!open) setEditing(null)
  }
  const openEdit = (entry: TimeEntry) => {
    setHistoryOpen(false)
    setEditing(entry)
    setManualOpen(true)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="text-xs tabular-nums text-muted-foreground"
        title="Tempo registrado (encerrado)"
      >
        {entriesLoadingNow
          ? 'Tempo: …'
          : entriesErrorNow
            ? 'Tempo: —'
            : entries
              ? historyEntries.some((e) => !e.is_deleted && e.status !== 'running')
                ? `Tempo: ${formatDuration(totalSeconds)}`
                : 'Tempo: não registrado'
              : 'Tempo: —'}
      </span>

      {isThisTargetRunning ? (
        <Badge variant="secondary" className="font-medium">
          {running?.status === 'paused' ? 'Pausado' : 'Em curso'}{' '}
          {runningEntrySeconds > 0 ? formatDuration(runningEntrySeconds) : ''}
        </Badge>
      ) : startedHere ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleStart}
          disabled={starting || pending !== null || isReconciling}
        >
          {starting || pending?.kind === 'start'
            ? 'Iniciando…'
            : isReconciling
              ? 'Confirmando estado…'
              : 'Iniciar tempo'}
        </Button>
      ) : (
        <span
          className="text-xs text-muted-foreground"
          title="Estado atual não inicia novo cronômetro"
        >
          Registro manual disponível
        </span>
      )}

      {(startError || (isThisTargetRunning ? timerError : null)) && (
        <span role="alert" className="text-xs text-destructive">
          {startError || timerError}
        </span>
      )}

      {entriesErrorNow && (
        <span role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {entriesErrorNow}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs"
            onClick={retryEntries}
          >
            <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
            Tentar novamente
          </Button>
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
            <Button size="sm" variant="outline" onClick={openManual}>
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
        targetNumberCode={targetNumberCode}
        runningEntry={isThisTargetRunning ? running : null}
        entries={historyEntries}
        entriesLoading={entriesLoadingNow}
        entriesError={entriesErrorNow}
        onRetryEntries={retryEntries}
        onEntriesChanged={() => {
          void refreshEntries()
        }}
        onEditEntry={openEdit}
      />

      <TimeEntryDialog
        open={manualOpen}
        onOpenChange={closeManual}
        targetType={targetType}
        targetId={targetId}
        targetTitle={targetTitle}
        contextLabel={contextLabel}
        targetNumberCode={targetNumberCode}
        editing={editing}
        onSaved={() => {
          setEditing(null)
          void refreshEntries()
        }}
      />
    </div>
  )
}
