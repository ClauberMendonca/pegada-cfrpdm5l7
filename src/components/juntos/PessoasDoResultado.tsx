// PEGADA — quem busca este resultado junto. Quem criou convida pelo e-mail e
// tira pessoas; quem participa diz o seu porquê e pode sair.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Foto } from '@/components/juntos/Foto'
import { EscolherPorque, porqueDe } from '@/components/juntos/EscolherPorque'
import { juntos, primeiroNome, type Participantes, type Pessoa, type EventoDoResultado } from '@/lib/pegada/juntos'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { notificarMudanca } from '@/services/actionService'

interface Props {
  resultadoId: string
  encerrado?: boolean
  /** Avisa a ficha quando muda quem participa ou o porquê de quem vê. */
  onMudou?: (p: Participantes) => void
  /** Quem saiu ou foi tirado não tem mais o que ver aqui. */
  onSaiu?: () => void
}

const PAPEL = { criou: 'criou o resultado', participa: 'participa', convidado: 'convite sem resposta' }

export function PessoasDoResultado({ resultadoId, encerrado, onMudou, onSaiu }: Props) {
  const [dados, setDados] = useState<Participantes | null>(null)
  const [aberto, setAberto] = useState(false)
  const [email, setEmail] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [conhecidas, setConhecidas] = useState<Pessoa[]>([])
  const [porque, setPorque] = useState('')
  const [historico, setHistorico] = useState<EventoDoResultado[] | null>(null)

  const carregar = useCallback(async () => {
    try {
      const p = await juntos.participantes(resultadoId)
      setDados(p)
      setPorque(
        p.meu_porque?.vontade_id
          ? `v:${p.meu_porque.vontade_id}`
          : p.meu_porque?.responsabilidade_id
            ? `r:${p.meu_porque.responsabilidade_id}`
            : '',
      )
      onMudou?.(p)
    } catch {
      // Sem a lista, a ficha segue como sempre foi: um resultado só da pessoa.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultadoId])
  useEffect(() => {
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  useEffect(() => {
    if (!aberto || !dados) return
    if (dados.sou_dono) juntos.conhecidas().then(setConhecidas).catch(() => {})
    if (dados.pessoas.length > 1) juntos.historico(resultadoId).then(setHistorico).catch(() => {})
  }, [aberto, dados, resultadoId])

  if (!dados) return null
  const outras = dados.pessoas.filter((p) => !p.eu)
  const junto = dados.pessoas.length > 1
  const quemCriou = dados.pessoas.find((p) => p.papel === 'criou')

  const fazer = async (escrita: () => Promise<unknown>, feito?: string) => {
    if (ocupado) return
    setOcupado(true)
    try {
      await escrita()
      if (feito) toast.success(feito)
      await carregar()
      notificarMudanca()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const convidar = (quem: { email?: string; pessoa_id?: string }) =>
    fazer(async () => {
      const res = await juntos.convidar(resultadoId, quem)
      setEmail('')
      toast.success(`Convite enviado para ${primeiroNome(res.pessoa.nome)}. Aparece no sino dela.`)
    })

  const jaEsta = new Set(dados.pessoas.map((p) => p.id))
  const sugeridas = conhecidas.filter((p) => !jaEsta.has(p.id))

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        data-pessoas-do-resultado
        className="flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {junto ? (
          <>
            <span className="flex -space-x-2">
              {dados.pessoas.slice(0, 4).map((p) => (
                <Foto key={p.id} pessoa={p} className="h-7 w-7 border-2 border-card text-[10px]" />
              ))}
            </span>
            {dados.sou_dono
              ? `Com ${outras.length === 1 ? primeiroNome(outras[0].nome) : `${outras.length} pessoas`}`
              : `Resultado de ${primeiroNome(quemCriou?.nome ?? '')}`}
          </>
        ) : (
          <>
            <Users className="h-4 w-4" aria-hidden="true" />
            Compartilhar
          </>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{junto ? 'Quem busca este resultado' : 'Buscar este resultado com alguém'}</DialogTitle>
            <DialogDescription>
              Quem participa vê o resultado, as estratégias e os avanços dele, e pode criar e concluir avanços.
              O seu propósito, as suas vontades e responsabilidades continuam só seus.
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1">
            {dados.pessoas.map((p) => (
              <li key={p.id} className="flex min-h-12 items-center gap-3">
                <Foto pessoa={p} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-foreground">
                    {p.nome}
                    {p.eu && <span className="font-normal text-muted-foreground"> (você)</span>}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {PAPEL[p.papel]}
                    {p.papel !== 'convidado' &&
                      ` · ${p.avancos_abertos} ${p.avancos_abertos === 1 ? 'avanço aberto' : 'avanços abertos'}`}
                  </p>
                </div>
                {dados.sou_dono && p.papel !== 'criou' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ocupado}
                    aria-label={`${p.papel === 'convidado' ? 'Cancelar o convite de' : 'Tirar'} ${p.nome}`}
                    onClick={() => {
                      if (
                        p.papel === 'participa' &&
                        !window.confirm(
                          `Tirar ${p.nome} deste resultado? Os avanços que estão com essa pessoa voltam para você.`,
                        )
                      )
                        return
                      void fazer(() => juntos.tirar(resultadoId, p.id))
                    }}
                    className="h-11 gap-1 rounded-full text-muted-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    {p.papel === 'convidado' ? 'Cancelar' : 'Tirar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {dados.sou_dono && !encerrado && (
            <form
              className="flex flex-col gap-2 border-t border-border pt-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (email.trim()) void convidar({ email: email.trim() })
              }}
            >
              <label htmlFor="convidar-email" className="text-sm font-medium text-foreground">
                Convidar pelo e-mail
              </label>
              <div className="flex gap-2">
                <Input
                  id="convidar-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="e-mail de quem já usa o Pegada"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 flex-1 text-base"
                />
                <Button type="submit" disabled={ocupado || !email.trim()} className="h-11 gap-1.5 rounded-full">
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Convidar
                </Button>
              </div>
              {sugeridas.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Quem já trabalha com você:</span>
                  {sugeridas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={ocupado}
                      onClick={() => void convidar({ pessoa_id: p.id })}
                      className="flex min-h-9 items-center gap-1.5 rounded-full border border-input bg-card py-1 pl-1 pr-3 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Foto pessoa={p} className="h-7 w-7 text-[10px]" />
                      {primeiroNome(p.nome)}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[13px] text-muted-foreground">
                A pessoa precisa já ter conta. O convite aparece no sino dela e ela escolhe se entra.
              </p>
            </form>
          )}

          {!dados.sou_dono && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <label htmlFor="meu-porque" className="text-sm font-medium text-foreground">
                O meu porquê neste resultado
              </label>
              <EscolherPorque
                id="meu-porque"
                valor={porque}
                onMudar={(v) => {
                  setPorque(v)
                  void fazer(() => juntos.meuPorque(resultadoId, porqueDe(v)), 'Porquê guardado. Só você vê.')
                }}
              />
              <p className="text-[13px] text-muted-foreground">
                É onde este resultado se encaixa no seu mapa. Ninguém mais vê.
              </p>
              <Button
                variant="outline"
                disabled={ocupado}
                onClick={() => {
                  if (
                    !window.confirm(
                      'Sair deste resultado? Você deixa de ver tudo dele, e os avanços que estão com você voltam para quem criou.',
                    )
                  )
                    return
                  void fazer(async () => {
                    await juntos.sair(resultadoId)
                    setAberto(false)
                    onSaiu?.()
                  }, 'Você saiu do resultado.')
                }}
                className="mt-2 h-11 self-start rounded-full"
              >
                Sair deste resultado
              </Button>
            </div>
          )}

          {junto && historico && historico.length > 0 && (
            <details className="border-t border-border pt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-foreground">
                O que aconteceu por aqui
              </summary>
              <ul className="flex flex-col gap-2 pb-1">
                {historico.map((ev) => (
                  <li key={ev.id} className="text-sm text-foreground">
                    <span className="font-medium">{ev.meu ? 'Você' : primeiroNome(ev.pessoa)}</span>
                    <span className="text-muted-foreground">
                      {' · '}
                      {ev.quando.slice(8, 10)}/{ev.quando.slice(5, 7)}
                    </span>
                    <br />
                    <span className="break-words text-muted-foreground">{ev.resumo}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default PessoasDoResultado
