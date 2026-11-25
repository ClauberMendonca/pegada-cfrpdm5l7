// PEGADA — a ficha de uma vontade, no endereço /mapa/vontade/:id.
// Em cima, o propósito que ela realiza. No meio, a vontade, com Editar e
// Arquivar. Embaixo, os resultados que nascem dela.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Desdobrar } from '@/components/Desdobrar'
import { Ficha, FichaNaoEncontrada } from '@/components/Ficha'
import { Triade } from '@/components/Triade'
import { AdicionarNoLugar } from '@/components/mapa/AdicionarNoLugar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { op } from '@/lib/pegada/api'
import { fichaDoResultado } from '@/lib/pegada/enderecos'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import pb from '@/lib/pocketbase/client'
import { notificarMudanca } from '@/services/actionService'
import { wishService } from '@/services/wishService'
import type { Project, Wish } from '@/types/execution'

const SITUACAO: Record<string, string> = {
  rascunho: 'depois',
  futuro: 'depois',
  pausado: 'pausado',
  concluido: 'concluído',
  arquivado: 'arquivado',
  abandonado: 'abandonado',
}

export function FichaVontadePage() {
  const { id } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [vontade, setVontade] = useState<Wish | null>(null)
  const [resultados, setResultados] = useState<Project[]>([])
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'nao-achou'>('carregando')
  const [ocupado, setOcupado] = useState(false)
  const [editando, setEditando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!id) return
    try {
      const [v, rs] = await Promise.all([
        wishService.getById(id),
        pb.collection('projects').getFullList<Project>({
          filter: pb.filter('wish_id = {:id}', { id }),
          sort: 'created',
        }),
      ])
      setVontade(v)
      setResultados(rs)
      setEstado('pronto')
    } catch {
      setEstado((e) => (e === 'pronto' ? e : 'nao-achou'))
    }
  }, [id])

  useEffect(() => {
    setVontade(null)
    setEstado('carregando')
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  if (!id || estado === 'nao-achou') return <FichaNaoEncontrada oQue="esta vontade" />
  if (!vontade || vontade.id !== id) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando a ficha" />
      </div>
    )
  }

  const arquivada = vontade.status === 'arquivada'
  const mudou = () => {
    void carregar()
    notificarMudanca()
  }

  const mudarEstado = async (para: Wish['status']) => {
    if (ocupado) return
    setOcupado(true)
    try {
      await wishService.setStatus(vontade.id, para)
      mudou()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível mudar a vontade',
        description: e instanceof Error ? e.message : 'Tente de novo.',
      })
    } finally {
      setOcupado(false)
    }
  }

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!titulo.trim() || ocupado) return
    setOcupado(true)
    setErro('')
    try {
      await wishService.update(vontade.id, { titulo: titulo.trim(), descricao: descricao.trim() })
      setEditando(false)
      mudou()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <Ficha
        degraus={[{ rotulo: 'Mapa', to: '/mapa' }]}
        atual={vontade.title}
        paraQue={
          <Link to="/mapa/proposito" className="font-medium underline-offset-4 hover:underline">
            Realiza o seu propósito
          </Link>
        }
        como={
          <>
            {!arquivada && (
              <>
                <AdicionarNoLugar
                  tipos={['resultado']}
                  onde={{ vontadeId: vontade.id }}
                  contexto={vontade.context === 'vida' ? 'vida' : 'trabalho'}
                  em={vontade.title}
                  onCriado={() => void carregar()}
                />
                <Desdobrar
                  nivel="vontade"
                  texto={vontade.title}
                  rotulo="Desdobrar em resultados"
                  onCriar={async (s) => {
                    await op('criar_resultado', {
                      titulo: s.titulo,
                      prazo: /^\d{4}-\d{2}-\d{2}$/.test(s.prazo || '') ? s.prazo : '',
                      vontade_id: vontade.id,
                      situacao: 'futuro',
                    })
                  }}
                  onCriados={mudou}
                />
              </>
            )}
            {resultados.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Nenhum resultado nasce desta vontade ainda. Adicione o primeiro: algo pronto, com data.
              </p>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-2" data-resultados-da-vontade>
                {resultados.map((r) => (
                  <Link
                    key={r.id}
                    to={fichaDoResultado(r.id)}
                    className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="break-words text-base font-medium text-foreground">{r.title}</span>
                    <span className="text-[13px] text-muted-foreground">
                      Resultado{SITUACAO[r.status] ? ` · ${SITUACAO[r.status]}` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </>
        }
      >
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Vontade · {vontade.context === 'trabalho' ? 'Trabalho' : 'Vida'}
          {arquivada && ' · arquivada'}
        </p>
        <h1 className="mt-1.5 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {vontade.title}
        </h1>
        {vontade.description?.trim() ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-base text-foreground">
            {vontade.description}
          </p>
        ) : null}
        <Triade
          className="mt-4"
          elemento="vontade"
          id={vontade.id}
          titulo={vontade.title}
          onEditar={() => {
            setTitulo(vontade.title)
            setDescricao(vontade.description || '')
            setErro('')
            setEditando(true)
          }}
          arquivado={arquivada}
          onArquivar={() => void mudarEstado(arquivada ? 'ativa' : 'arquivada')}
          ocupado={ocupado}
          onExcluido={() => navigate('/mapa')}
        />
      </Ficha>

      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar vontade</DialogTitle>
            <DialogDescription>
              Uma vontade é algo que você quer e que ninguém cobra se você largar.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="vontade-titulo">O que você quer</Label>
              <Input
                id="vontade-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vontade-descricao">Por que isso importa (opcional)</Label>
              <Textarea
                id="vontade-descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={3}
              />
            </div>
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="min-h-11" disabled={ocupado || !titulo.trim()}>
                {ocupado ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default FichaVontadePage
