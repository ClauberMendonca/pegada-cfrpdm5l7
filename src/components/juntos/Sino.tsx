// PEGADA — o sino: convites para resultados e avisos discretos (avanço que
// passaram para você, devolvido, concluído; resultado encerrado).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Foto } from '@/components/juntos/Foto'
import { EscolherPorque, porqueDe } from '@/components/juntos/EscolherPorque'
import { juntos, type Aviso, type Convite } from '@/lib/pegada/juntos'
import { fichaDoAvanco, fichaDoResultado } from '@/lib/pegada/enderecos'
import { notificarMudanca } from '@/services/actionService'
import { cn } from '@/lib/utils'

const quando = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function Sino({ comTexto }: { comTexto?: boolean }) {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [convites, setConvites] = useState<Convite[]>([])
  const [novos, setNovos] = useState(0)
  const [porque, setPorque] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const r = await juntos.avisos()
      setAvisos(r.avisos)
      setConvites(r.convites)
      setNovos(r.novos)
    } catch {
      // Sem avisos, o sino fica quieto.
    }
  }, [])

  // Confere ao abrir o app, quando a pessoa volta para a aba e de tempos em tempos.
  useEffect(() => {
    void carregar()
    const t = window.setInterval(() => void carregar(), 120000)
    const voltou = () => document.visibilityState === 'visible' && void carregar()
    document.addEventListener('visibilitychange', voltou)
    window.addEventListener('pegada:avisos', carregar)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', voltou)
      window.removeEventListener('pegada:avisos', carregar)
    }
  }, [carregar])

  // Abriu, viu: o contador zera, e os pontinhos seguem até o sino fechar.
  const abrir = (sim: boolean) => {
    setAberto(sim)
    if (sim)
      void carregar().then(() => {
        setNovos(0)
        juntos.marcarLidos().catch(() => {})
      })
    else void carregar()
  }

  const responder = async (c: Convite, aceitar: boolean) => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await juntos.responder(c.id, aceitar, aceitar ? porqueDe(porque[c.id] ?? '') : {})
      await carregar()
      notificarMudanca()
      if (r.aceito && r.resultado_id) {
        toast.success('Você entrou no resultado.')
        setAberto(false)
        navigate(fichaDoResultado(r.resultado_id))
      } else toast.message('Convite recusado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const ir = (a: Aviso) => {
    setAberto(false)
    if (a.avanco_id && a.tipo !== 'avanco_retomado') navigate(fichaDoAvanco(a.avanco_id))
    else if (a.resultado_id && a.tipo !== 'removido') navigate(fichaDoResultado(a.resultado_id))
  }

  // Convite sem resposta conta até ser respondido; o resto, até ser visto.
  const total =
    convites.length +
    (novos > 0 ? avisos.filter((a) => !a.lido && !convites.some((c) => c.id === a.convite_id)).length : 0)
  const soConvite = (a: Aviso) => a.tipo === 'convite' && convites.some((c) => c.id === a.convite_id)
  const lista = avisos.filter((a) => !soConvite(a))

  return (
    <>
      <button
        type="button"
        onClick={() => abrir(true)}
        data-sino
        aria-label={total > 0 ? `Avisos: ${total} ${total === 1 ? 'novo' : 'novos'}` : 'Avisos'}
        className={cn(
          'relative flex h-11 shrink-0 items-center justify-center gap-2 rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          comTexto ? 'px-3 text-sm font-medium' : 'w-11',
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {comTexto && 'Avisos'}
        {total > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground',
              !comTexto && 'absolute right-0.5 top-0.5',
            )}
          >
            {total}
          </span>
        )}
      </button>

      <Dialog open={aberto} onOpenChange={abrir}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Avisos</DialogTitle>
            <DialogDescription>O que outras pessoas fizeram nos resultados que vocês buscam juntos.</DialogDescription>
          </DialogHeader>

          {convites.map((c) => (
            <div key={c.id} data-convite={c.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <Foto pessoa={c.de} />
                <p className="min-w-0 flex-1 text-base text-foreground">
                  <span className="font-medium">{c.de.nome}</span> convidou você para buscar junto o resultado{' '}
                  <span className="font-medium">“{c.resultado?.titulo}”</span>
                  {c.resultado?.prazo && `, até ${c.resultado.prazo.split('-').reverse().join('/')}`}.
                </p>
              </div>
              {c.resultado?.como_sei && (
                <p className="text-sm text-muted-foreground">Como saber que chegou: {c.resultado.como_sei}</p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`porque-${c.id}`} className="text-sm font-medium text-foreground">
                  Onde isso se encaixa na sua vida?
                </label>
                <EscolherPorque
                  id={`porque-${c.id}`}
                  valor={porque[c.id] ?? ''}
                  onMudar={(v) => setPorque((p) => ({ ...p, [c.id]: v }))}
                />
                <p className="text-[13px] text-muted-foreground">
                  É o seu porquê. Só você vê, e dá para escolher depois.
                </p>
              </div>
              <div className="flex gap-2">
                <Button disabled={ocupado} className="h-11 flex-1 rounded-full" onClick={() => void responder(c, true)}>
                  Entrar
                </Button>
                <Button
                  variant="outline"
                  disabled={ocupado}
                  className="h-11 flex-1 rounded-full"
                  onClick={() => void responder(c, false)}
                >
                  Agora não
                </Button>
              </div>
            </div>
          ))}

          {lista.length === 0 && convites.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nada por aqui. Quando alguém convidar você ou passar um avanço, aparece neste lugar.
            </p>
          )}
          <ul className="flex flex-col">
            {lista.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => ir(a)}
                  className="flex min-h-12 w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', a.lido ? 'bg-transparent' : 'bg-primary')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block break-words text-[15px] text-foreground', !a.lido && 'font-medium')}>
                      {a.texto}
                    </span>
                    <span className="text-[13px] text-muted-foreground">{quando(a.quando)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default Sino
