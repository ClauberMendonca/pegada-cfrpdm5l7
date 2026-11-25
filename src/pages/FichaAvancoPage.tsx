// PEGADA — a ficha de um avanço, no endereço /mapa/avanco/:id.
// Em cima, a que ele serve (o fio). No meio, o avanço e o que fazer com ele.
// Embaixo, o que ajuda a fazer: material de referência e notas.
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { Referencias } from '@/components/Referencias'
import { TimeControl } from '@/components/TimeControlCompact'
import { Ficha, FichaNaoEncontrada } from '@/components/Ficha'
import type { Degrau } from '@/components/Trilha'
import { useAuth } from '@/contexts/AuthContext'
import { useTimer } from '@/contexts/TimeContext'
import { useToast } from '@/hooks/use-toast'
import { checkEligibility, isSelectableForFocus } from '@/lib/eligibility'
import { fichaDaResponsabilidade, fichaDoResultado } from '@/lib/pegada/enderecos'
import { fioDoAvanco } from '@/lib/pegada/fio'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { actionService, notificarMudanca } from '@/services/actionService'
import { timeService, type TimeEntry } from '@/services/timeService'
import type { ActionItem, ActionStatus } from '@/types/execution'

export function FichaAvancoPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const { toast } = useToast()
  const { revision } = useTimer()
  const [avanco, setAvanco] = useState<ActionItem | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'nao-achou'>('carregando')
  const [gravando, setGravando] = useState(false)
  const [editando, setEditando] = useState(false)
  const [anotando, setAnotando] = useState(false)
  const [tempos, setTempos] = useState<TimeEntry[]>([])
  const [temposErro, setTemposErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    try {
      const a = await actionService.getById(id)
      setAvanco(a)
      setEstado('pronto')
    } catch {
      setEstado((e) => (e === 'pronto' ? e : 'nao-achou'))
    }
  }, [id])

  const carregarTempos = useCallback(async () => {
    if (!id) return
    try {
      setTempos(await timeService.listByActions([id]))
      setTemposErro(null)
    } catch (e) {
      setTemposErro(e instanceof Error ? e.message : 'Não foi possível carregar o tempo.')
    }
  }, [id])

  useEffect(() => {
    setAvanco(null)
    setEstado('carregando')
    void carregar()
  }, [carregar])
  useEffect(() => {
    void carregarTempos()
  }, [carregarTempos, revision])
  usePegadaMudou(carregar)

  /** Toda escrita passa por aqui: grava, recarrega e avisa o Mapa ao lado. */
  const gravar = async (titulo: string, escrita: () => Promise<unknown>) => {
    if (gravando) return
    setGravando(true)
    try {
      await escrita()
      await carregar()
      notificarMudanca()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: titulo,
        description: e instanceof Error ? e.message : 'Tente de novo.',
      })
    } finally {
      setGravando(false)
    }
  }

  if (!id || estado === 'nao-achou') return <FichaNaoEncontrada oQue="este avanço" />
  if (!avanco || avanco.id !== id) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando a ficha" />
      </div>
    )
  }

  const resultado = avanco.expand?.project_id ?? null
  const responsabilidade = resultado
    ? (resultado.expand?.responsibility_id ?? null)
    : (avanco.expand?.responsibility_id ?? null)
  const fio = fioDoAvanco(avanco, user?.life_purpose)

  const degraus: Degrau[] = [
    { rotulo: 'Mapa', to: '/mapa' },
    ...(responsabilidade
      ? [{ rotulo: responsabilidade.title, to: fichaDaResponsabilidade(responsabilidade.id) }]
      : []),
    ...(resultado ? [{ rotulo: resultado.title, to: fichaDoResultado(resultado.id) }] : []),
  ]

  // Só um avanço pronto, de um resultado em andamento, pode entrar em Hoje.
  const podeEscolher = (): boolean => {
    const check = checkEligibility(avanco, resultado)
    if (check.ok && isSelectableForFocus(avanco, resultado)) return true
    toast({
      variant: 'destructive',
      title: 'Ainda não dá para escolher este avanço',
      description: check.label
        ? `Motivo: ${check.label}.`
        : 'Só avanços prontos entram em Hoje.',
    })
    return false
  }

  return (
    <>
      <Ficha
        degraus={degraus}
        atual={avanco.title}
        paraQue={
          fio.semFio ? (
            <>
              <p>Avanço livre: ainda não está ligado a um resultado. Também vale.</p>
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="mt-1 font-medium underline underline-offset-4"
              >
                Ligar a um resultado
              </button>
            </>
          ) : (
            <Link
              to={
                resultado
                  ? fichaDoResultado(resultado.id)
                  : responsabilidade
                    ? fichaDaResponsabilidade(responsabilidade.id)
                    : '/mapa'
              }
              className="font-medium underline-offset-4 hover:underline"
            >
              {fio.frase}
            </Link>
          )
        }
        como={
          <>
            <Referencias elemento="avanco" id={avanco.id} recarregar={avanco.status} />
          </>
        }
        semMoldura
      >
        <div data-avanco={avanco.id}>
          <ActionRow
            action={avanco}
            isNextAdvance={avanco.is_next_step}
            saving={gravando}
            onStatusChange={(aid, status: ActionStatus, motivo) =>
              void gravar('Não foi possível mudar a situação', () =>
                actionService.updateStatus(aid, status, motivo),
              )
            }
            onToggleNextStep={(aid, atual) => {
              if (!atual && !podeEscolher()) return
              void gravar('Não foi possível gravar a escolha', () =>
                atual ? actionService.unsetNextStep(aid) : actionService.setAsNextStep(aid),
              )
            }}
            onToggleTodaySelected={(aid, atual) => {
              if (!atual && !podeEscolher()) return
              void gravar('Não foi possível gravar a escolha', () =>
                actionService.setTodaySelected(aid, !atual),
              )
            }}
            onOpenLogModal={() => setAnotando(true)}
            onEdit={() => setEditando(true)}
            timeControl={
              <TimeControl
                targetType="action"
                targetId={avanco.id}
                targetTitle={avanco.title}
                contextLabel={resultado?.title ?? ''}
                targetStatus={avanco.status}
                projectStatus={resultado?.status ?? null}
                actionHasProject={Boolean(avanco.project_id)}
                entries={tempos}
                entriesError={temposErro}
                onRetryEntries={carregarTempos}
                onChanged={carregarTempos}
              />
            }
          />
        </div>
      </Ficha>

      <ActionModal
        isOpen={editando}
        onClose={() => setEditando(false)}
        actionToEdit={avanco}
        defaultContext={avanco.context}
        onSaved={() => {
          void carregar()
          notificarMudanca()
        }}
      />
      <ProgressLogModal
        isOpen={anotando}
        onClose={() => setAnotando(false)}
        action={avanco}
        onSaved={() => void carregar()}
      />
    </>
  )
}

export default FichaAvancoPage
