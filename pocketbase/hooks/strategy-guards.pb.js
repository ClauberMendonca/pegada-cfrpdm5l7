// FATIA 4A — GUARDAS DE ESTRATÉGIAS (modelo/persistência + requisição).
//
// Escopo desta fatia (sem CRUD service, sem UI — interface é 4B):
// - strategies: dono derivado da sessão na API comum (payload nunca decide),
//   status default 'ativa' em toda criação sem status, exclusão definitiva
//   bloqueada pela API comum (deleteRule locked na migration 0012 + guarda de
//   requisição) — arquivar/desarquivar é via status.
// - Validação em nível de MODELO (onRecordCreate/onRecordUpdate), alcançando
//   API comum, painel e a conversão de capturas (txApp.save) — as guardas usam
//   a app transacional corrente (e.app), respeitando o contrato void de
//   runInTransaction do hook capture-convert.
// - Estratégia amarra-se a UM Resultado FIXO:
//   * (resultado compartilhado: a estratégia é sempre do dono do Resultado; o
//     avanço de um participante pode ligar-se a ela, basta ser do mesmo Resultado)
//   * user_id e project_id são IMUTÁVEIS em qualquer caminho de persistência
//     (mesmo sem Avanços vinculados): para outro Resultado, criar outro grupo.
//   * Criação exige Resultado existente e do MESMO dono.
//   * title/description/status permanecem editáveis pelo dono.
//   * Arquivar muda SOMENTE strategies.status: nunca desvincula Avanços, não
//     mexe em status/foco/Hoje, não conclui grupo/Resultado, não altera logs
//     ou timer. Sem is_archived paralelo.
//   * Estratégia NÃO é bloqueador novo de Hoje/elegibilidade/execução.
// - Coerência de actions.strategy_id (estado FINAL project_id + strategy_id +
//   responsibility_id após o patch, não só os campos enviados):
//   * Avanço SEM Resultado: strategy_id DEVE ser vazio (mesmo com vínculo
//     direto de Responsabilidade — Estratégia vem de um Resultado-pai).
//   * Avanço COM Resultado: 0..1 Estratégia; quando informada, existe, é do
//     mesmo dono e pertence ao MESMO project_id do Avanço (não basta ser do
//     dono).
//   * Vínculo NOVO ou TROCADO exige Estratégia 'ativa'; manter vínculo
//     ORIGINAL (mesmo id persistido) continua permitido mesmo se a Estratégia
//     estiver arquivada — edita título/status/descrição/tempo/progresso sem
//     mudar a relação. Remover ('') ou trocar explicitamente é permitido.
//   * Trocar o Resultado (ou tornar solto) mantendo estratégia incompatível é
//     REJEITADO com orientação — nada é limpo/copiado/movido silenciosamente;
//     o patch válido resolve no MESMO patch ('' ou ativa compatível) e não faz
//     gravação intermediária.
// - PATCHES: campo omitido preserva o valor anterior (comparação com
//   rec.original()). Comandos existentes que não enviam strategy_id não apagam
//   o vínculo; registro antigo sem o campo novo segue utilizável.
// - Conversion (capture-convert) segue contrato78 intocado: não aceita
//   strategy_id; Avanço com Resultado herda só a Responsabilidade e NUNCA
//   recebe Estratégia por default (a guarda de criação rejeitaria qualquer
//   tentativa — nada é inferido aqui).
// - Numeração (sequence-number.pb.js): estas guardas não leem nem escrevem
//   sequence_number, não abrem transação própria e chamam e.next().
//
// NOTAS JSVM desta instância: lógica INLINE nos callbacks (sem declarações de
// topo); runInTransaction callback é void; sem pacote http (respostas com
// literais numéricos); modificador :changed não suportado (fallback :isset).

// ---------- strategies: API comum ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  // Proprietário sempre deriva da sessão; payload nunca decide o dono.
  e.record.set('user_id', e.auth.id)
  // Criação normal começa ativa quando o status é omitido/vazio.
  if (!e.record.getString('status')) e.record.set('status', 'ativa')
  return e.next()
}, 'strategies')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  // Propriedade imutável pela API comum: payload nunca troca o dono.
  e.record.set('user_id', e.record.original().getString('user_id'))
  return e.next()
}, 'strategies')

// deleteRule locked (null) na migration 0012 já nega a API comum; a guarda
// duplica o veto no canal de requisição por simetria com responsibilities.
onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  throw new ForbiddenError('Exclusão definitiva não é permitida pela API do app.')
}, 'strategies')

// ---------- strategies: modelo (dono/Resultado fixo/arquivamento) ----------
onRecordCreate((e) => {
  const rec = e.record
  // Status default também para criação programática (sem status → ativa).
  if (!rec.getString('status')) rec.set('status', 'ativa')

  const userId = rec.getString('user_id')
  if (!userId) throw new BadRequestError('Estratégia exige dono.')

  // Título só de espaços é inválido (nível modelo, além do pattern do campo).
  if (!rec.getString('title').trim()) {
    throw new BadRequestError('Título é obrigatório.')
  }

  const status = rec.getString('status')
  if (status !== 'ativa' && status !== 'arquivada') {
    throw new BadRequestError('Status da estratégia deve ser ativa ou arquivada.')
  }

  // Resultado-pai é OBRIGATÓRIO e FIXO: existe e é do mesmo dono.
  const projectId = rec.getString('project_id')
  if (!projectId) {
    throw new BadRequestError('Estratégia pertence a um Resultado — project_id é obrigatório.')
  }
  let project
  try {
    project = e.app.findRecordById('projects', projectId)
  } catch (_) {
    throw new BadRequestError('Resultado da estratégia não existe.')
  }
  if (project.getString('user_id') !== userId) {
    throw new ForbiddenError('Resultado da estratégia pertence a outro usuário.')
  }
  return e.next()
}, 'strategies')

onRecordUpdate((e) => {
  const rec = e.record
  const orig = rec.original()

  // Propriedade e Resultado-pai imutáveis em qualquer caminho de
  // persistência (API comum, txApp da conversão, painel) — mesmo sem Avanços
  // vinculados. Para outro Resultado, criar outro grupo; não mover filhos.
  if (rec.getString('user_id') !== orig.getString('user_id')) {
    throw new BadRequestError('Propriedade da estratégia é imutável.')
  }
  if (rec.getString('project_id') !== orig.getString('project_id')) {
    throw new BadRequestError(
      'Resultado da estratégia é fixo — para outro Resultado, crie outra estratégia.',
    )
  }
  return e.next()
}, 'strategies')

// ---------- actions: estratégia opcional do MESMO Resultado (modelo) ----------
onRecordCreate((e) => {
  const rec = e.record
  const strategyId = rec.getString('strategy_id')
  if (strategyId) {
    const projectId = rec.getString('project_id')
    if (!projectId) {
      throw new BadRequestError(
        'Avanço sem Resultado não recebe estratégia — a estratégia pertence a um Resultado-pai.',
      )
    }
    let strategy
    try {
      strategy = e.app.findRecordById('strategies', strategyId)
    } catch (_) {
      throw new BadRequestError('Estratégia vinculada não existe.')
    }
    if (strategy.getString('project_id') !== projectId) {
      throw new BadRequestError('Estratégia vinculada pertence a outro Resultado.')
    }
    // Em criação todo vínculo é novo: exige estratégia ativa.
    if (strategy.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige estratégia ativa.')
    }
  }
  return e.next()
}, 'actions')

onRecordUpdate((e) => {
  const rec = e.record
  const orig = rec.original()

  // Estado FINAL após o patch (não só os campos enviados).
  const nextProjectId = rec.getString('project_id')
  const nextStrategyId = rec.getString('strategy_id')
  const prevStrategyId = orig.getString('strategy_id')
  const prevProjectId = orig.getString('project_id')
  const projectChanged = nextProjectId !== prevProjectId
  const strategyChanged = nextStrategyId !== prevStrategyId

  // Avanço SEM Resultado no estado final: estratégia DEVE ser vazia.
  if (!nextProjectId && nextStrategyId) {
    throw new BadRequestError(
      "Avanço sem Resultado não mantém estratégia — remova-a explicitamente ('') neste mesmo patch.",
    )
  }

  if (nextStrategyId) {
    let strategy
    try {
      strategy = e.app.findRecordById('strategies', nextStrategyId)
    } catch (_) {
      throw new BadRequestError('Estratégia vinculada não existe.')
    }
    if (strategy.getString('project_id') !== nextProjectId) {
      throw new BadRequestError('Estratégia vinculada pertence a outro Resultado.')
    }
    // Vínculo NOVO/TROCADO exige ativa; manter o ORIGINAL persistido segue
    // permitido mesmo com a estratégia já arquivada (edição histórica).
    if (strategyChanged && strategy.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige estratégia ativa.')
    }
  }

  // Trocar o Resultado (ou tornar solto) mantendo a estratégia anterior
  // incompatível: REJEITADO acima com orientação (sem Resultado → remova
  // explicitamente; outro Resultado → "pertence a outro Resultado") — nada é
  // limpo, copiado ou movido silenciosamente. O patch válido resolve ('' ou
  // ativa compatível) no MESMO patch, sem gravação intermediária. Estratégia
  // já vazia: troca de Resultado segue como hoje. Troca explícita para
  // estratégia do NOVO Resultado é válida e exige ativa (checada acima).
  return e.next()
}, 'actions')
