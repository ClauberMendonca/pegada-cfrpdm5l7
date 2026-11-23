import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { criarAgente, decidirProposta, desfazer, mcpUrl, revogarAgente } from '@/lib/pegada/api'

// PEGADA — Atividade: o que cada um fez (pessoa, IA embutida, agentes), com
// desfazer; as escolhas que agentes propuseram e aguardam o dono; e o acesso
// de cada agente (nível 2), com token, escopos e revogação.

interface AuditRow {
  id: string
  actor_type: 'pessoa' | 'ia_embutida' | 'agente'
  agent_id: string
  op: string
  summary: string
  undo_of: string
  undone_at: string
  created: string
}

interface ProposalRow {
  id: string
  agent_id: string
  op: string
  summary: string
  reason: string
  status: string
  created: string
}

interface AgentRow {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  status: 'ativo' | 'revogado'
  last_used_at: string
}

const ESCOPOS: { id: string; nome: string; ajuda: string }[] = [
  { id: 'ler', nome: 'Ler', ajuda: 'ver o fio de hoje, o mapa, o resumo e o histórico' },
  { id: 'capturar', nome: 'Capturar', ajuda: 'guardar e descartar capturas' },
  { id: 'avancos', nome: 'Avanços', ajuda: 'criar, ligar, concluir e escolher avanços' },
  {
    id: 'propor',
    nome: 'Propor escolhas',
    ajuda: 'propor Propósito, Responsabilidades, Resultados e Estratégias (você confirma)',
  },
  { id: 'desfazer', nome: 'Desfazer', ajuda: 'desfazer o que o próprio agente fez' },
]

const quando = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'))
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function ActivityPage() {
  const [eventos, setEventos] = useState<AuditRow[]>([])
  const [propostas, setPropostas] = useState<ProposalRow[]>([])
  const [agentes, setAgentes] = useState<AgentRow[]>([])
  const [nome, setNome] = useState('')
  const [escopos, setEscopos] = useState<string[]>(['ler', 'capturar', 'avancos', 'propor'])
  const [tokenNovo, setTokenNovo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const [ev, pr, ag] = await Promise.all([
      pb.collection('audit_events').getList<AuditRow>(1, 50, { sort: '-created' }),
      pb
        .collection('proposals')
        .getFullList<ProposalRow>({ filter: "status = 'pendente'", sort: '-created' }),
      pb.collection('agents').getFullList<AgentRow>({ sort: '-created' }),
    ])
    setEventos(ev.items)
    setPropostas(pr)
    setAgentes(ag)
  }, [])

  useEffect(() => {
    carregar().catch((e: Error) => toast.error(e.message))
    const h = () => carregar().catch(() => {})
    window.addEventListener('pegada:mudou', h)
    return () => window.removeEventListener('pegada:mudou', h)
  }, [carregar])

  const nomeDoAgente = (id: string) => agentes.find((a) => a.id === id)?.name || 'Agente'
  const quem = (e: AuditRow) =>
    e.actor_type === 'pessoa'
      ? e.agent_id
        ? `Você (proposta de ${nomeDoAgente(e.agent_id)})`
        : 'Você'
      : e.actor_type === 'ia_embutida'
        ? 'Você, com sugestão da IA'
        : nomeDoAgente(e.agent_id)

  const agir = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true)
    try {
      await fn()
      toast.success(ok)
      await carregar()
      window.dispatchEvent(new Event('pegada:mudou'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const novoAgente = async () => {
    if (!nome.trim()) return
    setOcupado(true)
    try {
      const r = await criarAgente(nome.trim(), escopos)
      setTokenNovo(r.token)
      setNome('')
      await carregar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Atividade</h1>
        <p className="text-muted-foreground">
          Tudo o que foi feito no seu método, por você, pela IA ou por agentes. Quase tudo se
          desfaz.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Decisões para você</h2>
        {propostas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma proposta esperando.</p>
        ) : (
          propostas.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {nomeDoAgente(p.agent_id)} propõe · {quando(p.created)}
              </p>
              <p className="mt-1 font-medium">{p.summary}</p>
              {p.reason && (
                <p className="mt-1 text-sm text-muted-foreground">Por quê: {p.reason}</p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={ocupado}
                  onClick={() => agir(() => decidirProposta(p.id, true), 'Confirmado')}
                >
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ocupado}
                  onClick={() => agir(() => decidirProposta(p.id, false), 'Recusado')}
                >
                  Recusar
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">O que foi feito</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {eventos.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">Nada ainda.</li>
          )}
          {eventos.map((e) => {
            const desfeito = !!e.undone_at
            return (
              <li key={e.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p
                    className={desfeito ? 'text-sm text-muted-foreground line-through' : 'text-sm'}
                  >
                    {e.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {quem(e)} · {quando(e.created)}
                  </p>
                </div>
                {!desfeito && e.op !== 'desfazer' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => agir(() => desfazer(e.id), 'Desfeito')}
                  >
                    Desfazer
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Agentes</h2>
        <p className="text-sm text-muted-foreground">
          Um agente de IA (Claude, ChatGPT ou outro) pode operar o seu método pelo conector MCP.
          Cada um tem acesso próprio, que você revoga quando quiser. Escolhas de Propósito,
          Responsabilidades, Resultados e Estratégias feitas por agentes sempre esperam a sua
          confirmação.
        </p>

        {tokenNovo && (
          <div className="space-y-2 rounded-xl border border-primary/40 bg-accent p-4 text-sm">
            <p className="font-medium">Guarde agora: este token não aparece de novo.</p>
            <code className="block break-all rounded bg-card p-2">{tokenNovo}</code>
            <p>Endereço do conector MCP:</p>
            <code className="block break-all rounded bg-card p-2">{mcpUrl()}</code>
            <p className="text-muted-foreground">
              Use o header Authorization: Bearer {'{token}'}. Para conectores que só aceitam um
              endereço, use {mcpUrl()}/{'{token}'}.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setTokenNovo(null)}>
              Já guardei
            </Button>
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <Label htmlFor="agente-nome">Novo agente</Label>
          <Input
            id="agente-nome"
            value={nome}
            placeholder="Ex.: Claude no celular"
            onChange={(e) => setNome(e.target.value)}
          />
          <div className="space-y-2">
            {ESCOPOS.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={escopos.includes(s.id)}
                  onCheckedChange={(v) =>
                    setEscopos((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))
                  }
                />
                <span>
                  <span className="font-medium">{s.nome}</span>{' '}
                  <span className="text-muted-foreground">— {s.ajuda}</span>
                </span>
              </label>
            ))}
          </div>
          <Button disabled={ocupado || !nome.trim() || escopos.length === 0} onClick={novoAgente}>
            Criar agente
          </Button>
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {agentes.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">Nenhum agente ainda.</li>
          )}
          {agentes.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p
                  className={
                    a.status === 'revogado'
                      ? 'text-sm text-muted-foreground line-through'
                      : 'text-sm font-medium'
                  }
                >
                  {a.name}{' '}
                  <span className="font-normal text-muted-foreground">({a.token_prefix}…)</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {(a.scopes || []).join(', ')}
                  {a.last_used_at ? ` · último uso ${quando(a.last_used_at)}` : ''}
                </p>
              </div>
              {a.status === 'ativo' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ocupado}
                  onClick={() => agir(() => revogarAgente(a.id), 'Agente revogado')}
                >
                  Revogar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
