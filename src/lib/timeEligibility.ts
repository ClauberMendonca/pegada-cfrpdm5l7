import { ActionItem, Project } from '@/types/execution'

/**
 * Regra de INÍCIO de novos intervalos.
 *
 * Ações prontas/em andamento só iniciam quando o projeto vinculado foi
 * confirmado como ativo ou rascunho. Ações independentes não têm projeto a
 * bloquear. Um projeto vinculado desconhecido nunca é tratado como ativo por
 * suposição.
 */
export function canStartNewTimer(
  action: Pick<ActionItem, 'status' | 'project_id'>,
  project: Pick<Project, 'status'> | null | undefined,
  actionHasProject?: boolean,
): boolean {
  if (action.status !== 'pronta' && action.status !== 'em_andamento') return false

  const hasProject = actionHasProject ?? Boolean(action.project_id || project)
  if (!hasProject) return true

  return project?.status === 'ativo' || project?.status === 'rascunho'
}

/** Um projeto só inicia novo intervalo quando está ativo ou em rascunho. */
export function canStartNewTimerForProject(
  project: Pick<Project, 'status'> | null | undefined,
): boolean {
  return project?.status === 'ativo' || project?.status === 'rascunho'
}
