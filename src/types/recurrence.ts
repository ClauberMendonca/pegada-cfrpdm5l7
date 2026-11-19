/**
 * FATIA 6A2 — RECORRÊNCIA: CONTRATO DA REGRA / ENTRADA / SAÍDA (v1)
 *
 * Espelho TypeScript do contrato versionado implementado em
 * pocketbase/hooks/lib/recurrence-calendar.js (cálculo puro CommonJS) e
 * pocketbase/hooks/lib/recurrence-timezone.js (fuso nativo da JSVM).
 *
 * LIMITES DA FATIA 6A2: apenas tipos/contrato — SEM novos campos em Action,
 * sem coleção de séries, sem endpoint, sem editor, sem UI, sem geração.
 * Avaliador pronto NÃO significa recorrência ativada.
 */

/** Dias da semana ISO: 1 = segunda ... 7 = domingo. */
export type RecurrenceWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Posição do dia da semana no mês: 1ª a 5ª, ou "última". */
export type RecurrenceWeekdayPosition = 1 | 2 | 3 | 4 | 5 | 'last'

/** Unidades de repetição. */
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'

/**
 * Alternativas de repeat em mode 'calendar' — união discriminada exata.
 * Campos incompatíveis da alternativa são rejeitados pelo validador
 * (nunca corrigidos silenciosamente).
 */
export type RecurrenceRepeatCalendar =
  | { unit: 'day'; interval: number }
  | { unit: 'week'; interval: number; weekdays: RecurrenceWeekday[] }
  | { unit: 'month'; interval: number; selector: RecurrenceMonthSelector }

/** Em after_completion, NÃO há seletores de calendário — só unit + interval. */
export type RecurrenceRepeatAfterCompletion = {
  unit: RecurrenceUnit
  interval: number
}

/** Seletores do mensal: dia nominal, último dia ou weekday por posição. */
export type RecurrenceMonthSelector =
  | { kind: 'day'; day: number }
  | { kind: 'last_day' }
  | { kind: 'weekday'; weekday: RecurrenceWeekday; position: RecurrenceWeekdayPosition }

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'date'; date: string } // YYYY-MM-DD inclusiva
  | { kind: 'count'; count: number } // ocorrências previstas (não conclusões)

/**
 * Regra JSON v1. planned_time é opcional: ausente equivale apenas a sem hora;
 * '' também é "sem hora"; HH:mm (00:00..23:59) é literal da regra (não herda
 * hora/segundos da conclusão).
 *
 * timezone é nome IANA explícito ou 'UTC' — 'Local', vazio e offset numérico
 * são rejeitados. A validação PURA confere formato/estrutura apenas; a
 * existência do nome no catálogo é validada pela camada nativa de fuso
 * (recurrence-timezone.js) antes de compor a avaliação completa.
 */
export type RecurrenceRule =
  | {
      version: 1
      mode: 'calendar'
      start_date: string // YYYY-MM-DD real (0001..9999)
      planned_time?: '' | `${number}:${number}` // opcional, literal da regra
      timezone: string
      end: RecurrenceEnd
      repeat: RecurrenceRepeatCalendar
    }
  | {
      version: 1
      mode: 'after_completion'
      start_date: string
      planned_time?: '' | `${number}:${number}`
      timezone: string
      end: RecurrenceEnd
      repeat: RecurrenceRepeatAfterCompletion
    }

/** Motivos padronizados e seguros (mesmos do validador CJS). */
export type RecurrenceValidationReason =
  | 'version'
  | 'mode'
  | 'start_date'
  | 'planned_time'
  | 'timezone'
  | 'end'
  | 'end.kind'
  | 'end.date'
  | 'end.count'
  | 'repeat'
  | 'repeat.unit'
  | 'repeat.interval'
  | 'repeat.weekdays'
  | 'repeat.selector'
  | 'repeat.month'
  | 'repeat.day'
  | 'repeat.weekday'
  | 'repeat.position'
  | 'from_date'
  | 'limit'
  | 'preview'
  | 'completed_at'
  | 'ordinal'

export type RecurrenceValidationError = {
  field: RecurrenceValidationReason
  reason: string
}

// ---------------------------------------------------------------------------
// SAÍDA DO CALENDÁRIO FIXO (previewCalendar)
// ---------------------------------------------------------------------------

/** Estado do resultado da prévia. */
export type RecurrencePreviewState =
  | 'invalida' // regra/entrada inválidas (reason presente)
  | 'pronto' // prévia produzida (NÃO significa série encerrada)
  | 'termino' // término REAL da série (end.date/end.count alcançados)
  | 'limit' // orçamento de períodos excedido — nunca falso término

/** Candidato do calendário fixo. */
export type RecurrenceCandidate = {
  /** 'YYYY-MM-DD', dia civil (não instante UTC — nunca salvo como plano). */
  date: string
  /**
   * Ordinal ESTÁVEL no calendário original desde start_date, começando em 1
   * na primeira data válida >= start_date. Independente de geração/conclusão/
   * from_date: pedir prévia a partir de data posterior não reinicia em 1 —
   * datas previstas anteriores continuam consumindo ordinal/count.
   */
  ordinal: number
}

export type RecurrencePreviewResult =
  | { state: 'invalida'; dates: []; reason: RecurrenceValidationError }
  | { state: 'pronto'; dates: RecurrenceCandidate[] }
  | { state: 'termino'; dates: RecurrenceCandidate[]; reason: RecurrenceValidationError }
  | { state: 'limit'; dates: RecurrenceCandidate[]; reason: RecurrenceValidationError }

// ---------------------------------------------------------------------------
// SAÍDA APÓS CONCLUSÃO (nextAfterCompletion) — SOMENTE o próximo candidato
// ---------------------------------------------------------------------------

export type RecurrenceAfterCompletionState =
  | 'aguardando' // sem completed_at conhecido — nada inventado (não é inválido)
  | 'invalida' // regra/entrada inválidas
  | 'termino' // término real (count esgotado / end.date ultrapassado)
  | 'candidato' // próximo candidato calculado

export type RecurrenceNextCandidate = {
  date: string // 'YYYY-MM-DD'
  ordinal: number // ordinal da ocorrência concluída + 1
  /**
   * true quando conclusão antecipada produziu dia anterior a start_date e o
   * candidato foi limitado ao começo da regra (completed_at permanece intocado).
   */
  adjusted_to_start: boolean
}

export type RecurrenceAfterCompletionResult =
  | { state: 'aguardando' }
  | { state: 'invalida'; reason: RecurrenceValidationError }
  | { state: 'termino'; reason: RecurrenceValidationError }
  | { state: 'candidato'; candidate: RecurrenceNextCandidate }

// ---------------------------------------------------------------------------
// ENTRADA DA COMPOSIÇÃO NATIVA (recurrence-timezone.js + calendar)
// ---------------------------------------------------------------------------

/**
 * Entrada da função de composição FUTURA no consumidor: regra + completed_at
 * UTC explícito (string RFC3339 do registro) + ordinal da ocorrência
 * concluída. O ordinal FUTURAMENTE virá do estado persistido, não da posição
 * de uma lista. Nenhum dos valores é derivado do relógio do dispositivo.
 */
export type RecurrenceAfterCompletionInput = {
  rule: RecurrenceRule
  /** Instante UTC explícito do registro (RFC3339) — ausente = aguardando. */
  completed_at?: string | null
  /** Ordinal da ocorrência concluída (estado persistido; inteiro positivo). */
  completed_ordinal: number
}

// Orçamentos estáveis (espelham as constantes do módulo CJS).
export const RECURRENCE_MAX_PREVIEW = 5
export const RECURRENCE_MAX_PERIODS = 10000

// ---------------------------------------------------------------------------
// FATIA 6B1 — SÉRIE RECORRENTE PERSISTIDA (fundação, sem geração/UI)
// ---------------------------------------------------------------------------

/** Estados da SÉRIE (nunca do Avanço/Resultado). Criação começa em draft. */
export type RecurrenceSeriesStatus = 'draft' | 'active' | 'paused' | 'stopped'

/**
 * Template v1 da série: espelho EXATO do contrato validado no backend
 * (recurrence-series-guards.pb.js) — APENAS estes campos. Título simples
 * obrigatório (não copia "AV-N" da fonte); descrição opcional; context é
 * vida|trabalho; IDs reais (não labels/códigos).
 */
export type RecurrenceSeriesTemplate = {
  version: 1
  title: string
  description?: string
  context: EntityContextLike
  project_id?: string
  responsibility_id?: string
  strategy_id?: string
}

/** 'vida' | 'trabalho' — espelho local para não criar dependência circular com execution.ts. */
export type EntityContextLike = 'vida' | 'trabalho'

/**
 * Definição persistida de uma série recorrente (coleção recurrence_series,
 * migration 0015). A fonte (source_action_id) é pertencimento/procedência —
 * NÃO é implicitamente a ocorrência 1 e NÃO é configuração idêntica a cada
 * edição. revision é a revisão da CONFIGURAÇÃO (não contador de ocorrências);
 * na fundação vale sempre 1. rule/template são OBJETOS JSON (nunca string
 * serializada). Escrita pela API comum é BLOQUEADA — comandos nativos futuros
 * persistirão por caminho interno.
 */
export interface RecurrenceSeries {
  id: string
  user_id: string // dono, imutável
  source_action_id: string // Avanço de origem, mesmo dono, imutável
  status: RecurrenceSeriesStatus
  rule: RecurrenceRule // objeto JSON da regra v1
  template: RecurrenceSeriesTemplate // objeto JSON v1
  revision: number // inteiro positivo, inicial 1
  created: string
  updated: string
}

/**
 * Identidade OPCIONAL de ocorrência em um Avanço (campos de
 * src/types/execution.ts). Tupla coerente: série vazia ⇔ ordinal 0/revisão 0;
 * série informada exige ordinal >= 1 e revisão >= 1 (versão corrente da série
 * — nesta fundação, 1). Uma vez atribuída, imutável (não troca/remove em
 * edição normal, reabertura, reconclusão, cancelamento ou parada da série).
 */
export type ActionRecurrenceIdentity = {
  recurrence_series_id: string
  recurrence_ordinal: number
  recurrence_revision: number
}

// ---------------------------------------------------------------------------
// FATIA 6B2A — COMANDOS DE GESTÃO: TRANSPORTE (hook recurrence-series-commands)
// ---------------------------------------------------------------------------

/**
 * Registro normalizado DEVOLVIDO pelas rotas nativas (POST e GET). Espelho do
 * serializer do hook recurrence-series-commands.pb.js: rule/template chegam
 * como objetos JSON simples (nunca string), instantes no formato nativo.
 * NÃO afirma que a série está pronta/ativa/concluída — é o estado persistido.
 */
export type RecurrenceSeriesPayload = {
  id: string
  user_id: string
  source_action_id: string
  status: RecurrenceSeriesStatus
  revision: number
  rule: RecurrenceRule // objeto JSON (nunca string serializada)
  template: RecurrenceSeriesTemplate // objeto JSON v1
  created: string
  updated: string
}

/**
 * Envelope de entrada do POST /backend/v1/recurrence/series — EXATAMENTE estas
 * três chaves. source_action_id é o ID nativo do Avanço fonte;
 * expected_source_updated é o LITERAL exato do `updated` da leitura autenticada
 * da fonte (formato UTC/precisão PocketBase — sem conversão/parsing/trim/trunca-
 * mento de milissegundos, sem relógio do cliente, sem comparar Date). rule é o
 * objeto v1 do avaliador 6A2. Qualquer campo extra (user_id, template, status,
 * revision, ordinal, identidade, completed_at, flags…) é rejeitado pelo
 * servidor — inclusive com valor igual.
 */
export type RecurrenceSeriesRegisterInput = {
  source_action_id: string
  expected_source_updated: string
  rule: RecurrenceRule
}

/**
 * Resposta do POST: {series, duplicate, config_applied}. duplicate:true =
 * série já existia para a fonte (qualquer status — devolvida SEM alteração;
 * retentativa não é comando de edição, tem prioridade sobre expected_updated
 * desatualizado e sobre validação semântica da rule); config_applied:true =
 * o rascunho foi efetivamente criado a partir da fonte fresca validada.
 */
export type RecurrenceSeriesRegisterResult = {
  series: RecurrenceSeriesPayload
  duplicate: boolean
  config_applied: boolean
}

/**
 * Resposta do GET /backend/v1/recurrence/series/{seriesId}: {series} — o que
 * está PERSISTIDO, sem revalidar a regra nem reler a origem. Erros do contrato:
 * 401 sem sessão, 400 envelope/regra inválidos, 404 destino
 * inexistente/inacessível (de outro dono), 409 updated divergente/Avanço já
 * ocorrência de outra série/conflito de índice, 500 falha de armazenamento.
 */
export type RecurrenceSeriesGetResult = {
  series: RecurrenceSeriesPayload
}
