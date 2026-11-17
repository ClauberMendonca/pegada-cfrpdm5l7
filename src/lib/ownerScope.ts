/**
 * Escopo do dono para leituras de destinos de captura (Entrega 2C).
 * Somente LEITURA, sempre escopada à sessão autenticada: nada é gravado,
 * nenhuma permissão é ampliada e o filtro visual global nunca vira regra de
 * autorização. Troca de sessão: o snapshot do dono é capturado ANTES de cada
 * leitura; o chamador compara antes de aplicar o resultado (retorno tardio de
 * outra identidade nunca vira mapa/feedback desta).
 */
import pb from '@/lib/pocketbase/client'

export interface OwnerSnapshot {
  ownerId: string | null
}

/** Dono da sessão autenticada no instante da chamada (null = sem sessão). */
export function currentOwnerSnapshot(): OwnerSnapshot {
  return { ownerId: pb.authStore.model?.id ?? null }
}

/** Store de autenticação para consultas escopadas (leitura apenas). */
export function getAuthStore() {
  return pb.authStore
}

/** O dono da resposta ainda é o mesmo da leitura? (guarda de retorno tardio) */
export function isSameOwner(snapshot: OwnerSnapshot): boolean {
  return (pb.authStore.model?.id ?? null) === snapshot.ownerId && snapshot.ownerId !== null
}
