import pb from '@/lib/pocketbase/client'
import { CaptureItem, CaptureStatus, Project, ActionItem } from '@/types/execution'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { ClientResponseError } from 'pocketbase'

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

  async create(raw_text: string): Promise<CaptureItem> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    return pb.collection('captures').create<CaptureItem>({
      user_id: userId,
      raw_text,
      status: 'pendente',
    })
  },

  async updateText(id: string, raw_text: string): Promise<CaptureItem> {
    return pb.collection('captures').update<CaptureItem>(id, { raw_text })
  },

  async discard(id: string): Promise<CaptureItem> {
    // Arquivamento/descarte lógico sem exclusão definitiva
    return pb.collection('captures').update<CaptureItem>(id, {
      status: 'descartada',
    })
  },

  /**
   * Converte uma captura em Projeto ou Ação através da rota nativa autenticada
   * do PocketBase (hook capture-convert.pb.js), que executa TUDO dentro de uma
   * única transação: valida sessão/dono/estado, cria o destino, vincula a
   * captura e responde com o destino real — inclusive quando a captura já
   * estava convertida (idempotente: retry/concorrência não cria segundo
   * destino; a resposta marca `duplicate: true`).
   *
   * Texto original (raw_text) nunca é alterado pela conversão.
   *
   * FATIA 4C1 — strategy_id é OPCIONAL no transporte e vai SEMPRE explícito
   * (o hook nunca infere vínculo por pai/título/Responsabilidade): omitido ou
   * string exatamente vazia = nenhum vínculo; informado, é validado na
   * transação do hook (existe/dono/mesmo Resultado/ativa — só Avanço COM
   * Resultado). A resposta traz strategy_id do registro PERSISTIDO (inclusive
   * no caminho idempotente), nunca a escolha da repetição. Nenhum cliente
   * antigo precisa enviar o campo. Não enviar '' como default oculto.
   */
  async convert(
    captureId: string,
    target: 'project' | 'action',
    data: {
      title: string
      context: 'vida' | 'trabalho'
      project_id?: string
      responsibility_id?: string
      strategy_id?: string
      aspiration?: string
      controllable_delivery?: string
      completion_condition?: string
    },
  ): Promise<ConvertResult> {
    const authId = pb.authStore.model?.id
    if (!authId) throw new Error('Usuário não autenticado')

    try {
      const result = await pb.send<ConvertResult>(`backend/v1/pc/captures/${captureId}/convert`, {
        method: 'POST',
        body: { target, data },
      })
      return result
    } catch (err: unknown) {
      // Mensagem legível para falhas da rota nativa (400/401/403/404/409).
      if (err instanceof ClientResponseError) {
        const msg =
          (err.response as { message?: string } | undefined)?.message || getErrorMessage(err)
        throw new Error(msg || `Falha na conversão (HTTP ${err.status}).`)
      }
      throw err
    }
  },
}
