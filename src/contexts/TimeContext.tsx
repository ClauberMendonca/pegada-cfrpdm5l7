import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import pb from '@/lib/pocketbase/client'
import { TimeEntry, TimeServiceError, TimeTargetType, timeService } from '@/services/timeService'
import { currentRunningSeconds } from '@/lib/timeHelpers'

export interface PendingOp {
  kind: 'start' | 'pause' | 'end' | 'resume'
  targetId: string
  message: string
}
interface TimeContextValue {
  running: TimeEntry | null
  isReconciling: boolean
  pending: PendingOp | null
  error: string | null
  revision: number
  nowMs: number
  startTimer: (
    targetType: TimeTargetType,
    targetId: string,
    title: string,
  ) => Promise<TimeServiceError | null>
  pauseTimer: () => Promise<TimeServiceError | null>
  endTimer: () => Promise<TimeServiceError | null>
  resumeTimer: (entryId: string) => Promise<TimeServiceError | null>
  reconcile: () => Promise<void>
}
const TimeContext = createContext<TimeContextValue | undefined>(undefined)

export const TimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth()
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [isReconciling, setIsReconciling] = useState(true)
  const [pending, setPending] = useState<PendingOp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const busy = useRef(false)
  const version = useRef(0)
  const confirmed = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      version.current++
    }
  }, [])

  useEffect(() => {
    if (running?.status !== 'running') return
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running?.id, running?.status])

  const reconcile = useCallback(async () => {
    if (busy.current || !pb.authStore.isValid) return
    const token = ++version.current
    const owner = pb.authStore.record?.id
    setIsReconciling(true)
    try {
      const r = await timeService.getRunning()
      if (!mounted.current || token !== version.current || pb.authStore.record?.id !== owner) return
      setRunning(r)
      setNowMs(Date.now())
      confirmed.current = true
      setError(null)
      setRevision((n) => n + 1)
    } catch {
      if (mounted.current && token === version.current) {
        confirmed.current = false
        setError('Não foi possível confirmar o cronômetro. Tente novamente antes de iniciar outro.')
      }
    } finally {
      if (mounted.current && token === version.current) setIsReconciling(false)
    }
  }, [])

  useEffect(() => {
    ++version.current
    confirmed.current = false
    setRunning(null)
    setPending(null)
    setError(null)
    if (isAuthenticated) {
      reconcile()
    } else {
      setIsReconciling(false)
    }
  }, [isAuthenticated, user?.id, reconcile])

  useEffect(() => {
    if (!isAuthenticated) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ginga-time-refresh') reconcile()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', reconcile)
    window.addEventListener('ginga-time-changed', reconcile)
    window.addEventListener('storage', onStorage)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('ginga-time-changed', reconcile)
      window.removeEventListener('storage', onStorage)
    }
  }, [isAuthenticated, reconcile])

  const operate = useCallback(
    async (op: PendingOp, work: () => Promise<TimeEntry>): Promise<TimeServiceError | null> => {
      if (busy.current)
        return new TimeServiceError('Aguarde a confirmação da operação anterior.', 409, 'pending')
      if (!confirmed.current && (op.kind === 'start' || op.kind === 'resume')) {
        return new TimeServiceError(
          'Confirme o cronômetro no servidor antes de iniciar.',
          409,
          'unconfirmed',
        )
      }
      busy.current = true
      const owner = pb.authStore.record?.id
      const token = ++version.current
      setIsReconciling(false)
      setPending(op)
      setError(null)
      let failure: TimeServiceError | null = null
      try {
        const entry = await work()
        if (!mounted.current || token !== version.current || pb.authStore.record?.id !== owner)
          return null
        setRunning(
          entry.status === 'running' ||
            (entry.status === 'paused' && !entry.is_deleted && !entry.resumed_by)
            ? entry
            : null,
        )
        setNowMs(Date.now())
        setRevision((n) => n + 1)
      } catch (err) {
        failure =
          err instanceof TimeServiceError
            ? err
            : new TimeServiceError('Operação sem confirmação.', 502, 'uncertain')
        if (mounted.current && token === version.current) setError(failure.message)
      } finally {
        busy.current = false
        if (mounted.current && token === version.current) setPending(null)
      }
      if (mounted.current && pb.authStore.record?.id === owner) {
        await reconcile()
        if (failure) setError(failure.message)
      }
      return failure
    },
    [reconcile],
  )

  const startTimer = useCallback(
    (type: TimeTargetType, id: string, title: string) =>
      operate({ kind: 'start', targetId: id, message: title }, () => timeService.start(type, id)),
    [operate],
  )
  const pauseTimer = useCallback(
    () =>
      running
        ? operate(
            { kind: 'pause', targetId: running.id, message: running.target_title || '' },
            () => timeService.stop(running.id, 'pause'),
          )
        : Promise.resolve(null),
    [running, operate],
  )
  const endTimer = useCallback(
    () =>
      running
        ? operate({ kind: 'end', targetId: running.id, message: running.target_title || '' }, () =>
            timeService.stop(running.id, 'end'),
          )
        : Promise.resolve(null),
    [running, operate],
  )
  const resumeTimer = useCallback(
    (id: string) =>
      operate({ kind: 'resume', targetId: id, message: running?.target_title || '' }, () =>
        timeService.resume(id),
      ),
    [running, operate],
  )
  const value = useMemo(
    () => ({
      running,
      isReconciling,
      pending,
      error,
      revision,
      nowMs,
      startTimer,
      pauseTimer,
      endTimer,
      resumeTimer,
      reconcile,
    }),
    [
      running,
      isReconciling,
      pending,
      error,
      revision,
      nowMs,
      startTimer,
      pauseTimer,
      endTimer,
      resumeTimer,
      reconcile,
    ],
  )
  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>
}
export function useTimer(): TimeContextValue {
  const ctx = useContext(TimeContext)
  if (!ctx) throw new Error('useTimer deve ser usado dentro de um TimeProvider')
  return ctx
}
export function useRunningSeconds(): number {
  const { running, nowMs } = useTimer()
  if (running?.status === 'paused') return running.duration_seconds || 0
  return currentRunningSeconds(running, nowMs)
}
