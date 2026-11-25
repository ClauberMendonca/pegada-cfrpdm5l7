// PEGADA — Hoje, a tela em que o app abre. O dia em três passos: o que já
// está marcado, o avanço principal e os poucos outros ("Também hoje").
// No fim, fechar o dia é opcional: uma pergunta por avanço que sobrou.
import { Dica } from '@/components/Dica'
import { ExemploVivo } from '@/components/ExemploVivo'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Check, ChevronDown, Plus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ActionItem, ActionStatus, Project } from '@/types/execution'
import { actionService, notificarMudanca } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { checkEligibility, isEligibleForFocusDisplay, isSelectableForFocus, resolveProjectState } from '@/lib/eligibility'
import { AvancoPrincipalCard } from '@/components/AvancoPrincipalCard'
import { FolhaDeEscolha } from '@/components/hoje/FolhaDeEscolha'
import { FecharODia } from '@/components/hoje/FecharODia'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dayInZone, todayInZone, ownerTimezone } from '@/lib/datetime'
import { PegadaSimbolo } from '@/components/PegadaSimbolo'
import { FioESemana } from '@/components/FioESemana'
import { fichaDoAvanco } from '@/lib/pegada/enderecos'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null) {
    const anyErr = err as { message?: unknown; response?: { message?: unknown } }
    if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message
    if (typeof anyErr.response?.message === 'string' && anyErr.response.message)
      return anyErr.response.message
  }
  return fallback
}

function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const ACAO_DA_LINHA =
  'flex min-h-11 items-center rounded-full bg-secondary px-4 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

export const TodayPage: React.FC = () => {
  const { user } = useAuth()
  const { contextFilter } = useGlobalFilter()
  const { toast } = useToast()

  const [actions, setActions] = useState<ActionItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [carregou, setCarregou] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [esperando, setEsperando] = useState<{ id: string; quem: string } | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  const [fechando, setFechando] = useState(false)

  const timezone = ownerTimezone(user?.timezone)
  const todayStr = todayInZone(timezone)
  const proposito = (user?.life_purpose ?? '').trim()
  const dataPorExtenso = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(new Date())

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const filterContext = contextFilter === 'todos' ? undefined : contextFilter
      const [allActions, allProjects] = await Promise.all([
        actionService.list(filterContext),
        projectService.list(filterContext),
      ])
      setActions(allActions)
      setProjects(allProjects)
    } catch (err: unknown) {
      setLoadError(errorMessage(err, 'Erro ao carregar dados. Verifique sua conexão e tente novamente.'))
    } finally {
      setCarregou(true)
    }
  }, [contextFilter])
  usePegadaMudou(loadData)

  useEffect(() => {
    void loadData()
  }, [loadData])

  const resolveProject = useCallback(
    (a: ActionItem): Project | null | undefined => resolveProjectState(a, projects),
    [projects],
  )

  // Em Hoje: escolhido com um toque, ou deixado ontem "para amanhã".
  const emHoje = useCallback(
    (a: ActionItem) => Boolean(a.is_today_selected) || a.planned_date === todayStr,
    [todayStr],
  )
  // Compromisso com data de hoje já aparece em "Já marcado para hoje".
  const jaMarcado = useCallback(
    (a: ActionItem) => a.kind === 'compromisso' && a.planned_date === todayStr,
    [todayStr],
  )

  const principal = useMemo(
    () => actions.find((a) => a.is_next_step && isEligibleForFocusDisplay(a, resolveProject)),
    [actions, resolveProject],
  )
  const abertosDeHoje = useMemo(
    () =>
      actions.filter(
        (a) => emHoje(a) && !a.is_next_step && !jaMarcado(a) && isEligibleForFocusDisplay(a, resolveProject),
      ),
    [actions, emHoje, jaMarcado, resolveProject],
  )
  const feitosHoje = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.status === 'feita' &&
          Boolean(a.completed_at) &&
          dayInZone(a.completed_at as string, timezone) === todayStr,
      ),
    [actions, timezone, todayStr],
  )
  // Também hoje: os abertos e, riscados, os escolhidos que já foram feitos.
  const tambemHoje = useMemo(
    () => [...abertosDeHoje, ...feitosHoje.filter((a) => a.is_today_selected)],
    [abertosDeHoje, feitosHoje],
  )
  const candidatos = useMemo(
    () => actions.filter((a) => !a.is_next_step && !jaMarcado(a) && isEligibleForFocusDisplay(a, resolveProject)),
    [actions, jaMarcado, resolveProject],
  )
  const sobras = useMemo(() => [...(principal ? [principal] : []), ...abertosDeHoje], [principal, abertosDeHoje])

  // "O que andou", em uma frase e sem número de cobrança.
  const oQueAndou = useMemo(() => {
    const n = feitosHoje.length
    if (n === 0) return ''
    const resultados = new Set(feitosHoje.map((a) => a.project_id).filter(Boolean)).size
    const avancos = n === 1 ? 'Hoje andou 1 avanço' : `Hoje andaram ${n} avanços`
    if (resultados === 0) return `${avancos}.`
    return `${avancos}, em ${resultados === 1 ? '1 resultado' : `${resultados} resultados`}.`
  }, [feitosHoje])

  const gravar = async (id: string, acao: () => Promise<unknown>, falha: string) => {
    if (savingActionId) return
    setSavingActionId(id)
    try {
      await acao()
      await loadData()
      notificarMudanca()
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: falha,
        description: errorMessage(err, 'Verifique a conexão e tente de novo.'),
      })
    } finally {
      setSavingActionId(null)
    }
  }

  const tirarDeHoje = async (a: ActionItem) => {
    if (a.is_today_selected) await actionService.setTodaySelected(a.id, false)
    if (a.planned_date === todayStr) await actionService.update(a.id, { planned_date: '' })
  }

  const alternarHoje = (a: ActionItem) => {
    if (emHoje(a)) return gravar(a.id, () => tirarDeHoje(a), 'Não foi possível tirar de Hoje')
    const check = checkEligibility(a, resolveProject(a))
    if (!check.ok || !isSelectableForFocus(a, resolveProject(a))) {
      toast({
        variant: 'destructive',
        title: 'Não é possível escolher',
        description: check.label || 'Só um avanço aberto pode entrar em Hoje.',
      })
      return
    }
    return gravar(a.id, () => actionService.setTodaySelected(a.id, true), 'Não foi possível escolher')
  }

  const mudarEstado = (id: string, status: ActionStatus) =>
    gravar(id, () => actionService.updateStatus(id, status), 'Não foi possível gravar')

  const esperarAlguem = (a: ActionItem, quem: string) =>
    gravar(
      a.id,
      async () => {
        await tirarDeHoje(a)
        await actionService.updateStatus(a.id, 'aguardando', quem.trim())
        setEsperando(null)
        setAberta(null)
      },
      'Não foi possível marcar a espera',
    )

  const paraAmanha = (a: ActionItem) =>
    gravar(
      a.id,
      async () => {
        if (a.is_next_step) await actionService.unsetNextStep(a.id)
        if (a.is_today_selected) await actionService.setTodaySelected(a.id, false)
        await actionService.update(a.id, { planned_date: diaSeguinte(todayStr) })
      },
      'Não foi possível deixar para amanhã',
    )

  const devolver = (a: ActionItem) =>
    gravar(
      a.id,
      async () => {
        if (a.is_next_step) await actionService.unsetNextStep(a.id)
        await tirarDeHoje(a)
      },
      'Não foi possível devolver ao Mapa',
    )

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-8">
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">{dataPorExtenso}</p>
            <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-foreground">Hoje</h1>
          </div>
          <Link
            to={proposito ? '/mapa' : '/mapa/proposito'}
            className="flex min-h-11 items-center gap-2.5 text-sm leading-snug text-muted-foreground hover:text-foreground"
          >
            <PegadaSimbolo pequeno className="h-[18px] w-[18px] shrink-0 text-foreground" />
            <span className="min-w-0 break-words">
              {proposito || 'Escreva o seu propósito: é dele que nasce cada porquê.'}
            </span>
          </Link>
        </div>

        {loadError && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-pegada-danger-bg p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Falha ao carregar dados do Hoje.</p>
              <p className="mt-0.5 text-xs text-destructive">{loadError}</p>
              <Button size="sm" variant="outline" onClick={loadData} className="mt-2 text-xs">
                Tentar novamente
              </Button>
            </div>
          </div>
        )}

        <ExemploVivo onCriado={() => void loadData()} />
        <Dica id="hoje-fio">
          Cada avanço carrega o seu porquê: “Faço isto, para alcançar aquilo, porque…”. Se a frase soar errada,
          algo está no lugar errado.
        </Dica>

        <AvancoPrincipalCard onEscolher={() => setEscolhendo(true)}>
          <section aria-label="Também hoje" className="space-y-1">
            <div className="flex items-center justify-between gap-3 px-1 pb-1.5">
              <h2 className="text-[17px] font-semibold text-foreground">Também hoje</h2>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 gap-1.5 text-sm"
                onClick={() => setEscolhendo(true)}
                disabled={!carregou}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Adicionar
              </Button>
            </div>
            {tambemHoje.length > 0 ? (
              <ul className="overflow-hidden rounded-[20px] border border-border bg-card">
                {tambemHoje.map((action, i) => {
                  const feito = action.status === 'feita'
                  const resultado = resolveProject(action)?.title
                  const expandida = aberta === action.id && !feito
                  return (
                    <li key={action.id} className={cn(i > 0 && 'border-t border-border')} data-linha-de-hoje>
                      <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          disabled={savingActionId !== null}
                          aria-label={`${feito ? 'Desmarcar' : 'Concluir'}: ${action.title}`}
                          onClick={() => mudarEstado(action.id, feito ? 'pronta' : 'feita')}
                          className={cn(
                            '-mx-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                            savingActionId === action.id && 'opacity-60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-full',
                              feito ? 'bg-foreground text-background' : 'border-2 border-muted-foreground',
                            )}
                          >
                            {feito && <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />}
                          </span>
                        </button>
                        {feito ? (
                          <Link to={fichaDoAvanco(action.id)} className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="break-words text-base font-medium leading-tight text-muted-foreground line-through">
                              {action.title}
                            </span>
                            <span className="truncate text-[13px] text-muted-foreground">
                              {resultado || 'Avanço livre'}
                            </span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            aria-expanded={expandida}
                            aria-label={`Opções: ${action.title}`}
                            onClick={() => {
                              setAberta(expandida ? null : action.id)
                              setEsperando(null)
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="break-words text-base font-medium leading-tight text-foreground">
                                {action.title}
                              </span>
                              <span className="truncate text-[13px] text-muted-foreground">
                                {resultado || 'Avanço livre'}
                              </span>
                            </span>
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                                expandida && 'rotate-180',
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </div>
                      {expandida && (
                        <div className="px-4 pb-3" data-acoes-da-linha>
                          {esperando?.id === action.id ? (
                            <form
                              className="flex flex-wrap items-center gap-2"
                              onSubmit={(e) => {
                                e.preventDefault()
                                void esperarAlguem(action, esperando.quem)
                              }}
                            >
                              <Input
                                autoFocus
                                aria-label="De quem ou do quê você está esperando?"
                                placeholder="De quem ou do quê?"
                                value={esperando.quem}
                                onChange={(e) => setEsperando({ id: action.id, quem: e.target.value })}
                                className="min-h-11 min-w-0 flex-1"
                              />
                              <Button
                                type="submit"
                                className="min-h-11"
                                disabled={savingActionId !== null || !esperando.quem.trim()}
                              >
                                Marcar espera
                              </Button>
                            </form>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={ACAO_DA_LINHA}
                                disabled={savingActionId !== null}
                                onClick={() => {
                                  setAberta(null)
                                  void gravar(action.id, () => tirarDeHoje(action), 'Não foi possível tirar de Hoje')
                                }}
                              >
                                Deixar para depois
                              </button>
                              <button
                                type="button"
                                className={ACAO_DA_LINHA}
                                disabled={savingActionId !== null}
                                onClick={() => setEsperando({ id: action.id, quem: action.waiting_for || '' })}
                              >
                                Estou esperando alguém
                              </button>
                              <Link to={fichaDoAvanco(action.id)} className={ACAO_DA_LINHA}>
                                Abrir
                              </Link>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rounded-[20px] border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                Nada mais escolhido para hoje. Toque em Adicionar para escolher poucos outros.
              </p>
            )}
          </section>

          {(oQueAndou || sobras.length > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1" data-fim-do-dia>
              <p className="text-sm text-muted-foreground" data-o-que-andou>
                {oQueAndou}
              </p>
              {sobras.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-sm"
                  onClick={() => setFechando(true)}
                >
                  Fechar o dia
                </Button>
              )}
            </div>
          )}
        </AvancoPrincipalCard>

        <FolhaDeEscolha
          open={escolhendo}
          onOpenChange={setEscolhendo}
          candidatos={candidatos}
          projetos={projects}
          emHoje={emHoje}
          ocupadoId={savingActionId}
          onAlternar={(a) => void alternarHoje(a)}
        />
        <FecharODia
          open={fechando}
          onOpenChange={setFechando}
          sobras={sobras}
          ocupadoId={savingActionId}
          onAmanha={(a) => void paraAmanha(a)}
          onDevolver={(a) => void devolver(a)}
        />
      </div>
      <FioESemana
        actions={actions}
        hoje={todayStr}
        timezone={timezone}
        className="hidden lg:sticky lg:top-6 lg:flex"
      />
    </div>
  )
}
