/**
 * ENTREGA 3B — Leitura da hierarquia real de uma Responsabilidade.
 * SOMENTE LEITURA, sem N+1 e sem gravação de herança: herança é a regra de
 * leitura da 3A (Avanço com project_id herda do Resultado; vínculo direto
 * existe só em Avanço SOLTO). Consultas escopadas ao dono e ao ID nativo,
 * com paginação completa (getFullList) — nunca a 1ª página como coleção.
 *
 * Plano de leitura:
 * 1. projects do dono com responsibility_id = <ficha> (todos os estados);
 * 2. actions do dono com project_id VAZIO e responsibility_id = <ficha>
 *    (diretos) — consulta combinável com a herdada numa única chamada;
 * 3. actions dos Resultados encontrados (por IDs únicos, em chunks), só se
 *    houver Resultados.
 * Nenhuma busca por tempo/logs; contagens só de dados confirmados e únicos.
 *
 * Filtro de subordinados: a API de coleções do PocketBase não aceita `IN` de
 * SQL — cada ID vira uma igualdade nativa, unidas por `||` e agrupadas em
 * parênteses após o &&, para que o recorte de dono nunca se perca na
 * precedência (nunca `(dono && id1) || id2`).
 */
import pb from '@/lib/pocketbase/client'
import { ActionItem, Project } from '@/types/execution'

export interface ResponsibilityHierarchy {
  /** Resultados vinculados, com seus Avanços subordinados abaixo de cada um. */
  projects: Project[]
  /** Avanços de cada Resultado, agrupados por project_id. */
  actionsByProject: Record<string, ActionItem[]>
  /** Avanços SOLTOS vinculados diretamente à Responsabilidade (sem Resultado). */
  directActions: ActionItem[]
  /** Algo falhou em algum bloco: nunca vira zeros/vazio/sucesso parcial. */
  errors: string[]
}

const CHUNK_SIZE = 40 // limite seguro para a disjunção de igualdades por chunk

function chunkArray(values: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

/** Escapa aspas duplas para uso seguro em filtro PocketBase parametrizado. */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Carrega a hierarquia da Responsabilidade `ownerId + responsibilityId`.
 * `isSameOwner` compara a sessão antes de aplicar o resultado (retorno
 * tardio de outra identidade/sessão nunca vira ficha desta).
 */
export async function loadResponsibilityHierarchy(
  ownerId: string,
  responsibilityId: string,
): Promise<ResponsibilityHierarchy> {
  const errors: string[] = []
  const ownerFilter = `user_id = ${quoteFilterValue(ownerId)}`
  const respFilter = `responsibility_id = ${quoteFilterValue(responsibilityId)}`

  // 1) Resultados vinculados (todos os estados) + 2) Avanços diretos soltos
  // em uma rodada de consultas independentes (uma falha não apaga a outra).
  const [projectsResult, directResult] = await Promise.allSettled([
    pb.collection('projects').getFullList<Project>({
      filter: `${ownerFilter} && ${respFilter}`,
      sort: '-created',
    }),
    pb.collection('actions').getFullList<ActionItem>({
      filter: `${ownerFilter} && project_id = '' && ${respFilter}`,
      sort: '-created',
    }),
  ])

  const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : []
  if (projectsResult.status === 'rejected') {
    errors.push('Não foi possível carregar os Resultados vinculados.')
  }
  const directActions = directResult.status === 'fulfilled' ? directResult.value : []
  if (directResult.status === 'rejected') {
    errors.push('Não foi possível carregar os Avanços diretos.')
  }

  // 3) Avanços subordinados: pelos IDs ÚNICOS dos Resultados realmente
  // encontrados, em chunks completos. Sem Resultados, pular só este bloco
  // (os diretos continuam sendo lidos acima).
  const actionsByProject: Record<string, ActionItem[]> = {}
  const uniqueProjectIds = Array.from(new Set(projects.map((p) => p.id)))
  for (const chunk of chunkArray(uniqueProjectIds, CHUNK_SIZE)) {
    const inList = chunk.map((id) => `project_id = ${quoteFilterValue(id)}`).join(' || ')
    try {
      const page = await pb.collection('actions').getFullList<ActionItem>({
        filter: `${ownerFilter} && (${inList})`,
        sort: '-created',
      })
      for (const action of page) {
        // Prioridade canônica: subordinado a Resultado (project_id) — nunca
        // por título. Um Avanço não entra em duas seções (dedupe por ID).
        const pid = action.project_id
        if (!pid) continue
        if (!actionsByProject[pid]) actionsByProject[pid] = []
        if (!actionsByProject[pid].some((a) => a.id === action.id)) {
          actionsByProject[pid].push(action)
        }
      }
    } catch {
      errors.push('Não foi possível carregar os Avanços de alguns Resultados.')
    }
  }

  return { projects, actionsByProject, directActions, errors }
}
