// PEGADA — o primeiro uso, em três passos curtos, cada um pulável: uma frase
// de propósito, um resultado e um avanço para hoje. Cada passo já vem com um
// exemplo para editar. Nada é gravado antes do último toque, e a pessoa
// termina em Hoje com o primeiro avanço principal escolhido.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'

const DISPENSADO = 'pegada.exemplo.dispensado'
const CAMPO =
  'w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground'

function daquiATresMeses() {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

interface Mapa {
  proposito?: string
  responsabilidades: unknown[]
  resultados: unknown[]
}

export function ExemploVivo({ onCriado }: { onCriado?: () => void }) {
  const [mostrar, setMostrar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [passo, setPasso] = useState(0)
  const [pulou, setPulou] = useState({ proposito: false, resultado: false })
  const [f, setF] = useState({
    proposito: 'Eu existo para simplificar a vida de quem empreende, para que mais pessoas realizem o que escolheram.',
    resultado: 'Empresa funcionando duas semanas sem mim',
    prazo: daquiATresMeses(),
    avanco: 'Escrever a descrição da vaga de gerente',
  })

  useEffect(() => {
    try {
      if (localStorage.getItem(DISPENSADO)) return
    } catch {
      return
    }
    let vivo = true
    op<Mapa>('ver_mapa', {})
      .then((r) => {
        const m = r.resultado as Mapa | undefined
        if (vivo && m && !m.proposito && m.responsabilidades.length === 0 && m.resultados.length === 0) setMostrar(true)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  if (!mostrar) return null

  const dispensar = () => {
    try {
      localStorage.setItem(DISPENSADO, '1')
    } catch {
      // segue sem lembrar
    }
    setMostrar(false)
  }

  const criar = async (comAvanco: boolean) => {
    setOcupado(true)
    setErro(null)
    try {
      const id = (r: { resultado?: unknown }, k: string) => String((r.resultado as Record<string, string>)?.[k] || '')
      const temProposito = !pulou.proposito && Boolean(f.proposito.trim())
      if (temProposito) await op('definir_proposito', { texto: f.proposito.trim() })
      let resultadoId = ''
      if (!pulou.resultado && f.resultado.trim()) {
        const res = await op('criar_resultado', { titulo: f.resultado.trim(), prazo: f.prazo })
        resultadoId = id(res, 'resultado_id')
      }
      if (comAvanco && f.avanco.trim()) {
        await op('criar_avanco', {
          titulo: f.avanco.trim(),
          tipo: 'acao',
          ...(resultadoId ? { resultado_id: resultadoId } : {}),
          para_hoje: true,
          principal: true,
        })
      }
      dispensar()
      notificarMudanca()
      onCriado?.()
      // O propósito novo vive no perfil: recarrega para a tela inteira passar a mostrá-lo.
      if (temProposito) window.location.reload()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const campo = (k: keyof typeof f, rotulo: string, ajuda: string) => (
    <div className="space-y-1">
      <label htmlFor={`exemplo-${k}`} className="block text-sm font-semibold text-foreground">
        {rotulo}
      </label>
      <p className="text-[13px] text-muted-foreground">{ajuda}</p>
      <input
        id={`exemplo-${k}`}
        type={k === 'prazo' ? 'date' : 'text'}
        value={f[k]}
        onChange={(e) => setF((v) => ({ ...v, [k]: e.target.value }))}
        className={CAMPO}
      />
    </div>
  )

  const BOTAO = 'h-[52px] rounded-full px-6 text-[17px] font-semibold'
  const ultimo = passo === 2
  const podeSeguir =
    passo === 0 ? Boolean(f.proposito.trim()) : passo === 1 ? Boolean(f.resultado.trim() && f.prazo) : Boolean(f.avanco.trim())

  return (
    <section aria-label="Primeiros passos" className="space-y-4 rounded-[20px] border border-border bg-card p-5" data-exemplo-vivo>
      <div>
        <p className="text-[13px] text-muted-foreground" data-passo-do-comeco>
          Passo {passo + 1} de 3
        </p>
        <h2 className="mt-0.5 text-xl font-semibold text-foreground">
          {passo === 0 ? 'Para quê?' : passo === 1 ? 'Onde quer chegar?' : 'O que você faz hoje?'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">O campo já vem com um exemplo. Troque pelas suas palavras.</p>
      </div>
      {passo === 0 && campo('proposito', 'Propósito', 'Para quê você vive e trabalha? “Eu existo para…”')}
      {passo === 1 && (
        <>
          {campo('resultado', 'Resultado', 'Escreva como algo já pronto.')}
          {campo('prazo', 'Até quando?', 'No prazo, dá para responder “alcancei ou não?”.')}
        </>
      )}
      {passo === 2 && (
        <>
          {campo('avanco', 'Avanço de hoje', 'O que te move agora? Comece por um verbo.')}
          <p className="rounded-2xl px-4 py-3 text-[15px] leading-relaxed" style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}>
            Faço isto: <strong>{f.avanco || '…'}</strong>
            {!pulou.resultado && (
              <>
                , para alcançar: <strong>{f.resultado || '…'}</strong>
              </>
            )}
            {!pulou.proposito && f.proposito && <>, porque {f.proposito.charAt(0).toLowerCase() + f.proposito.slice(1)}</>}
          </p>
        </>
      )}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={ocupado || !podeSeguir}
          onClick={() => {
            if (ultimo) return void criar(true)
            setPulou((v) => (passo === 0 ? { ...v, proposito: false } : { ...v, resultado: false }))
            setPasso(passo + 1)
          }}
          className={`${BOTAO} gap-2`}
        >
          {ocupado && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {ultimo ? 'Começar o dia' : 'Continuar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={ocupado}
          onClick={() => {
            if (ultimo) return void (pulou.proposito && pulou.resultado ? dispensar() : criar(false))
            setPulou((v) => (passo === 0 ? { ...v, proposito: true } : { ...v, resultado: true }))
            setPasso(passo + 1)
          }}
          className="h-[52px] rounded-full"
        >
          Depois
        </Button>
        {passo > 0 && (
          <Button type="button" variant="ghost" disabled={ocupado} onClick={() => setPasso(passo - 1)} className="h-[52px] rounded-full">
            Voltar
          </Button>
        )}
      </div>
    </section>
  )
}

export default ExemploVivo
