// PEGADA — na ficha de um avanço de resultado compartilhado: com quem ele
// está, passar para outra pessoa, devolver ou pegar de volta.
import { useState } from 'react'
import { CornerUpLeft, Forward, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Foto } from '@/components/juntos/Foto'
import { juntos, primeiroNome, type AvancoJunto } from '@/lib/pegada/juntos'

interface Props {
  dados: AvancoJunto
  /** Depois de passar, devolver ou pegar de volta. */
  onMudou: () => void
}

export function ComQuemEsta({ dados, onMudou }: Props) {
  const [passando, setPassando] = useState(false)
  const [devolvendo, setDevolvendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  if (!dados.compartilhado) return null

  const fazer = async (escrita: () => Promise<unknown>, feito: string) => {
    if (ocupado) return
    setOcupado(true)
    try {
      await escrita()
      toast.success(feito)
      setPassando(false)
      setDevolvendo(false)
      setMotivo('')
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }
  const eu = dados.pessoas.find((p) => p.eu)
  const outras = dados.pessoas.filter((p) => p.id !== dados.responsavel.id && !p.eu)
  const BOTAO = 'h-11 gap-1.5 rounded-full'

  return (
    <div
      data-com-quem-esta
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <Foto pessoa={dados.responsavel} />
      <p className="min-w-0 flex-1 text-sm text-foreground">
        {dados.meu ? (
          dados.passado_por ? (
            <>
              <span className="font-medium">{primeiroNome(dados.passado_por.nome)}</span> passou este avanço para você.
            </>
          ) : (
            'Este avanço está com você.'
          )
        ) : (
          <>
            Este avanço está com <span className="font-medium">{dados.responsavel.nome}</span>. Você acompanha;
            quem conclui é essa pessoa.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {dados.pode_devolver && (
          <Button variant="outline" className={BOTAO} disabled={ocupado} onClick={() => setDevolvendo(true)}>
            <CornerUpLeft className="h-4 w-4" aria-hidden="true" />
            Devolver
          </Button>
        )}
        {dados.pode_passar && !dados.meu && eu && (
          <Button
            variant="outline"
            className={BOTAO}
            disabled={ocupado}
            onClick={() => void fazer(() => juntos.passar(dados.id, eu.id), 'O avanço voltou para você.')}
          >
            <CornerUpLeft className="h-4 w-4" aria-hidden="true" />
            Pegar de volta
          </Button>
        )}
        {dados.pode_passar && (dados.meu ? dados.pessoas.length > 1 : outras.length > 0) && (
          <Button variant="outline" className={BOTAO} disabled={ocupado} onClick={() => setPassando(true)}>
            <Forward className="h-4 w-4" aria-hidden="true" />
            Passar para…
          </Button>
        )}
      </div>

      <Dialog open={passando} onOpenChange={setPassando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Passar este avanço para quem?</DialogTitle>
            <DialogDescription>
              Ele entra direto na lista da pessoa, que é avisada e pode devolver. Você continua vendo o
              andamento, e ele aparece nas suas esperas na revisão.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1">
            {dados.pessoas
              .filter((p) => p.id !== dados.responsavel.id && !p.eu)
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      void fazer(
                        () => juntos.passar(dados.id, p.id),
                        `Avanço passado para ${primeiroNome(p.nome)}.`,
                      )
                    }
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-base font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Foto pessoa={p} />
                    <span className="flex-1">{p.nome}</span>
                    {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  </button>
                </li>
              ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={devolvendo} onOpenChange={setDevolvendo}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Devolver este avanço</DialogTitle>
            <DialogDescription>
              Devolver é melhor do que deixar parado. Ele volta para{' '}
              {dados.passado_por ? primeiroNome(dados.passado_por.nome) : 'quem passou'}, com o seu recado.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            maxLength={300}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Um recado curto (opcional)"
            aria-label="Recado para quem passou"
            className="min-h-24 text-base"
          />
          <Button
            disabled={ocupado}
            className="h-11 rounded-full"
            onClick={() => void fazer(() => juntos.devolver(dados.id, motivo.trim()), 'Avanço devolvido.')}
          >
            Devolver
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ComQuemEsta
