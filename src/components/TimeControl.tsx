// FATIA — REGISTRO DE TEMPO V1: diálogos de tempo (manual/corrigir, histórico)
// e o indicador global compacto do cronômetro.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

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
import { formatEntityTitle } from '@/lib/entityNumber'

/**
 * "R-3 · Título" (ou só o título) — formatter EXISTENTE formatEntityTitle,
 * sem duplicar prefixo. O código prop ("R-3"/"AV-12", ou legado "P-3"/"A-12")
 * vem do sequence_number do objeto persistido do alvo; sem código, o título
 * continua legível. Aqui é só apresentação: nunca grava código em title/
 * snapshots/payloads. A correspondência de prefixo é exata (AV- não confunde
 * com A-; 3 não casa com 13).
 */
function entityNumberedText(
  targetType: TimeTargetType,
  code: string | null | undefined,
  title: string,
): string {
  if (!code) return title
  const m = /^(R|AV|P|A)-(\d+)$/.exec(code)
  if (!m) return title
  return formatEntityTitle(targetType, Number(m[2]), title)
}

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
  /** Código persistido do alvo ("P-3"/"A-12"); só apresentação, nunca gravado. */
  targetNumberCode?: string | null
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
  targetNumberCode = null,
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
            <div className="font-medium">
              {entityNumberedText(targetType, targetNumberCode, targetTitle)}
            </div>
            <div className="text-muted-foreground">
              {targetType === 'action' ? 'Avanço' : 'Resultado'}
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
  /** Código persistido do alvo ("P-3"/"A-12"); só apresentação, nunca gravado. */
  targetNumberCode?: string | null
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
  targetNumberCode = null,
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
          <DialogTitle>
            Tempo registrado · {entityNumberedText(targetType, targetNumberCode, targetTitle)}
          </DialogTitle>
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
// Histórico recolhível no detalhe do resultado (subtotal Dos avanços / Direto)
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
              <span className="text-muted-foreground">Dos avanços</span>
              <span className="font-medium">{totalLabel(actionsTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Direto no resultado</span>
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
                          {e.target_title || (e.target_type === 'action' ? 'Avanço' : 'Resultado')}{' '}
                          · {formatCalendarDay(e.entry_date)}
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

/**
 * O relógio visto de qualquer tela: um chip discreto no topo, no lugar da
 * faixa que cobria o conteúdo. Tocar leva à ficha onde o tempo está correndo,
 * e é lá que ficam pausar e parar.
 */
export const GlobalTimerIndicator: React.FC<{ className?: string }> = ({ className }) => {
  const { running, pending, error, reconcile, isReconciling } = useTimer()
  const liveSeconds = useRunningSeconds()

  if (!running && !error) return null // conciliação nunca inicia nada automaticamente

  if (!running) {
    return (
      <button
        type="button"
        onClick={() => reconcile()}
        disabled={isReconciling || pending !== null}
        title={error || undefined}
        aria-label={`Relógio com problema: ${error}. Reconfirmar`}
        className={`flex h-11 items-center gap-2 rounded-full border border-destructive/40 px-3 text-sm text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
      >
        <Timer className="h-4 w-4 shrink-0" aria-hidden="true" />
        {isReconciling ? 'Confirmando…' : 'Reconfirmar'}
      </button>
    )
  }

  const pausado = running.status === 'paused'
  const seconds = pausado ? Number(running.duration_seconds) || 0 : liveSeconds
  const s = Math.max(0, Math.round(seconds))
  const dois = (n: number) => String(n).padStart(2, '0')
  const relogio =
    s >= 3600
      ? `${Math.floor(s / 3600)}:${dois(Math.floor((s % 3600) / 60))}:${dois(s % 60)}`
      : `${dois(Math.floor(s / 60))}:${dois(s % 60)}`
  const nome = running.target_title || (running.target_type === 'action' ? 'Avanço' : 'Resultado')
  const to =
    running.target_type === 'action'
      ? `/mapa/avanco/${encodeURIComponent(running.action_id || '')}`
      : `/mapa/resultado/${encodeURIComponent(running.project_id || '')}`

  return (
    <Link
      to={to}
      data-relogio-no-topo
      title={`${pausado ? 'Pausado' : 'Correndo'}: ${nome}`}
      aria-label={`Relógio ${pausado ? 'pausado' : 'correndo'} em ${nome}: ${relogio}. Abrir`}
      className={`flex h-11 shrink-0 items-center gap-2 rounded-full bg-secondary px-3.5 text-sm font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        {!pausado && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${pausado ? 'bg-muted-foreground' : 'bg-primary'}`}
        />
      </span>
      {relogio}
    </Link>
  )
}
