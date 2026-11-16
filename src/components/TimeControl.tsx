// FATIA — REGISTRO DE TEMPO V1: diálogos de tempo (manual/corrigir, histórico)
// e o indicador global compacto do cronômetro.

import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { AlertCircle, RotateCcw, Timer } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useToast } from '@/hooks/use-toast'
import { TimeEntry, TimeServiceError, TimeTargetType, timeService } from '@/services/timeService'
import {
  formatDuration,
  isCorrectedEntry,
  manualMinutesToSeconds,
  originLabel,
  secondsToHoursMinutes,
  statusLabel,
  sumEndedSeconds,
} from '@/lib/timeHelpers'
import { useAuth } from '@/contexts/AuthContext'
import { ownerTimezone, todayInZone, formatCalendarDay } from '@/lib/datetime'
import { useRunningSeconds, useTimer } from '@/contexts/TimeContext'

const dateInOwnerTz = (tz: string): string => {
  try {
    return todayInZone(tz)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function parseFiniteInteger(raw: string, label: string, maximum?: number): number | string {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) return `${label} deve ser um inteiro não negativo.`
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || !Number.isFinite(parsed)) {
    return `${label} está fora do intervalo permitido.`
  }
  if (maximum !== undefined && parsed > maximum) {
    return `${label} deve estar entre 0 e ${maximum}.`
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Diálogo: Registrar tempo / Corrigir registro
// ---------------------------------------------------------------------------

export interface TimeEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetType: TimeTargetType
  targetId: string
  targetTitle: string
  contextLabel: string
  /** Registro existente a corrigir (encerrado); null = registro manual novo. */
  editing?: TimeEntry | null
  onSaved: (entry: TimeEntry, wasEdit: boolean) => void
}

export const TimeEntryDialog: React.FC<TimeEntryDialogProps> = ({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetTitle,
  contextLabel,
  editing = null,
  onSaved,
}) => {
  const { user } = useAuth()
  const tz = ownerTimezone(user?.timezone)
  const { toast } = useToast()
  const [entryDate, setEntryDate] = useState<string>('')
  const [hours, setHours] = useState<string>('0')
  const [minutes, setMinutes] = useState<string>('0')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      const hm = secondsToHoursMinutes(editing.duration_seconds || 0)
      setHours(String(hm.hours))
      setMinutes(String(hm.minutes))
      setNote(editing.note || '')
      setEntryDate(editing.entry_date || dateInOwnerTz(tz))
    } else {
      setHours('0')
      setMinutes('0')
      setNote('')
      setEntryDate(dateInOwnerTz(tz))
    }
    setFormError(null)
  }, [open, editing, tz])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) return
    onOpenChange(nextOpen)
  }

  const submit = async () => {
    const parsedHours = parseFiniteInteger(hours, 'Horas')
    const parsedMinutes = parseFiniteInteger(minutes, 'Minutos', 59)
    if (typeof parsedHours === 'string') {
      setFormError(parsedHours)
      return
    }
    if (typeof parsedMinutes === 'string') {
      setFormError(parsedMinutes)
      return
    }
    const secs = manualMinutesToSeconds(parsedHours, parsedMinutes)
    if (secs <= 0) {
      setFormError('Informe uma duração positiva em horas e/ou minutos.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      setFormError('Informe o dia do registro.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        const updated = await timeService.update({
          entryId: editing.id,
          entryDate,
          durationSeconds: secs,
          note,
          expectedUpdated: editing.updated || undefined,
        })
        onSaved(updated, true)
        toast({
          title: 'Registro corrigido',
          description: 'Os valores anteriores ficam guardados no registro para conferência.',
        })
      } else {
        const created = await timeService.manual({
          targetType,
          targetId,
          entryDate,
          durationSeconds: secs,
          note,
        })
        onSaved(created, false)
        toast({
          title: 'Tempo registrado',
          description: 'Complemento para o que ainda não foi cronometrado.',
        })
      }
      onOpenChange(false)
    } catch (err) {
      const e = err as TimeServiceError
      setFormError(e.message || 'Falha ao gravar o registro.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Corrigir registro de tempo' : 'Registrar tempo'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Os valores anteriores ficam guardados para conferência.'
              : 'Complemento manual do tempo que ainda não foi cronometrado.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{targetTitle}</div>
            <div className="text-muted-foreground">
              {targetType === 'action' ? 'Ação' : 'Projeto'}
              {contextLabel ? ` · ${contextLabel}` : ''}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="time-entry-date">Dia</Label>
            <Input
              id="time-entry-date"
              type="date"
              value={entryDate}
              max={dateInOwnerTz(tz)}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="time-entry-hours">Horas</Label>
              <Input
                id="time-entry-hours"
                type="number"
                min={0}
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-entry-minutes">Minutos</Label>
              <Input
                id="time-entry-minutes"
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="time-entry-note">Nota (opcional)</Label>
            <Textarea
              id="time-entry-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que foi feito neste tempo"
            />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Gravando…' : editing ? 'Salvar correção' : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Diálogo: Histórico de tempo (com totais e anulação lógica)
// ---------------------------------------------------------------------------

export interface TimeHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetType: TimeTargetType
  targetId: string
  targetTitle: string
  contextLabel: string
  runningEntry: TimeEntry | null
  /** Entradas carregadas pelo pai; evita uma consulta por ActionRow. */
  entries?: TimeEntry[]
  entriesLoading?: boolean
  entriesError?: string | null
  onRetryEntries?: () => void
  onEntriesChanged: () => void
  onEditEntry: (entry: TimeEntry) => void
}

export const TimeHistoryDialog: React.FC<TimeHistoryDialogProps> = ({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetTitle,
  contextLabel,
  runningEntry,
  entries: providedEntries,
  entriesLoading = false,
  entriesError = null,
  onRetryEntries,
  onEntriesChanged,
  onEditEntry,
}) => {
  const { toast } = useToast()
  const [entries, setEntries] = useState<TimeEntry[]>(providedEntries ?? [])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const liveRunningSeconds = useRunningSeconds()

  const load = useCallback(async () => {
    if (providedEntries !== undefined) {
      setEntries(providedEntries)
      setLoading(entriesLoading)
      setLoadError(entriesError ?? null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const list = await timeService.listByTarget(targetType, targetId)
      setEntries(list)
    } catch {
      setLoadError('Não foi possível carregar o histórico.')
    } finally {
      setLoading(false)
    }
  }, [providedEntries, entriesLoading, entriesError, targetType, targetId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const ended = useMemo(() => entries.filter((e) => e.status !== 'running'), [entries])
  const totalEnded = useMemo(() => sumEndedSeconds(ended), [ended])
  const runningSeconds =
    runningEntry?.status === 'running'
      ? liveRunningSeconds
      : Number(runningEntry?.duration_seconds) || 0
  const busy = deletingId !== null
  const visibleError = entriesError ?? loadError
  const visibleLoading = entriesLoading || loading
  const totalEndedLabel = visibleLoading || visibleError ? '—' : formatDuration(totalEnded)

  const askDelete = (entry: TimeEntry) => setConfirmingId(entry.id)
  const cancelDelete = () => setConfirmingId(null)

  const confirmDelete = async () => {
    if (!confirmingId) return
    setDeletingId(confirmingId)
    try {
      await timeService.softDelete(confirmingId, 'Anulado pelo usuário no histórico.')
      setConfirmingId(null)
      await load()
      onEntriesChanged()
      toast({
        title: 'Registro anulado',
        description: 'Remoção lógica; os dados permanecem no banco.',
      })
    } catch (err) {
      const e = err as TimeServiceError
      toast({ title: 'Falha ao anular', description: e.message, variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  const retry = onRetryEntries ?? (() => void load())
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) return
    onOpenChange(nextOpen)
  }
  const editEntry = (entry: TimeEntry) => {
    if (busy) return
    onOpenChange(false)
    onEditEntry(entry)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tempo registrado · {targetTitle}</DialogTitle>
          <DialogDescription>
            {contextLabel ? `${contextLabel} · ` : ''}
            Sem registro significa “Não registrado”, não ausência de trabalho.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total encerrado</span>
            <span className="font-medium">{totalEndedLabel}</span>
          </div>
          {runningEntry && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {runningEntry.status === 'paused' ? 'Pausado' : 'Em curso'}
              </span>
              <span className="font-medium">{formatDuration(runningSeconds)}</span>
            </div>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {visibleLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {visibleError && (
            <div role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{visibleError}</span>
              <Button size="sm" variant="outline" onClick={retry} disabled={visibleLoading}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Tentar novamente
              </Button>
            </div>
          )}
          {!visibleLoading && !visibleError && entries.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Não registrado — nenhum intervalo ainda.
            </p>
          )}
          {!visibleLoading && !visibleError && entries.length > 0 && (
            <ul className="divide-y">
              {entries.map((e) => {
                const confirmed = confirmingId === e.id
                const displaySeconds =
                  e.status === 'running' && runningEntry?.id === e.id
                    ? liveRunningSeconds
                    : Number(e.duration_seconds) || 0
                return (
                  <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-medium">
                          {formatDuration(displaySeconds)}
                        </Badge>
                        <Badge variant="secondary">{originLabel(e)}</Badge>
                        <Badge variant="outline">{statusLabel(e)}</Badge>
                        {e.is_deleted && <Badge variant="destructive">Anulado</Badge>}
                        {isCorrectedEntry(e) && !e.is_deleted && (
                          <Badge variant="outline">Corrigido</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatCalendarDay(e.entry_date)}
                        {e.note ? ` · ${e.note}` : ''}
                      </div>
                      {isCorrectedEntry(e) && !e.is_deleted && (
                        <div className="text-xs text-muted-foreground">
                          Antes: {formatDuration(e.previous_duration_seconds || 0)} ·{' '}
                          {formatCalendarDay(e.previous_date || e.entry_date)}
                          {e.previous_note ? ` · ${e.previous_note}` : ''}
                        </div>
                      )}
                      {e.is_deleted && e.delete_reason && (
                        <div className="text-xs text-muted-foreground">
                          Motivo: {e.delete_reason}
                        </div>
                      )}
                    </div>
                    {e.status !== 'running' && !e.is_deleted && (
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {confirmed ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={confirmDelete}
                              disabled={busy}
                            >
                              {busy ? 'Anulando…' : 'Confirmar anulação'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelDelete}
                              disabled={busy}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editEntry(e)}
                              disabled={busy}
                            >
                              Corrigir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => askDelete(e)}
                              disabled={busy}
                            >
                              Anular
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Histórico recolhível no detalhe do projeto (subtotal Das ações / Direto)
// ---------------------------------------------------------------------------

export interface ProjectTimeHistoryProps {
  entries: TimeEntry[]
  runningEntry: TimeEntry | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

export const ProjectTimeHistory: React.FC<ProjectTimeHistoryProps> = ({
  entries,
  runningEntry,
  loading = false,
  error = null,
  onRetry,
}) => {
  const liveRunningSeconds = useRunningSeconds()
  const direct = entries.filter((e) => e.target_type === 'project')
  const fromActions = entries.filter((e) => e.target_type === 'action')
  const directTotal = sumEndedSeconds(direct.filter((e) => e.status !== 'running'))
  const actionsTotal = sumEndedSeconds(fromActions.filter((e) => e.status !== 'running'))
  const currentSeconds =
    runningEntry?.status === 'running'
      ? liveRunningSeconds
      : Number(runningEntry?.duration_seconds) || 0
  const totalLabel = (seconds: number) => (loading || error ? '—' : formatDuration(seconds))

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="time-history">
        <AccordionTrigger>Histórico de tempo</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Das ações</span>
              <span className="font-medium">{totalLabel(actionsTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Direto no projeto</span>
              <span className="font-medium">{totalLabel(directTotal)}</span>
            </div>
            {runningEntry && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {runningEntry.status === 'paused' ? 'Pausado' : 'Em curso'}
                </span>
                <span className="font-medium">{formatDuration(currentSeconds)}</span>
              </div>
            )}

            {loading && <p className="rounded-md border p-3 text-muted-foreground">Carregando…</p>}
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border p-3 text-destructive"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{error}</span>
                {onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Tentar novamente
                  </Button>
                )}
              </div>
            )}

            {!loading && !error && (
              <ul className="mt-3 divide-y rounded-md border">
                {entries.length === 0 && (
                  <li className="p-3 text-muted-foreground">
                    Não registrado — nenhum intervalo ainda.
                  </li>
                )}
                {entries.map((e) => {
                  const displaySeconds =
                    e.status === 'running' && runningEntry?.id === e.id
                      ? liveRunningSeconds
                      : Number(e.duration_seconds) || 0
                  return (
                    <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span>{formatDuration(displaySeconds)}</span>
                          <Badge variant="secondary">{originLabel(e)}</Badge>
                          <Badge variant="outline">{statusLabel(e)}</Badge>
                          {e.is_deleted && <Badge variant="destructive">Anulado</Badge>}
                          {isCorrectedEntry(e) && !e.is_deleted && (
                            <Badge variant="outline">Corrigido</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.target_title || (e.target_type === 'action' ? 'Ação' : 'Projeto')} ·{' '}
                          {formatCalendarDay(e.entry_date)}
                          {e.note ? ` · ${e.note}` : ''}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

// ---------------------------------------------------------------------------
// Indicador global compacto (no Layout): nome do alvo, duração, Pausar/Encerrar
// ---------------------------------------------------------------------------

export const GlobalTimerIndicator: React.FC = () => {
  const { running, pending, error, pauseTimer, endTimer, resumeTimer, reconcile, isReconciling } =
    useTimer()
  const liveSeconds = useRunningSeconds()

  if (!running && !error) return null // conciliação nunca inicia nada automaticamente

  if (!running) {
    return (
      <div
        role="region"
        aria-label="Estado do cronômetro"
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 lg:bottom-0 lg:left-56"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Timer className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reconcile()}
            disabled={isReconciling || pending !== null}
          >
            {isReconciling ? 'Confirmando…' : 'Reconfirmar'}
          </Button>
        </div>
      </div>
    )
  }

  const seconds = running.status === 'paused' ? Number(running.duration_seconds) || 0 : liveSeconds
  const busy = pending !== null || isReconciling

  return (
    <div
      role="region"
      aria-label="Cronômetro ativo"
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 lg:bottom-0 lg:left-56"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-sm font-medium" title={running.target_title}>
              {running.target_title || (running.target_type === 'action' ? 'Ação' : 'Projeto')}
            </span>
            <span className="text-sm tabular-nums" aria-live="off">
              {formatDuration(seconds)}
            </span>
            {running.status === 'paused' && (
              <Badge variant="outline" className="text-xs">
                Pausado
              </Badge>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running.status === 'paused' ? (
            <Button size="sm" onClick={() => resumeTimer(running.id)} disabled={busy}>
              {busy && pending?.kind === 'resume' ? 'Confirmando…' : 'Retomar'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => pauseTimer()} disabled={busy}>
                {busy && pending?.kind === 'pause' ? 'Pausando…' : 'Pausar'}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => endTimer()} disabled={busy}>
                {busy && pending?.kind === 'end' ? 'Encerrando…' : 'Encerrar'}
              </Button>
            </>
          )}
          {running.status === 'paused' && (
            <Button size="sm" variant="destructive" onClick={() => endTimer()} disabled={busy}>
              {busy && pending?.kind === 'end' ? 'Encerrando…' : 'Encerrar'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
