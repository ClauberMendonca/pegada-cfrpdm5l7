import pb from '@/lib/pocketbase/client'
import { ActionItem, CaptureItem, Project } from '@/types/execution'
import { getAuthStore } from '@/lib/ownerScope'

/**
 * NUMERAÇÃO PERMANENTE — Entrega 2C: resolução dos destinos de capturas já
 * convertidas (converted_project_id / converted_action_id) EM BATELADA.
 * UMA leitura autenticada por tipo por batelada de destinos (nunca getById
 * por card, por modo de visão ou por item aberto). A leitura usa somente os
 * IDs vinculados que as regras da sessão do dono permitem — nada de ampliar
 * permissões, trocar filtro global ou listar o banco inteiro. Falha de leitura
 * NUNCA bloqueia captura/conversão/descarte/tempo: quem chama trata o retorno
 * como mapa possivelmente incompleto (código não resolvido ⇒ sem selo).
 */
export interface TargetMaps {
  projects: Map<string, Project>
  actions: Map<string, ActionItem>
}

const EMPTY_MAPS: TargetMaps = { projects: new Map(), actions: new Map() }

/** Mapas vazios: falha/carregamento não bloqueiam nada e não inventam código. */
export function emptyTargetMaps(): TargetMaps {
  return { projects: new Map(), actions: new Map() }
}

/** IDs únicos de destino presentes nas capturas já carregadas (somente leitura). */
export function collectTargetIds(captures: CaptureItem[]): {
  projectIds: string[]
  actionIds: string[]
} {
  const projectIds = new Set<string>()
  const actionIds = new Set<string>()
  for (const item of captures) {
    if (item.status === 'convertida_projeto' && item.converted_project_id) {
      projectIds.add(item.converted_project_id)
    }
    if (item.status === 'convertida_acao' && item.converted_action_id) {
      actionIds.add(item.converted_action_id)
    }
  }
  return { projectIds: [...projectIds], actionIds: [...actionIds] }
}

/** Escapa apóstrofo para o filtro do PocketBase (IDs são gerados, defesa extra). */
function escapeId(id: string): string {
  return id.replace(/'/g, "\\'")
}

async function listByIds<T>(collection: string, ids: string[], ownerId: string): Promise<T[]> {
  if (ids.length === 0) return []
  const idFilter = ids.map((id) => `id = '${escapeId(id)}'`).join(' || ')
  const filter = `user_id = '${escapeId(ownerId)}' && (${idFilter})`
  return pb.collection(collection).getFullList<T>({ filter })
}

/**
 * Uma leitura por tipo, com mapa por ID. Falha de um tipo não afeta o outro.
 * Escopo do dono verificado ANTES da leitura: sem sessão não há consulta e o
 * mapa volta vazio (código não resolvido ⇒ sem selo; nada é bloqueado).
 */
export async function fetchTargetMaps(
  projectIds: string[],
  actionIds: string[],
): Promise<TargetMaps> {
  const ownerId = getAuthStore().model?.id
  if (!ownerId) return emptyTargetMaps()
  const [projects, actions] = await Promise.all([
    listByIds<Project>('projects', projectIds, ownerId).catch(() => [] as Project[]),
    listByIds<ActionItem>('actions', actionIds, ownerId).catch(() => [] as ActionItem[]),
  ])
  return {
    projects: new Map(projects.map((p) => [p.id, p])),
    actions: new Map(actions.map((a) => [a.id, a])),
  }
}
