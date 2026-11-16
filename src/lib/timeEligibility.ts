import { ActionItem, Project } from '@/types/execution'
import { checkEligibility } from '@/lib/eligibility'

/**
 * REGISTRO DE TEMPO V1 — regra de INÍCIO de novos intervalos.
 * Ações pronta/em_andamento (com projeto ativo/rascunho quando houver) e
 * projetos ativo/rascunho podem iniciar cronômetro. Ações aguardando,
 * bloqueada, feita, cancelada e projetos pausado/concluido/arquivado não
 * iniciam novo timer sem mudança explícita de status (comandos já existentes).
 * Registrar/corrigir dedicação PASSADA continua permitido em qualquer alvo.
 */
export function canStartNewTimer(action: ActionItem, project: Project | null | undefined): boolean {
  if (action.status !== 'pronta' && action.status !== 'em_andamento') return false
  return checkEligibility(action, project).ok
}

export function canStartNewTimerForProject(project: Project): boolean {
  return project.status === 'ativo' || project.status === 'rascunho'
}
