import React, { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Acesso, Convite, Pessoa, Uso, conta, mensagemDe, navegadorCurto, nomeDoAcesso, quandoCurto } from '@/lib/pegada/conta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const SITUACAO: Record<Convite['situacao'], string> = {
  pendente: 'Esperando a pessoa',
  aceito: 'Aceito',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
}

/**
 * Pessoas (/pessoas): só para quem administra. Convida, acompanha as contas e
 * vê o registro de acesso. Nada aqui mostra conteúdo do método de ninguém.
 */
export const PessoasPage: React.FC = () => {
  const { user } = useAuth()
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [convites, setConvites] = useState<Convite[]>([])
  const [acessos, setAcessos] = useState<Acesso[]>([])
  const [uso, setUso] = useState<Uso[]>([])
  const [temEmail, setTemEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [convidando, setConvidando] = useState(false)
  const [link, setLink] = useState<{ email: string; url: string; enviado: boolean } | null>(null)
  const ehAdmin = user?.role === 'admin'

  const carregar = useCallback(async () => {
    try {
      const [p, c, a, u] = await Promise.all([conta.pessoas(), conta.convites(), conta.acessosDeTodos(), conta.uso()])
      setUso(u.uso)
      setPessoas(p.pessoas)
      setConvites(c.convites)
      setTemEmail(c.email)
      setAcessos(a.acessos)
    } catch (err) {
      toast.error(mensagemDe(err))
    }
  }, [])

  useEffect(() => {
    if (ehAdmin) void carregar()
  }, [ehAdmin, carregar])

  if (!ehAdmin) return <Navigate to="/" replace />

  const convidar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setConvidando(true)
    try {
      const r = await conta.convidar(email.trim())
      setLink({ email: r.convite.email, url: r.link, enviado: r.email_enviado })
      setEmail('')
      void carregar()
    } catch (err) {
      toast.error(mensagemDe(err))
    } finally {
      setConvidando(false)
    }
  }

  const copiar = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não consegui copiar. Selecione o link e copie à mão.')
    }
  }

  const agir = async (acao: () => Promise<unknown>, certo: string) => {
    try {
      await acao()
      toast.success(certo)
      void carregar()
    } catch (err) {
      toast.error(mensagemDe(err))
    }
  }

  const pendentes = convites.filter((c) => c.situacao === 'pendente')
  const outros = convites.filter((c) => c.situacao !== 'pendente').slice(0, 10)

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary ring-1 ring-primary/20"
        >
          <Users className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pessoas</h1>
          <p className="text-sm text-muted-foreground">Quem usa o Pegada. Conta nova só por convite seu.</p>
        </div>
      </header>

      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">Convidar</CardTitle>
          <CardDescription>
            {temEmail
              ? 'A pessoa recebe um link por e-mail, válido por 7 dias, e cria a própria senha.'
              : 'O servidor ainda não envia e-mails: copie o link e mande você mesmo. Ele vale por 7 dias.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={convidar} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 basis-56 space-y-2">
              <Label htmlFor="convidar-email">E-mail da pessoa</Label>
              <Input
                id="convidar-email"
                type="email"
                required
                className="min-h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="min-h-11" disabled={convidando}>
              {convidando ? 'Criando...' : 'Criar convite'}
            </Button>
          </form>
          {link && (
            <div className="space-y-2 rounded-lg border border-border bg-accent p-4" role="status">
              <p className="text-sm text-foreground">
                Convite criado para {link.email}.{' '}
                {link.enviado ? 'O e-mail já saiu.' : 'Copie o link agora: ele não aparece de novo.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly value={link.url} aria-label="Link do convite" className="min-h-11 flex-1 basis-56" onFocus={(e) => e.target.select()} />
                <Button type="button" variant="outline" className="min-h-11" onClick={copiar}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  Copiar
                </Button>
              </div>
            </div>
          )}
          {pendentes.length > 0 && (
            <ul className="divide-y divide-border" aria-label="Convites pendentes">
              {pendentes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="break-all text-sm text-foreground">{c.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {SITUACAO[c.situacao]} · vence em {quandoCurto(c.vence_em)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => agir(() => conta.cancelarConvite(c.id), 'Convite cancelado.')}
                  >
                    Cancelar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {outros.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground">
                Convites anteriores
              </summary>
              <ul className="divide-y divide-border">
                {outros.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-3 py-2 text-sm">
                    <span className="break-all text-foreground">{c.email}</span>
                    <span className="text-muted-foreground">{SITUACAO[c.situacao]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">Contas</CardTitle>
          <CardDescription>
            Uma conta desativada não entra, e os dados dela ficam guardados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label="Contas">
            {pessoas.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {p.nome || 'Sem nome'}
                    {p.administra && <span className="ml-2 text-xs font-normal text-muted-foreground">administra</span>}
                    {p.desativada && <span className="ml-2 text-xs font-normal text-destructive">desativada</span>}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {p.email} · {p.ultimo_acesso ? 'último acesso em ' + quandoCurto(p.ultimo_acesso) : 'ainda não entrou'}
                  </p>
                </div>
                {p.id !== user?.id &&
                  (p.desativada ? (
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => agir(() => conta.reativar(p.id), 'Conta reativada.')}>
                      Reativar
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" className="min-h-11" onClick={() => agir(() => conta.desativar(p.id), 'Conta desativada.')}>
                      Desativar
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">Uso</CardTitle>
          <CardDescription>
            Contagens dos últimos 28 dias, tiradas do histórico. O conteúdo de ninguém é lido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label="Uso por pessoa">
            {uso.map((u) => (
              <li key={u.id} className="space-y-1 py-3">
                <p className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                  <span className="font-medium text-foreground">{u.nome}</span>
                  <span className="text-muted-foreground">
                    {u.dias_com_uso_7} de 7 dias · {u.dias_com_uso_28} de 28 dias
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {u.operacoes_28 === 0
                    ? 'Sem uso no período.'
                    : [
                        `${u.operacoes_28} ${u.operacoes_28 === 1 ? 'operação' : 'operações'}`,
                        u.com_ia_28 ? `${u.com_ia_28} com sugestão da IA` : '',
                        u.por_agentes_28 ? `${u.por_agentes_28} por agentes` : '',
                        u.mais_usadas.length
                          ? 'mais usadas: ' + u.mais_usadas.map((m) => `${m.operacao.replace(/_/g, ' ')} (${m.vezes})`).join(', ')
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">Registro de acesso</CardTitle>
          <CardDescription>Os 200 eventos mais recentes de todas as contas.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border" aria-label="Registro de acesso">
            {acessos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="text-sm text-foreground">
                  {nomeDoAcesso(a.o_que)}
                  {a.quem ? ` · ${a.quem}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[quandoCurto(a.quando), navegadorCurto(a.navegador), a.ip].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
