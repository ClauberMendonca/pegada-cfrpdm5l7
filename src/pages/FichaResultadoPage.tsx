// PEGADA — a ficha de um resultado, no endereço /mapa/resultado/:id.
import { useParams } from 'react-router-dom'
import { ProjectDetail } from '@/components/ProjectDetail'
import { FichaNaoEncontrada } from '@/components/Ficha'
import { notificarMudanca } from '@/services/actionService'

export function FichaResultadoPage() {
  const { id } = useParams()
  if (!id) return <FichaNaoEncontrada oQue="este resultado" />
  // A chave garante uma ficha nova a cada item: nada de um resultado vaza para o outro.
  return <ProjectDetail key={id} projectId={id} onProjectUpdated={notificarMudanca} />
}

export default FichaResultadoPage
