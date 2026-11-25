// PEGADA — a ficha de uma responsabilidade, no endereço /mapa/responsabilidade/:id.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ResponsibilityDetail } from '@/components/ResponsibilityDetail'
import { ResponsibilityModal } from '@/components/ResponsibilityModal'
import { FichaNaoEncontrada } from '@/components/Ficha'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { notificarMudanca } from '@/services/actionService'
import { responsibilityService } from '@/services/responsibilityService'
import type { Responsibility } from '@/types/execution'

export function FichaResponsabilidadePage() {
  const { id } = useParams()
  const { contextFilter } = useGlobalFilter()
  const [item, setItem] = useState<Responsibility | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'nao-achou'>('carregando')
  const [editando, setEditando] = useState(false)

  const carregar = useCallback(async () => {
    if (!id) return
    try {
      const r = await responsibilityService.getById(id)
      setItem(r)
      setEstado('pronto')
    } catch {
      setEstado((e) => (e === 'pronto' ? e : 'nao-achou'))
    }
  }, [id])

  useEffect(() => {
    setItem(null)
    setEstado('carregando')
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  if (!id || estado === 'nao-achou') return <FichaNaoEncontrada oQue="esta responsabilidade" />
  if (!item || item.id !== id) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando a ficha" />
      </div>
    )
  }

  return (
    <>
      <ResponsibilityDetail
        key={item.id}
        responsibility={item}
        globalContext={contextFilter}
        onEdit={() => setEditando(true)}
        onChanged={() => {
          void carregar()
          notificarMudanca()
        }}
      />
      <ResponsibilityModal
        open={editando}
        responsibility={item}
        globalContext={contextFilter}
        onOpenChange={setEditando}
        onSaved={(salva) => {
          setItem(salva)
          notificarMudanca()
        }}
      />
    </>
  )
}

export default FichaResponsabilidadePage
