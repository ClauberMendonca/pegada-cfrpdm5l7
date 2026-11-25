// PEGADA — propostas de agentes que esperam a decisão do dono.
// Moram na Caixa, junto das capturas: tudo o que entrou e pede uma decisão
// fica num lugar só. Sem propostas, a seção não aparece.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { decidirProposta } from '@/lib/pegada/api'

interface Proposta {
  id: string
  agent_id: string
  summary: string
  reason: string
  created: string
}

const quando = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'))
  return isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function PropostasParaDecidir() {
  const [propostas, setPropostas] = useState<Proposta[]>([])
  const [agentes, setAgentes] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const [pr, ag] = await Promise.all([
      pb.collection('proposals').getFullList<Proposta>({ filter: "status = 'pendente'", sort: '-created' }),
      pb.collection('agents').getFullList<{ id: string; name: string }>(),
    ])
    setPropostas(pr)
    setAgentes(Object.fromEntries(ag.map((a) => [a.id, a.name])))
  }, [])

  useEffect(() => {
    const ler = () => carregar().catch(() => setPropostas([]))
    ler()
    window.addEventListener('pegada:mudou', ler)
    return () => window.removeEventListener('pegada:mudou', ler)
  }, [carregar])

  const decidir = async (id: string, aceita: boolean) => {
    setOcupado(true)
    try {
      await decidirProposta(id, aceita)
      toast.success(aceita ? 'Confirmado' : 'Recusado')
      await carregar()
      window.dispatchEvent(new Event('pegada:mudou'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  if (propostas.length === 0) return null

  return (
    <section aria-label="Propostas de agentes" className="space-y-3" data-propostas>
      <h2 className="text-[17px] font-semibold text-foreground">
        Propostas de agentes <span className="font-normal text-muted-foreground">({propostas.length})</span>
      </h2>
      {propostas.map((p) => (
        <div key={p.id} className="rounded-[20px] border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {agentes[p.agent_id] || 'Agente'} propõe · {quando(p.created)}
          </p>
          <p className="mt-1 text-base font-medium text-foreground">{p.summary}</p>
          {p.reason && <p className="mt-1 text-sm text-muted-foreground">Por quê: {p.reason}</p>}
          <div className="mt-3 flex gap-2">
            <Button disabled={ocupado} onClick={() => decidir(p.id, true)} className="min-h-11">
              Confirmar
            </Button>
            <Button variant="ghost" disabled={ocupado} onClick={() => decidir(p.id, false)} className="min-h-11">
              Recusar
            </Button>
          </div>
        </div>
      ))}
    </section>
  )
}

export default PropostasParaDecidir
