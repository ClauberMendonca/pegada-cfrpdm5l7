import pb from '@/lib/pocketbase/client'
import { CaptureItem, CaptureStatus } from '@/types/execution'
import { projectService } from './projectService'
import { actionService } from './actionService'

export interface CreateCaptureInput {
  raw_text: string
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

  async convertToProject(
    captureId: string,
    projectData: {
      title: string
      context: 'vida' | 'trabalho'
      aspiration?: string
      controllable_delivery?: string
      completion_condition?: string
    },
  ) {
    const project = await projectService.create({
      ...projectData,
      status: 'rascunho',
    })
    const capture = await pb.collection('captures').update<CaptureItem>(captureId, {
      status: 'convertida_projeto',
      converted_project_id: project.id,
    })
    return { project, capture }
  },

  async convertToAction(
    captureId: string,
    actionData: {
      title: string
      context: 'vida' | 'trabalho'
      project_id?: string
      is_next_step?: boolean
      is_today_selected?: boolean
      deadline?: string
    },
  ) {
    const action = await actionService.create({
      ...actionData,
      status: 'pronta',
    })
    const capture = await pb.collection('captures').update<CaptureItem>(captureId, {
      status: 'convertida_acao',
      converted_action_id: action.id,
    })
    return { action, capture }
  },
}
