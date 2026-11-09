import { ActionItem, Project } from '@/types/execution'

/**
 * FATIA 2 (P1A) — Regra de elegibilidade COMPARTILHADA do Hoje.
 * Único módulo usado tanto na SELEÇÃO de novo foco quanto na RENDERIZAÇÃO
 * do foco já escolhido. Sem algoritmo de prioridade/capacidade/calendário.
 *
 * Regra:
 *  - Nova escolha de foco ("Próximo Avanço" / "Poucas Ações de Hoje"):
 *    somente ações "pronta" (inclusive sem prazo e sem projeto — ação
 *    independente continua disponível).
 *  - Foco já escolhido (renderização): admite "pronta" e "em andamento".
 *  - NUNCA elegíveis: aguardando, bloqueada, feita, cancelada, e ações cujo
 *    projeto vinculado esteja pausado, arquivado ou encerrado — mesmo com
 *    flags de escolha antigas (is_next_step / is_today_selected).
 *  - Projeto rascunho NÃO impede: não exigimos Rs preenchidos nem migração
 *    para ativo para iniciar um passo reversível.
 *  - Prazo não influencia elegibilidade e não escolhe foco.
 */

export type IneligibilityReason =
  | 'aguardando dependência'
  | 'bloqueada'
  | 'ação feita'
  | 'ação cancelada'
  | 'projeto pausado'
  | 'projeto arquivado'
  | 'projeto encerrado'
  | 'projeto não encontrado'
  | 'impedimento'

const PROJECT_BLOCK_LABEL: Record<string, IneligibilityReason> = {
  pausado: 'projeto pausado',
  arquivado: 'projeto arquivado',
  concluido: 'projeto encerrado',
}

/**
 * Resolve a situação REAL do projeto vinculado à ação, a partir da lista
 * carregada do backend (mesma consulta, sem suposição).
 *
 * Retorna:
 *  - Project        → relação carregada (via expand ou da lista de projetos);
 *  - null           → ação independente (sem projeto);
 *  - undefined      → projeto vinculado mas NÃO carregado na consulta atual
 *                     (contextFilter fora do escopo, falha parcial): tratado
 *                     como impedimento — não assumimos "ativo".
 */
export function resolveProjectState(
  action: ActionItem,
  projects: Project[],
): Project | null | undefined {
  if (!action.project_id) return null
  const expanded = action.expand?.project_id
  if (expanded) return expanded
  const found = projects.find((p) => p.id === action.project_id)
  return found // undefined se não carregado → tratado como impedimento
}

export interface EligibilityCheck {
  ok: boolean
  /** Motivo legível quando !ok (ex.: "aguardando dependência", "projeto pausado"). */
  label?: IneligibilityReason
}

/**
 * Verificação completa usada na RENDERIZAÇÃO do foco já escolhido:
 * admite "pronta" e "em andamento" (flags antigas continuam válidas).
 */
export function checkEligibility(
  action: ActionItem,
  project: Project | null | undefined,
): EligibilityCheck {
  if (action.status === 'aguardando') return { ok: false, label: 'aguardando dependência' }
  if (action.status === 'bloqueada') return { ok: false, label: 'bloqueada' }
  if (action.status === 'feita') return { ok: false, label: 'ação feita' }
  if (action.status === 'cancelada') return { ok: false, label: 'ação cancelada' }

  // Projeto: null = independente (ok); undefined = não carregado (impedimento,
  // não assumimos ativo); projeto carregado precisa não estar pausado/arquivado/encerrado.
  if (project === undefined) return { ok: false, label: 'projeto não encontrado' }
  if (project) {
    const blockLabel = PROJECT_BLOCK_LABEL[project.status]
    if (blockLabel) return { ok: false, label: blockLabel }
  }

  return { ok: true }
}

/**
 * Regra para NOVA escolha de foco: mais restritiva — somente "pronta"
 * (além de todos os impedimentos acima). "Em andamento" não pode ser (re)
 * escolhida como próximo avanço; foco já existente em andamento permanece.
 */
export function isSelectableForFocus(
  action: ActionItem,
  project: Project | null | undefined,
): boolean {
  if (action.status !== 'pronta') return false
  return checkEligibility(action, project).ok
}

/** Usado para manter em tela o foco já escolhido (pronta OU em andamento). */
export function isEligibleForFocusDisplay(
  action: ActionItem,
  resolveProject: (a: ActionItem) => Project | null | undefined,
): boolean {
  return checkEligibility(action, resolveProject(action)).ok
}

/** Motivo legível para exibição na seção "Reavaliar" (ou null se elegível). */
export function ineligibilityLabel(
  action: ActionItem,
  resolveProject: (a: ActionItem) => Project | null | undefined,
): string | null {
  const check = checkEligibility(action, resolveProject(action))
  return check.ok ? null : (check.label ?? 'impedimento')
}
