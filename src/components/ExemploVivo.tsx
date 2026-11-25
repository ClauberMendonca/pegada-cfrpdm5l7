// PEGADA — Começar por um exemplo vivo: no primeiro uso, a pessoa vê um fio
// completo já preenchido e o edita, em vez de encarar uma tela vazia.
// Nada é gravado antes do toque em "Criar o meu primeiro fio".
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
  const [f, setF] = useState({
    proposito: 'Eu existo para simplificar a vida de quem empreende, para que mais pessoas realizem o que escolheram.',
    responsabilidade: 'Cuidar da saúde do meu negócio',
    resultado: 'Empresa funcionando duas semanas sem mim',
    prazo: daquiATresMeses(),
    estrategia: 'Por meio de um gerente contratado e treinado',
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

  const criar = async () => {
    setOcupado(true)
    setErro(null)
    try {
      const id = (r: { resultado?: unknown }, k: string) => String((r.resultado as Record<string, string>)?.[k] || '')
      await op('definir_proposito', { texto: f.proposito.trim() })
      const resp = await op('criar_responsabilidade', { titulo: f.responsabilidade.trim(), contexto: 'trabalho' })
      const res = await op('criar_resultado', {
        titulo: f.resultado.trim(),
        prazo: f.prazo,
        responsabilidade_id: id(resp, 'responsabilidade_id'),
      })
      const est = await op('criar_estrategia', { resultado_id: id(res, 'resultado_id'), titulo: f.estrategia.trim() })
      await op('criar_avanco', {
        titulo: f.avanco.trim(),
        tipo: 'acao',
        resultado_id: id(res, 'resultado_id'),
        estrategia_id: id(est, 'estrategia_id'),
        para_hoje: true,
        principal: true,
      })
      dispensar()
      notificarMudanca()
      onCriado?.()
      // O propósito novo vive no perfil: recarrega para a tela inteira passar a mostrá-lo.
      window.location.reload()
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

  return (
    <section aria-label="Comece por um exemplo" className="space-y-4 rounded-[20px] border border-border bg-card p-5" data-exemplo-vivo>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Comece por um exemplo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Este é um fio completo. Troque as palavras pelas suas e crie o seu primeiro.
        </p>
      </div>
      <p className="rounded-2xl px-4 py-3 text-[15px] leading-relaxed" style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}>
        Faço isto: <strong>{f.avanco || '…'}</strong>, para alcançar: <strong>{f.resultado || '…'}</strong>, porque{' '}
        {f.proposito ? f.proposito.charAt(0).toLowerCase() + f.proposito.slice(1) : '…'}
      </p>
      {campo('proposito', 'Propósito', 'Para quê você vive e trabalha? “Eu existo para…”')}
      {campo('responsabilidade', 'Responsabilidade', 'Pelo que você responde hoje? “Cuidar de…”, “Zelar por…”')}
      {campo('resultado', 'Resultado', 'Onde quer chegar? Escreva como algo já pronto.')}
      {campo('prazo', 'Até quando?', 'No prazo, dá para responder “alcancei ou não?”.')}
      {campo('estrategia', 'Estratégia', 'Como vai chegar lá? Uma aposta: “Por meio de…”')}
      {campo('avanco', 'Avanço de hoje', 'O que te move agora? Comece por um verbo.')}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={ocupado || !f.proposito.trim() || !f.responsabilidade.trim() || !f.resultado.trim() || !f.prazo || !f.estrategia.trim() || !f.avanco.trim()}
          onClick={() => void criar()}
          className="h-[52px] gap-2 rounded-full px-6 text-[17px] font-semibold"
        >
          {ocupado && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          Criar o meu primeiro fio
        </Button>
        <Button type="button" variant="ghost" disabled={ocupado} onClick={dispensar} className="h-[52px] rounded-full">
          Começar do zero
        </Button>
      </div>
    </section>
  )
}

export default ExemploVivo
