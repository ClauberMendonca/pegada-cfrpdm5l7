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

// FATIA 3A — RESPONSABILIDADES: base mínima (fundação da 3B/3C).
// Responsabilidade é um compromisso contínuo assumido (não tarefa, estratégia
// ou Resultado). Sem sequence_number/código R/AV; título não é único (ID
// nativo identifica o grupo). Propósito de vida NÃO é campo nem gerador.
export type ResponsibilityStatus = 'ativa' | 'arquivada'

export interface Responsibility {
  id: string
  user_id: string
  title: string // simples, até 200; só de espaços é inválido
  description?: string // simples, até 3000; sem HTML/editor rico
  context: EntityContext // 'vida' | 'trabalho' ('todos' é só filtro)
  status: ResponsibilityStatus // criação normal começa 'ativa'
  created: string
  updated: string
  expand?: {
    user_id?: UserProfile
  }
}

export interface UserProfile {
  id: string
  email: string
  name?: string
  timezone?: string
  // FATIA 2A — propósito de vida opcional (users.life_purpose, máx. 500).
  // Fonte canônica: backend. Ausente/vazio = sem propósito.
  life_purpose?: string
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
  // FATIA 3A — Responsabilidade do Resultado: 0..1, opcional, vazio por padrão.
  // Ausente/vazio é legítimo (não exige propósito nem grupo fictício "Nenhuma").
  // Vínculo novo exige destino existente, mesmo dono, mesmo contexto e ativa
  // (validado no backend, incl. caminho txApp da conversão).
  responsibility_id?: string
  created: string
  updated: string
  expand?: {
    responsibility_id?: Responsibility
  }
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
  // FATIA 3A — SOMENTE vínculo DIRETO do Avanço SOLTO (sem project_id).
  // Avanço subordinado a Resultado NÃO tem vínculo direto: a responsabilidade
  // EFETIVA é SEMPRE herdada de projects.responsibility_id do Resultado
  // corrente e JAMAIS é gravada no Avanço (nem em logs/tempo). O backend
  // rejeita patch que vá a Resultado mantendo vínculo direto, e não preenche
  // vínculo direto automaticamente ao sair de Resultado. Mesmo nome técnico do
  // campo de projects, sentido definido por este contrato.
  responsibility_id?: string
  created: string
  updated: string
  // expand relation optional
  expand?: {
    project_id?: Project
    responsibility_id?: Responsibility
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
