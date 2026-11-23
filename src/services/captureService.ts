import pb from '@/lib/pocketbase/client'
import { CaptureItem, CaptureStatus, Project, ActionItem, ActionKind } from '@/types/execution'
import { op, RegraError } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'

export interface CreateCaptureInput {
  raw_text: string
}

export interface ConvertResult {
  duplicate: boolean
  target_type: 'project' | 'action'
  target: Project | ActionItem
  capture: CaptureItem
}

export const captureService = {
  async list(statusFilter?: CaptureStatus): Promise<CaptureItem[]> {
    const filter = statusFilter ? `status = '${statusFilter}'` : ''
    return pb.collection('captures').getFullList<CaptureItem>({
      filter,
      sort: '-created',
    })
  },

  async getById(id: string): Promise<CaptureItem> {
    return pb.collection('captures').getOne<CaptureItem>(id)
  },

  // PEGADA — escrita pela API do método.
  async create(raw_text: string): Promise<CaptureItem> {
    const res = await op<{ captura_id: string }>('capturar', { texto: raw_text })
    return captureService.getById(res.resultado!.captura_id)
  },

  async updateText(id: string, raw_text: string): Promise<CaptureItem> {
    await op('editar_captura', { captura_id: id, texto: raw_text })
    return captureService.getById(id)
  },

  async discard(id: string): Promise<CaptureItem> {
    await op(
      'descartar_captura',
      { captura_id: id },
      { desfazer: true, onDesfeito: notificarMudanca },
    )
    return captureService.getById(id)
  },

  /**
   * Processa a captura em Resultado ou Avanço pela operação processar_captura
   * (uma transação: cria o destino e vincula a captura, com histórico e
   * desfazer). Se a captura já tinha sido processada, devolve o destino real
   * com duplicate: true, como a rota antiga fazia.
   */
  async convert(
    captureId: string,
    target: 'project' | 'action',
    data: {
      title: string
      context: 'vida' | 'trabalho'
      kind?: ActionKind
      project_id?: string
      responsibility_id?: string
      strategy_id?: string
      aspiration?: string
      controllable_delivery?: string
      completion_condition?: string
      deadline?: string
      planned_date?: string
      planned_time?: string
      planned_timezone?: string
    },
  ): Promise<ConvertResult> {
    const dados: Record<string, unknown> =
      target === 'project'
        ? {
            titulo: data.title,
            contexto: data.context,
            responsabilidade_id: data.responsibility_id || undefined,
            como_sei: data.completion_condition || undefined,
            prazo: data.deadline || undefined,
            situacao: data.deadline ? 'ativo' : 'rascunho',
            _legado: {
              aspiration: data.aspiration,
              controllable_delivery: data.controllable_delivery,
            },
          }
        : {
            titulo: data.title,
            tipo: data.kind || 'acao',
            contexto: data.context,
            resultado_id: data.project_id || undefined,
            estrategia_id: data.strategy_id || undefined,
            responsabilidade_id: data.project_id ? undefined : data.responsibility_id || undefined,
            data_planejada: data.planned_date || undefined,
            hora_planejada: data.planned_time || undefined,
          }
    let duplicate = false
    try {
      await op('processar_captura', {
        captura_id: captureId,
        destino: target === 'project' ? 'resultado' : 'avanco',
        dados,
      })
    } catch (err) {
      if (err instanceof RegraError && err.regra === 'CAPTURA_JA_PROCESSADA') duplicate = true
      else throw err
    }
    const capture = await captureService.getById(captureId)
    if (capture.status === 'convertida_projeto' && capture.converted_project_id) {
      const t = await pb.collection('projects').getOne<Project>(capture.converted_project_id)
      return { duplicate, target_type: 'project', target: t, capture }
    }
    if (capture.status === 'convertida_acao' && capture.converted_action_id) {
      const t = await pb.collection('actions').getOne<ActionItem>(capture.converted_action_id)
      return { duplicate, target_type: 'action', target: t, capture }
    }
    throw new Error('Esta captura já foi processada para outro destino.')
  },
}
