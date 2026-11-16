// FATIA — REGISTRO DE TEMPO V1: provider compartilhado do cronômetro.
//
// Um único intervalo correndo por dono (o servidor garante transacionalmente;
// aqui apenas reconciliamos e evitamos cliques repetidos). Fechar diálogo,
// trocar página, recarregar ou sair da sessão NÃO encerra o registro: ao
// voltar, reconciliamos com o estado do servidor (getRunning). Contador é
// exibição apenas — duração real deriva dos instantes persistidos no stop.

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
  /** true enquanto reconcilia com o servidor (após foco/mount). */
  isReconciling: boolean
  /** Operação cujo commit ainda não confirmou — bloqueia novo clique. */
  pending: PendingOp | null
  error: string | null
  startTimer: (
    targetType: TimeTargetType,
    targetId: string,
    title: string,
  ) => Promise<TimeServiceError | null>
  pauseTimer: () => Promise<TimeServiceError | null>
  endTimer: () => Promise<TimeServiceError | null>
  resumeTimer: (entryId: string) => Promise<TimeServiceError | null>
  reconcile: () => Promise<void>
  nowMs: number
}

const TimeContext = createContext<TimeContextValue | undefined>(undefined)

export const TimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth()
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [isReconciling, setIsReconciling] = useState(true)
  const [pending, setPending] = useState<PendingOp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const reconciled = useRef(false)

  // Tique de exibição: 1s. A duração REAL continua derivada dos instantes
  // persistidos (hook no stop); este valor é só o relógio da tela.
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])

  const reconcile = useCallback(async () => {
    if (!pb.authStore.isValid) {
      setRunning(null)
      setIsReconciling(false)
      return
    }
    setIsReconciling(true)
    try {
      const r = await timeService.getRunning()
      setRunning(r)
      setError(null)
    } catch {
      setError('Não foi possível confirmar o estado do cronômetro no servidor.')
    } finally {
      setIsReconciling(false)
    }
  }, [])

  // Primeira conciliação após login/mount; e re-conciliação ao voltar o foco
  // (aba em segundo plano / telefone bloqueado não apaga o início).
  useEffect(() => {
    if (!isAuthenticated) {
      reconciled.current = false
      setRunning(null)
      setIsReconciling(false)
      return
    }
    if (!reconciled.current) {
      reconciled.current = true
      reconcile()
    }
  }, [isAuthenticated, reconcile])

  useEffect(() => {
    if (!isAuthenticated) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    const onFocus = () => reconcile()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [isAuthenticated, reconcile])

  const startTimer = useCallback(
    async (targetType: TimeTargetType, targetId: string, title: string) => {
      if (pending) {
        const err = new TimeServiceError('Operação anterior ainda não confirmada.', 409, 'pending')
        setError(err.message)
        return err
      }
      setPending({ kind: 'start', targetId, message: title })
      setError(null)
      try {
        const entry = await timeService.start(targetType, targetId)
        setRunning(entry)
        setNowMs(Date.now())
        return null
      } catch (err) {
        const e = err as TimeServiceError
        setError(e.message)
        // Estado do servidor pode ter mudado: reconcilia (mostra o ativo).
        if (e.status === 409) reconcile()
        return e
      } finally {
        setPending(null)
      }
    },
    [pending, reconcile],
  )

  const stopWith = useCallback(
    async (kind: 'pause' | 'end') => {
      if (!running) return null
      if (pending) {
        const err = new TimeServiceError('Operação anterior ainda não confirmada.', 409, 'pending')
        setError(err.message)
        return err
      }
      const entryId = running.id
      setPending({ kind, targetId: entryId, message: running.target_title || '' })
      setError(null)
      try {
        const entry = await timeService.stop(entryId, kind)
        setRunning(null)
        return null
      } catch (err) {
        const e = err as TimeServiceError
        setError(e.message)
        reconcile()
        return e
      } finally {
        setPending(null)
      }
    },
    [running, pending, reconcile],
  )

  const pauseTimer = useCallback(() => stopWith('pause'), [stopWith])
  const endTimer = useCallback(() => stopWith('end'), [stopWith])

  const resumeTimer = useCallback(
    async (entryId: string) => {
      if (pending) {
        const err = new TimeServiceError('Operação anterior ainda não confirmada.', 409, 'pending')
        setError(err.message)
        return err
      }
      setPending({ kind: 'resume', targetId: entryId, message: running?.target_title || '' })
      setError(null)
      try {
        const entry = await timeService.resume(entryId)
        setRunning(entry)
        setNowMs(Date.now())
        return null
      } catch (err) {
        const e = err as TimeServiceError
        setError(e.message)
        if (e.status === 409) reconcile()
        return e
      } finally {
        setPending(null)
      }
    },
    [pending, running, reconcile],
  )

  const value = useMemo<TimeContextValue>(
    () => ({
      running,
      isReconciling,
      pending,
      error,
      startTimer,
      pauseTimer,
      endTimer,
      resumeTimer,
      reconcile,
      nowMs,
    }),
    [
      running,
      isReconciling,
      pending,
      error,
      startTimer,
      pauseTimer,
      endTimer,
      resumeTimer,
      reconcile,
      nowMs,
    ],
  )

  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>
}

export function useTimer(): TimeContextValue {
  const ctx = useContext(TimeContext)
  if (!ctx) throw new Error('useTimer deve ser usado dentro de um TimeProvider')
  return ctx
}

/** Duração corrente em exibição (derivada do started_at persistido). */
export function useRunningSeconds(): number {
  const { running, nowMs } = useTimer()
  return currentRunningSeconds(running, nowMs)
}
