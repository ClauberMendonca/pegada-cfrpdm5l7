import { UserProfile } from '@/types/execution'

/**
 * FATIA 2A — Mapeamento compartilhado de UserRecord PocketBase → UserProfile.
 *
 * Único ponto que monta UserProfile: usado pela restauração da sessão,
 * authStore.onChange, leitura fresca, login, updateTimezone e
 * updateLifePurpose — inclusive para um ajuste de fuso (ou outra escrita de
 * perfil) não apagar o propósito em memória. Fonte canônica: backend.
 */
export type UserRecordLike = {
  id: string
  email?: string
  name?: string
  timezone?: string
  life_purpose?: string
  created?: string
  updated?: string
}

export function mapUserProfile(model: UserRecordLike | null | undefined): UserProfile | null {
  if (!model) return null
  return {
    id: model.id,
    email: model.email || '',
    name: model.name || '',
    timezone: model.timezone || '',
    life_purpose: model.life_purpose || '',
    created: model.created || '',
    updated: model.updated || '',
  }
}
