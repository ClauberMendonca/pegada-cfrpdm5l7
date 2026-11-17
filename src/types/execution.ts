export type LifeWorkContext = 'todos' | 'vida' | 'trabalho'
export type EntityContext = 'vida' | 'trabalho'

export type ProjectStatus = 'rascunho' | 'ativo' | 'pausado' | 'concluido' | 'arquivado'

export type ActionStatus =
  | 'pronta'
  | 'em_andamento'
  | 'aguardando'
  | 'bloqueada'
  | 'feita'
  | 'cancelada'

export type CaptureStatus = 'pendente' | 'convertida_projeto' | 'convertida_acao' | 'descartada'

export type ProgressLogType = 'executei' | 'resultado_aconteceu'

export interface UserProfile {
  id: string
  email: string
  name?: string
  timezone?: string
  created: string
  updated: string
}

export interface Project {
  id: string
  user_id: string
  title: string
  context: EntityContext
  status: ProjectStatus
  aspiration?: string // o que quero alcançar
  controllable_delivery?: string // o que vou entregar (controlável)
  completion_condition?: string // condição de término
  deadline?: string // YYYY-MM-DD
  learning_asset?: string // possível aprendizado ou ativo durável
  // Oito Rs opcionais:
  r_resultado?: string
  r_razao?: string
  r_referencia?: string
  r_rumo?: string
  r_recursos?: string
  r_restricoes?: string
  r_riscos?: string
  r_responsavel?: string
  // NUMERAÇÃO PERMANENTE: número do banco (migration 0009); ausente/0 = indisponível.
  sequence_number?: number
  created: string
  updated: string
}

export interface ActionItem {
  id: string
  user_id: string
  project_id?: string
  title: string
  context: EntityContext
  status: ActionStatus
  deadline?: string // YYYY-MM-DD
  is_next_step: boolean // Próximo avanço do Hoje
  is_today_selected: boolean // Selecionada explicitamente para Hoje
  waiting_for?: string // motivo de aguardando / bloqueada
  description?: string // notas/orientações de execução (opcional; ausente = vazio)
  // NUMERAÇÃO PERMANENTE: número do banco (migration 0009); ausente/0 = indisponível.
  sequence_number?: number
  created: string
  updated: string
  // expand relation optional
  expand?: {
    project_id?: Project
  }
}

export interface CaptureItem {
  id: string
  user_id: string
  raw_text: string
  status: CaptureStatus
  converted_project_id?: string
  converted_action_id?: string
  created: string
  updated: string
}

export interface ProgressLog {
  id: string
  user_id: string
  project_id?: string
  action_id?: string
  text: string
  log_type: ProgressLogType
  date: string // YYYY-MM-DD
  created: string
  updated: string
  expand?: {
    project_id?: Project
    action_id?: ActionItem
  }
}
