// FATIA — REGISTRO DE TEMPO V1: diálogos de tempo (manual/corrigir, histórico)
// e o indicador global compacto do cronômetro.

import React, { useEffect, useMemo, useState } from 'react'

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

  const submit = async () => {
    const h = parseInt(hours, 10) || 0
    const m = parseInt(minutes, 10) || 0
    const secs = manualMinutesToSeconds(h, m)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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
  onEntriesChanged,
  onEditEntry,
}) => {
  const { toast } = useToast()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const load = async () => {
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
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const ended = useMemo(() => entries.filter((e) => e.status !== 'running'), [entries])
  const totalEnded = useMemo(() => sumEndedSeconds(ended), [ended])
  const runningSeconds = runningEntry?.duration_seconds ?? 0

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <span className="font-medium">{formatDuration(totalEnded)}</span>
          </div>
          {runningEntry && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Em curso</span>
              <span className="font-medium">{formatDuration(runningSeconds)}</span>
            </div>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border">
          {loading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {loadError && (
            <p role="alert" className="p-4 text-sm text-destructive">
              {loadError}
            </p>
          )}
          {!loading && !loadError && entries.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Não registrado — nenhum intervalo ainda.
            </p>
          )}
          {!loading && !loadError && entries.length > 0 && (
            <ul className="divide-y">
              {entries.map((e) => {
                const confirmed = confirmingId === e.id
                return (
                  <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-medium">
                          {formatDuration(e.duration_seconds)}
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
                              disabled={deletingId === e.id}
                            >
                              {deletingId === e.id ? 'Anulando…' : 'Confirmar anulação'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelDelete}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => onEditEntry(e)}>
                              Corrigir
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => askDelete(e)}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
}

export const ProjectTimeHistory: React.FC<ProjectTimeHistoryProps> = ({
  entries,
  runningEntry,
}) => {
  const direct = entries.filter((e) => e.target_type === 'project')
  const fromActions = entries.filter((e) => e.target_type === 'action')
  const directTotal = sumEndedSeconds(direct.filter((e) => e.status !== 'running'))
  const actionsTotal = sumEndedSeconds(fromActions.filter((e) => e.status !== 'running'))

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="time-history">
        <AccordionTrigger>Histórico de tempo</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Das ações</span>
              <span className="font-medium">{formatDuration(actionsTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Direto no projeto</span>
              <span className="font-medium">{formatDuration(directTotal)}</span>
            </div>
            {runningEntry && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Em curso</span>
                <span className="font-medium">{formatDuration(runningEntry.duration_seconds)}</span>
              </div>
            )}
            <ul className="mt-3 divide-y rounded-md border">
              {entries.length === 0 && (
                <li className="p-3 text-muted-foreground">
                  Não registrado — nenhum intervalo ainda.
                </li>
              )}
              {entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {formatDuration(e.duration_seconds)} ·{' '}
                      <Badge variant="secondary">{originLabel(e)}</Badge>
                      {e.is_deleted && <Badge variant="destructive">Anulado</Badge>}
                      {isCorrectedEntry(e) && !e.is_deleted && (
                        <Badge variant="outline">Corrigido</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatCalendarDay(e.entry_date)} ·{' '}
                      {e.target_type === 'action' ? 'Ação' : 'Projeto'}
                      {e.note ? ` · ${e.note}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
  const { running, pending, error, pauseTimer, endTimer, isReconciling } = useTimer()
  const seconds = useRunningSeconds()
  const paused = running.status === 'paused'

  if (!running) return null // conciliação nunca inicia nada automaticamente

  const busy = pending !== null

  return (
    <div
      role="region"
      aria-label="Cronômetro ativo"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-sm">
              ⏱
            </span>
            <span className="truncate text-sm font-medium" title={running.target_title}>
              {running.target_title || (running.target_type === 'action' ? 'Ação' : 'Projeto')}
            </span>
            <span
              className="text-sm tabular-nums"
              aria-live="off" // contador não anuncia cada segundo a leitores de tela
            >
              {formatDuration(seconds)}
            </span>
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
              <Button size="sm" variant="outline" onClick={pauseTimer} disabled={busy}>
                {busy && pending?.kind === 'pause' ? 'Pausando…' : 'Pausar'}
              </Button>
              <Button size="sm" variant="destructive" onClick={endTimer} disabled={busy}>
                {busy && pending?.kind === 'end' ? 'Encerrando…' : 'Encerrar'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
