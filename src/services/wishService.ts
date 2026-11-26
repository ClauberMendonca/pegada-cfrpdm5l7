// PEGADA — Vontades: leitura direta do dono e escrita só pela API do método.
import pb from '@/lib/pocketbase/client'
import { op } from '@/lib/pegada/api'
import type { Wish } from '@/types/execution'
import { notificarMudanca } from '@/services/actionService'

export const wishService = {
  async list(): Promise<Wish[]> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')
    return pb.collection('wishes').getFullList<Wish>({ filter: `user_id = "${userId}"`, sort: 'title' })
  },
  async getById(id: string): Promise<Wish> {
    return pb.collection('wishes').getOne<Wish>(id)
  },
  async update(id: string, dados: { titulo?: string; descricao?: string }): Promise<void> {
    await op('editar_vontade', { vontade_id: id, ...dados })
  },
  async setStatus(id: string, status: Wish['status']): Promise<void> {
    await op(
      'arquivar_vontade',
      { vontade_id: id, reativar: status === 'ativa' },
      { desfazer: true, onDesfeito: notificarMudanca },
    )
  },
}
