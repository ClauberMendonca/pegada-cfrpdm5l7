// Marco 2: proposta pronta -> campos do formulário MANUAL. Apenas leituras locais.
import pb from '@/lib/pocketbase/client'
import type { CaptureItem } from '@/types/execution'
import type { AiProposal, AiRequestRecord } from './types'

export type ConversionProposal = AiProposal & {
  kind: 'acao' | 'projeto'
  title: string
  context: 'vida' | 'trabalho'
}

export function usableProposal(
  request: AiRequestRecord,
  capture: CaptureItem,
): ConversionProposal | null {
  const result = request.result
  const proposal = result?.proposal
  if (
    request.state !== 'pronta' ||
    request.origin_type !== 'captura' ||
    request.origin_id !== capture.id ||
    request.user_id !== capture.user_id ||
    capture.status !== 'pendente' ||
    request.origin_revision !== `${capture.raw_text}|${capture.updated}` ||
    !proposal ||
    (proposal.kind !== 'acao' && proposal.kind !== 'projeto') ||
    result?.kind !== proposal.kind ||
    typeof proposal.title !== 'string' ||
    !proposal.title.trim() ||
    (proposal.context !== 'vida' && proposal.context !== 'trabalho') ||
    proposal.context !== request.context
  )
    return null
  return { ...proposal, kind: proposal.kind, title: proposal.title, context: proposal.context }
}

export async function prepareProposalConversion(
  shown: AiRequestRecord,
  displayedCapture: CaptureItem,
): Promise<{
  capture: CaptureItem
  proposal: ConversionProposal
}> {
  const userId = pb.authStore.model?.id
  if (!userId || shown.user_id !== userId || displayedCapture.user_id !== userId) {
    throw new Error('A sessão mudou. Feche o painel e entre novamente.')
  }
  if (!usableProposal(shown, displayedCapture)) {
    throw new Error('Esta proposta não está pronta para a captura atual.')
  }
  const [capture, current] = await Promise.all([
    pb.collection('captures').getOne<CaptureItem>(displayedCapture.id, { requestKey: null }),
    pb.collection('ai_requests').getOne<AiRequestRecord>(shown.id, { requestKey: null }),
  ])
  if (
    pb.authStore.model?.id !== userId ||
    capture.user_id !== userId ||
    current.user_id !== userId ||
    current.id !== shown.id ||
    current.origin_id !== shown.origin_id ||
    current.context !== shown.context ||
    current.local_request_id !== shown.local_request_id ||
    current.remote_task_id !== shown.remote_task_id ||
    capture.id !== displayedCapture.id ||
    `${capture.raw_text}|${capture.updated}` !== shown.origin_revision ||
    current.origin_revision !== shown.origin_revision
  ) {
    throw new Error('A captura ou o pedido mudou. Atualize e revise antes de usar a proposta.')
  }
  const proposal = usableProposal(current, capture)
  if (!proposal || JSON.stringify(current.result) !== JSON.stringify(shown.result)) {
    throw new Error('A proposta mudou. Atualize o pedido para revisar a versão atual.')
  }
  // Não chama captureService.convert: abrir/preencher não aprova nem cria destino.
  return { capture, proposal }
}
