// PEGADA — adicionar no lugar: o campo que cria o filho do tipo certo, embaixo
// do item a que ele serve. O tipo vem do degrau, sem formulário de classificar.
// O campo já começa a frase: "Até [data], ..." no resultado e "Por meio de ..."
// na estratégia. Enter cria e deixa o campo pronto para o próximo; Esc fecha.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { conferirResultado, op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { ACTION_KIND_LABEL, type ActionKind } from '@/types/execution'
import { cn } from '@/lib/utils'

export type TipoDeFilho = 'vontade' | 'responsabilidade' | 'resultado' | 'estrategia' | 'avanco'

export interface OndeAdicionar {
  vontadeId?: string
  responsabilidadeId?: string
  resultadoId?: string
  estrategiaId?: string
}

interface Props {
  /** Os tipos que este degrau aceita, na ordem. O primeiro é o padrão. */
  tipos: TipoDeFilho[]
  onde?: OndeAdicionar
  /** Contexto herdado do pai ou do filtro. Sem ele, a pessoa escolhe Vida ou Trabalho. */
  contexto?: 'vida' | 'trabalho'
  /** Nome do pai, para leitores de tela: "Adicionar em <nome>". */
  em: string
  onCriado?: () => void
}

const NOME: Record<TipoDeFilho, string> = {
  vontade: 'Vontade',
  responsabilidade: 'Responsabilidade',
  resultado: 'Resultado',
  estrategia: 'Estratégia',
  avanco: 'Avanço',
}
const EXEMPLO: Record<TipoDeFilho, string> = {
  vontade: 'Algo que você quer, sem ninguém cobrar. Ex.: voltar a tocar violão',
  responsabilidade: 'Algo pelo qual você responde. Ex.: saúde da família',
  resultado: 'o que estará alcançado. Ex.: loja no ar com 10 clientes',
  estrategia: 'o caminho em que você aposta. Ex.: indicações de clientes',
  avanco: 'O próximo passo. Ex.: ligar para o contador',
}
const CAMPO =
  'h-11 min-w-0 rounded-xl border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function AdicionarNoLugar({ tipos, onde, contexto, em, onCriado }: Props) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<TipoDeFilho>(tipos[0])
  const [texto, setTexto] = useState('')
  const [prazo, setPrazo] = useState('')
  // Avanço não é só tarefa. A Espera fica de fora: ela nasce dizendo por quem se espera.
  const [especie, setEspecie] = useState<ActionKind>('acao')
  const [ctx, setCtx] = useState<'vida' | 'trabalho'>(contexto ?? 'trabalho')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto, tipo])

  // Correção gentil: quando a pessoa para de escrever um resultado, a IA confere
  // se ele tem linha de chegada. Se parecer outra coisa, diz em uma linha o lugar
  // certo. Não trava nada: sem IA, ou com falha, o campo segue como sempre.
  const [correcao, setCorrecao] = useState<{ e: string; por_que: string; de: string } | null>(null)
  useEffect(() => {
    const t = texto.trim()
    if (!aberto || tipo !== 'resultado' || t.length < 12) return
    let vivo = true
    const espera = window.setTimeout(() => {
      conferirResultado(t)
        .then((r) => {
          if (vivo && ['vontade', 'responsabilidade', 'estrategia', 'proposito'].includes(r.e)) setCorrecao({ ...r, de: t })
        })
        .catch(() => {})
    }, 900)
    return () => {
      vivo = false
      window.clearTimeout(espera)
    }
  }, [aberto, tipo, texto])
  const correcaoVale = correcao && tipo === 'resultado' && correcao.de === texto.trim() ? correcao : null

  const guardarComo = async (operacao: 'criar_vontade' | 'criar_responsabilidade') => {
    const titulo = texto.trim()
    if (!titulo || ocupado) return
    setOcupado(true)
    setErro(null)
    try {
      await op(
        operacao,
        { titulo, contexto: contexto ?? ctx },
        { desfazer: true, onDesfeito: notificarMudanca },
      )
      setTexto('')
      setCorrecao(null)
      notificarMudanca()
      onCriado?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  // Só os itens que nascem sem pai precisam dizer se são de Vida ou de Trabalho.
  const escolheContexto =
    !contexto &&
    (tipo === 'responsabilidade' ||
      tipo === 'vontade' ||
      (!onde?.vontadeId && !onde?.responsabilidadeId && !onde?.resultadoId && !onde?.estrategiaId))

  const criar = async () => {
    const titulo = texto.trim()
    if (!titulo || ocupado) return
    setOcupado(true)
    setErro(null)
    const contextoFinal = contexto ?? ctx
    try {
      const opcoes = { desfazer: true, onDesfeito: notificarMudanca }
      if (tipo === 'vontade') {
        await op('criar_vontade', { titulo, contexto: contextoFinal }, opcoes)
      } else if (tipo === 'responsabilidade') {
        await op('criar_responsabilidade', { titulo, contexto: contextoFinal }, opcoes)
      } else if (tipo === 'resultado') {
        // Sem prazo ainda não é um resultado ativo: fica guardado em "Depois".
        await op(
          'criar_resultado',
          {
            titulo,
            prazo,
            vontade_id: onde?.vontadeId,
            responsabilidade_id: onde?.responsabilidadeId,
            contexto: contextoFinal,
            situacao: prazo ? 'ativo' : 'futuro',
          },
          opcoes,
        )
      } else if (tipo === 'estrategia') {
        await op('criar_estrategia', { resultado_id: onde?.resultadoId, titulo }, opcoes)
      } else {
        await op(
          'criar_avanco',
          {
            titulo,
            tipo: especie,
            estrategia_id: onde?.estrategiaId,
            resultado_id: onde?.estrategiaId ? undefined : onde?.resultadoId,
            responsabilidade_id:
              onde?.estrategiaId || onde?.resultadoId ? undefined : onde?.responsabilidadeId,
            contexto: contextoFinal,
          },
          opcoes,
        )
      }
      setTexto('')
      setPrazo('')
      notificarMudanca()
      onCriado?.()
      campo.current?.focus()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Adicionar em ${em}`}
        data-adicionar
        className="flex h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Adicionar
      </button>
    )
  }

  return (
    <form
      data-adicionar-aberto
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        void criar()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          setAberto(false)
          setErro(null)
        }
      }}
    >
      {tipos.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="O que adicionar">
          {tipos.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              className={cn(
                'h-9 rounded-full px-3 text-sm font-medium',
                tipo === t ? 'bg-foreground text-background' : 'border border-input text-foreground',
              )}
            >
              {NOME[t]}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {tipo === 'resultado' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Até
            <input
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              aria-label="Prazo do resultado"
              className={cn(CAMPO, 'w-[9.5rem]')}
            />
          </label>
        )}
        {tipo === 'avanco' && (
          <select
            value={especie}
            onChange={(e) => setEspecie(e.target.value as ActionKind)}
            aria-label="Tipo de avanço"
            className={cn(CAMPO, 'w-auto pr-1 text-sm')}
          >
            {(Object.keys(ACTION_KIND_LABEL) as ActionKind[])
              .filter((k) => k !== 'espera')
              .map((k) => (
                <option key={k} value={k}>
                  {ACTION_KIND_LABEL[k]}
                </option>
              ))}
          </select>
        )}
        {tipo === 'estrategia' && <span className="text-sm text-muted-foreground">Por meio de</span>}
        <input
          ref={campo}
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={200}
          aria-label={`${NOME[tipo]} em ${em}`}
          placeholder={EXEMPLO[tipo]}
          className={cn(CAMPO, 'flex-1 basis-48')}
        />
      </div>
      {escolheContexto && (
        <div className="flex gap-1.5" role="group" aria-label="Vida ou Trabalho">
          {(['vida', 'trabalho'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={ctx === c}
              onClick={() => setCtx(c)}
              className={cn(
                'h-9 rounded-full px-3 text-sm font-medium capitalize',
                ctx === c ? 'bg-secondary text-foreground' : 'text-muted-foreground',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {tipo === 'resultado' && !prazo && texto.trim() !== '' && (
        <p className="px-1 text-[13px] text-muted-foreground">
          Sem prazo, ele fica guardado em “Depois” até você marcar a data.
        </p>
      )}
      {correcaoVale && (
        <div className="space-y-2 rounded-2xl bg-secondary p-3" role="status" data-correcao={correcaoVale.e}>
          <p className="break-words text-sm text-foreground">
            {correcaoVale.por_que}{' '}
            {correcaoVale.e === 'responsabilidade'
              ? 'Quer guardar como responsabilidade e criar um resultado dentro dela?'
              : correcaoVale.e === 'vontade'
                ? 'Quer guardar como vontade e criar um resultado dentro dela?'
                : correcaoVale.e === 'estrategia'
                ? 'Parece um caminho, não o destino. Para quê você faria isso? A resposta é o resultado.'
                : 'Parece o seu propósito, que nunca se conclui. Que estado você quer alcançar por causa dele?'}
          </p>
          <div className="flex flex-wrap gap-2">
            {(correcaoVale.e === 'responsabilidade' || correcaoVale.e === 'vontade') && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() =>
                  void guardarComo(correcaoVale.e === 'vontade' ? 'criar_vontade' : 'criar_responsabilidade')
                }
                className="h-9 rounded-full bg-foreground px-3 text-sm font-medium text-background"
              >
                Guardar como {correcaoVale.e}
              </button>
            )}
            <button
              type="button"
              onClick={() => setCorrecao(null)}
              className="h-9 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Dispensar
            </button>
          </div>
        </div>
      )}
      {erro && (
        <p role="alert" className="px-1 text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!texto.trim() || ocupado}
          className="flex h-11 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Criar {NOME[tipo].toLowerCase()}
        </button>
        <button
          type="button"
          onClick={() => {
            setAberto(false)
            setErro(null)
          }}
          className="h-11 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Fechar
        </button>
      </div>
    </form>
  )
}

export default AdicionarNoLugar
