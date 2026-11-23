import pb from '@/lib/pocketbase/client'
import { Project, EntityContext, ProjectStatus } from '@/types/execution'
import { op, lote, LoteItem } from '@/lib/pegada/api'

export interface CreateProjectInput {
  title: string
  context: EntityContext
  status?: ProjectStatus
  aspiration?: string
  controllable_delivery?: string
  completion_condition?: string
  deadline?: string
  learning_asset?: string
  r_resultado?: string
  r_razao?: string
  r_referencia?: string
  r_rumo?: string
  r_recursos?: string
  r_restricoes?: string
  r_riscos?: string
  r_responsavel?: string
  /** FATIA 3C1 — vínculo opcional com Responsabilidade: ID nativo; '' remove;
     OMITIR (undefined) em update mantém o vínculo atual. */
  responsibility_id?: string
}

export type UpdateProjectInput = Partial<CreateProjectInput>

// PEGADA — Resultado = estado alcançado (title) + prazo (deadline) + como sei
// (completion_condition), nascido do Propósito ou de uma Responsabilidade.
// Escrita só pela API do método. Os campos do modelo antigo (aspiration, os
// oito Rs etc.) seguem aceitos em _legado até o formulário ser simplificado.

const LEGACY_KEYS = [
  'aspiration',
  'controllable_delivery',
  'learning_asset',
  'r_resultado',
  'r_razao',
  'r_referencia',
  'r_rumo',
  'r_recursos',
  'r_restricoes',
  'r_riscos',
  'r_responsavel',
] as const

function legado(data: UpdateProjectInput): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const k of LEGACY_KEYS) {
    const v = data[k]
    if (v !== undefined) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

const DECISAO: Record<ProjectStatus, string> = {
  ativo: 'sigo',
  concluido: 'alcancado',
  abandonado: 'abandonar',
  futuro: 'futuro',
  pausado: 'pausar',
  arquivado: 'arquivar',
  rascunho: 'rascunho',
}

export const projectService = {
  async list(contextFilter?: EntityContext, statusFilter?: ProjectStatus): Promise<Project[]> {
    const filters: string[] = []
    if (contextFilter) {
      filters.push(`context = '${contextFilter}'`)
    }
    if (statusFilter) {
      filters.push(`status = '${statusFilter}'`)
    }
    const filter = filters.length > 0 ? filters.join(' && ') : ''
    return pb.collection('projects').getFullList<Project>({
      filter,
      sort: '-created',
    })
  },

  async getById(id: string): Promise<Project> {
    return pb.collection('projects').getOne<Project>(id)
  },

  async create(data: CreateProjectInput): Promise<Project> {
    const status = data.status || 'ativo'
    const res = await op<{ resultado_id: string }>('criar_resultado', {
      titulo: data.title,
      prazo: data.deadline || undefined,
      como_sei: data.completion_condition || undefined,
      responsabilidade_id: data.responsibility_id || undefined,
      contexto: data.context,
      situacao: status === 'futuro' || status === 'rascunho' ? status : 'ativo',
      _legado: legado(data),
    })
    const id = res.resultado!.resultado_id
    if (status !== 'ativo' && status !== 'futuro' && status !== 'rascunho') {
      await op('decidir_resultado', { resultado_id: id, decisao: DECISAO[status] })
    }
    return projectService.getById(id)
  },

  async update(id: string, data: UpdateProjectInput): Promise<Project> {
    const ops: LoteItem[] = []
    const edit: Record<string, unknown> = {}
    if (data.title !== undefined) edit.titulo = data.title
    if (data.deadline !== undefined) edit.prazo = data.deadline
    if (data.completion_condition !== undefined) edit.como_sei = data.completion_condition
    if (data.responsibility_id !== undefined) edit.responsabilidade_id = data.responsibility_id
    if (data.context !== undefined) edit.contexto = data.context
    const leg = legado(data)
    if (leg) edit._legado = leg
    if (Object.keys(edit).length)
      ops.push({ op: 'editar_resultado', entrada: { resultado_id: id, ...edit } })
    if (data.status !== undefined) {
      const current = await projectService.getById(id)
      if (current.status !== data.status) {
        ops.push({
          op: 'decidir_resultado',
          entrada: { resultado_id: id, decisao: DECISAO[data.status] },
        })
      }
    }
    if (ops.length) await lote(ops)
    return projectService.getById(id)
  },

  async archive(id: string): Promise<Project> {
    return projectService.update(id, { status: 'arquivado' })
  },

  async complete(id: string): Promise<Project> {
    return projectService.update(id, { status: 'concluido' })
  },

  async activate(id: string): Promise<Project> {
    return projectService.update(id, { status: 'ativo' })
  },

  async pause(id: string): Promise<Project> {
    return projectService.update(id, { status: 'pausado' })
  },
}
