// FATIA 6B2A — COMANDOS DE SÉRIE: REGISTRAR RASCUNHO E CONSULTAR — SEM GERAÇÃO.
//
// Rotas nativas autenticadas (padrão local /backend/v1/):
//   POST /backend/v1/recurrence/series                → registrar rascunho a partir de Avanço existente.
//   GET  /backend/v1/recurrence/series/{seriesId}     → consultar série persistida do dono.
//
// - Sessão users OBRIGATÓRIA (padrão das rotas nativas). user_id deriva
//   EXCLUSIVAMENTE da sessão (e.auth.id) — nunca do body, parâmetro ou header.
// - POST recebe objeto JSON ESTRITO com SOMENTE: source_action_id (ID nativo
//   não vazio), expected_source_updated (string não vazia — literal exato do
//   `updated` da leitura autenticada da fonte, formato UTC/precisão PocketBase;
//   sem conversão/parsing/trim/truncamento de milissegundos) e rule (objeto
//   JSON v1 do avaliador 6A2). Qualquer outro campo — inclusive user_id,
//   template, status, revision, ordinal, identidade, completed_at, flags —
//   rejeita com 400 (mesmo valor igual).
// - runInTransaction com callback VOID (padrão local): txApp em TODAS as
//   leituras/saves, resultado em variável LOCAL da requisição, resposta HTTP
//   (e.json) só DEPOIS do commit.
// - PRÉ-CHECAGEM por source_action_id + dono, com bind de parâmetros (padrão
//   nativo real). Falha de consulta NÃO é lista vazia — é erro 500 honesto.
//   O índice UNIQUE idx_recurrence_series_source (0015) é a garantia final.
// - RAMO JÁ EXISTE (prioridade sobre expected_source_updated desatualizado e
//   sobre validação SEMÂNTICA da rule): devolve a série persistida (draft/
//   active/paused/stopped) com duplicate:true e config_applied:false — não
//   salva NADA, não reativa, não atualiza template/regra, não incrementa
//   revisão, não substitui a fonte. Retentativa NÃO é comando de edição.
//   Validação de envelope/propriedade/autenticação permanece obrigatória.
// - RAMO NOVO: relê a fonte via txApp e confere dono (inacessível → 404
//   seguro; erro de armazenamento → 500 honesto, não mascarado). Compara o
//   `updated` LITERAL fresco com expected_source_updated (strings exatas) —
//   divergência → 409, sem cadastro. Avanço já identificado como ocorrência de
//   outra série → 409 (sem recorrência de recorrência). Fonte ainda comum pode
//   estar feita: aceita sem validar status arbitrariamente e sem inventar
//   âncora/plano. Validada rule pelo módulo 6A2 REAL (validateRule) + fuso
//   nativo (resolveTimezone) DENTRO do callback — after_completion sem
//   completed_at é configuração válida (nada é gerado aqui). Template v1 é
//   derivado SOMENTE da fonte fresca (title puro, description, context,
//   project_id, responsibility_id direto, strategy_id) — nunca do cliente.
//   O estado FINAL (recurrence_series com rule+template) é validado pelas
//   GUARDAS DE MODELO 6B1 (onRecordValidate de recurrence_series), que
//   alcançam o txApp.save — não são duplicadas aqui; falha reverte tudo.
// - Cria recurrence_series (status:draft, revision:1) via save transacional.
//   A fonte NÃO é alterada: sem tocar seus três campos de identidade, sem
//   torná-la ocorrência 1 (adoção é contrato futuro), sem occurrence/clone/
//   sequence_number/contador/plan/status/Hoje.
// - CONCORRÊNCIA: mesmo com pré-checagem, duas chamadas concorrentes nunca
//   criam dois cadastros — o UNIQUE da 0015 rejeita o segundo save dentro da
//   transação. Reler existente do dono após rollback APENAS quando a causa
//   efetiva é conflito daquele índice (mensagem/erro nativo contém o nome do
//   índice); causa indistinguível → erro honesto (500) sem sucesso inventado.
//   Sem loop de retry e sem segundo save fora da transação.
// - GET: confere ID/dono e devolve o que está PERSISTIDO (id, user_id,
//   source_action_id, status, revision, rule, template, created, updated).
//   Wrappers JSON convertidos para objeto simples pelo padrão REAL local
//   (string/varredura de bytes); parse falho NUNCA vira {} nem fonte
//   reconstruída — é 500 honesto. Consulta não revalida regra como vínculo
//   novo, não relê a origem para substituir snapshot, não escreve nada.
// - Respostas: POST {series, duplicate, config_applied}; GET {series}.
//   Sucesso 200. Erros: 401 sem sessão, 400 envelope/entrada/regra, 404
//   destino inexistente/inacessível, 409 updated divergente/ocorrência de
//   outra série/conflito de índice, 500 falha de armazenamento. Sem stack nem
//   texto integral do body/regra no feedback.
//
// NOTAS JSVM desta instância: lógica INLINE nos callbacks; require dos módulos
// 6A2 DENTRO do callback; sem pacote http (status por literais numéricos);
// rotas registradas com o caminho exato servido (routerAdd não acrescenta
// prefixo); nenhuma série é ativada ou materializada nesta fatia.

// ======================= POST /backend/v1/recurrence/series =======================

routerAdd('POST', '/backend/v1/recurrence/series', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id

  // ---------- envelope JSON estrito ----------
  const info = e.requestInfo()
  const body = info && info.body ? info.body : null
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Corpo da requisição deve ser um objeto JSON.')
  }

  // Chaves do body via serialização ida-e-volta (wrapper goja pode não expor
  // Object.keys de forma confiável entre pools).
  let bodyKeys = null
  try {
    bodyKeys = Object.keys(JSON.parse(JSON.stringify(body)))
  } catch (_) {
    bodyKeys = null
  }
  if (bodyKeys === null) {
    throw new BadRequestError('Corpo da requisição não pôde ser verificado.')
  }

  const ALLOWED_FIELDS = ['source_action_id', 'expected_source_updated', 'rule']
  for (let i = 0; i < bodyKeys.length; i += 1) {
    if (ALLOWED_FIELDS.indexOf(bodyKeys[i]) < 0) {
      throw new BadRequestError('Corpo contém campo não permitido.')
    }
  }
  if (bodyKeys.length !== ALLOWED_FIELDS.length) {
    throw new BadRequestError('Corpo exige source_action_id, expected_source_updated e rule.')
  }

  const sourceActionId = body.source_action_id
  if (typeof sourceActionId !== 'string' || sourceActionId.length === 0) {
    throw new BadRequestError('source_action_id é obrigatório (ID nativo do Avanço de origem).')
  }
  const expectedUpdated = body.expected_source_updated
  if (typeof expectedUpdated !== 'string' || expectedUpdated.length === 0) {
    throw new BadRequestError(
      'expected_source_updated é obrigatório (literal exato do updated da leitura autenticada da fonte).',
    )
  }
  const ruleRaw = body.rule
  if (
    ruleRaw === null ||
    ruleRaw === undefined ||
    Array.isArray(ruleRaw) ||
    typeof ruleRaw !== 'object'
  ) {
    throw new BadRequestError('rule é obrigatório (objeto JSON da regra v1).')
  }

  // ---------- conversão de wrapper JSON para objeto simples (padrão REAL) ----------
  const plainObjectOrNull = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null
    if (typeof raw === 'string') {
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch (_) {
        return undefined
      }
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return undefined
      return parsed
    }
    if (typeof raw === 'object' && typeof raw.string === 'function') {
      let text = ''
      try {
        text = raw.string()
      } catch (_) {
        return undefined
      }
      if (text === '' || text === 'null') return null
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch (_) {
        return undefined
      }
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return undefined
      return parsed
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return undefined
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch (_) {
        return undefined
      }
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return undefined
      return parsed
    }
    if (typeof raw === 'object') return raw
    return undefined
  }

  // Regra vinda do cliente: objeto simples (wrapper convertido quando
  // necessário). Parse falho/estrutura não-objeto é rejeição — nunca regra vazia.
  const ruleObj = plainObjectOrNull(ruleRaw)
  if (ruleObj === null || ruleObj === undefined) {
    throw new BadRequestError('rule deve ser um objeto JSON da regra v1.')
  }

  // ---------- resultado local (resposta só após commit) ----------
  let result = null

  const run = () => {
    e.app.runInTransaction((txApp) => {
      // ---------- pré-checagem: série já existente para fonte + dono ----------
      let existing = null
      let lookupFailed = false
      try {
        const found = txApp.findRecordsByFilter(
          'recurrence_series',
          'source_action_id = {:sid} && user_id = {:uid}',
          'created',
          1,
          0,
          { sid: sourceActionId, uid: userId },
        )
        if (found && found.length > 0) existing = found[0]
      } catch (_) {
        lookupFailed = true
      }
      if (lookupFailed) {
        // Falha de consulta não é lista vazia — erro honesto de armazenamento.
        throw new ApiError(500, 'Falha ao consultar séries existentes.')
      }

      if (existing) {
        // Retentativa NÃO é comando de edição: devolve o que está persistido
        // (qualquer status) sem salvar nada — prioridade sobre expected_source
        // _updated desatualizado e sobre validação SEMÂNTICA da rule.
        result = { series: existing, duplicate: true, configApplied: false }
        return
      }

      // ---------- fonte: reler fresco via txApp e conferir dono ----------
      let source = null
      try {
        source = txApp.findRecordById('actions', sourceActionId)
      } catch (err) {
        // Distingue inexistência/acesso (404) de falha de armazenamento (500):
        // erro do driver real carrega texto SQL; "no rows" é o caso de ausência.
        let msg = ''
        try {
          msg = String(err && err.message ? err.message : '')
        } catch (_) {
          msg = ''
        }
        if (msg.indexOf('no rows') >= 0) {
          throw new NotFoundError('Avanço de origem não encontrado.')
        }
        throw new ApiError(500, 'Falha ao consultar o Avanço de origem.')
      }
      if (source.getString('user_id') !== userId) {
        // 404 seguro: não revela existência de Avanço de outro dono.
        throw new NotFoundError('Avanço de origem não encontrado.')
      }

      // ---------- ocorrência de outra série não vira fonte nova ----------
      if (source.getString('recurrence_series_id') !== '') {
        throw new ApiError(409, 'Avanço já pertence a uma série de recorrência.')
      }

      // ---------- expected_source_updated: comparação LITERAL ----------
      let freshUpdated = ''
      try {
        freshUpdated = source.getDateTime('updated').string()
      } catch (_) {
        freshUpdated = ''
      }
      if (freshUpdated === '') {
        try {
          freshUpdated = source.getString('updated')
        } catch (_) {
          freshUpdated = ''
        }
      }
      if (freshUpdated === '') {
        throw new ApiError(500, 'Falha ao ler o estado atual do Avanço de origem.')
      }
      // Strings EXATAS — sem conversão/parsing/trim/truncamento de milissegundos.
      if (freshUpdated !== expectedUpdated) {
        throw new ApiError(
          409,
          'Avanço de origem mudou desde a leitura — revise a fonte e repita com o updated atual.',
        )
      }

      // ---------- regra: validação pelo módulo 6A2 REAL (dentro do callback) ----------
      let calendar = null
      let tzAdapter = null
      try {
        calendar = require(__hooks + '/lib/recurrence-calendar.js')
        tzAdapter = require(__hooks + '/lib/recurrence-timezone.js')
      } catch (_) {
        calendar = null
        tzAdapter = null
      }
      if (!calendar || typeof calendar.validateRule !== 'function') {
        throw new BadRequestError(
          'Validação da regra indisponível neste backend — série não pode ser gravada sem verificação da regra.',
        )
      }
      if (!tzAdapter || typeof tzAdapter.resolveTimezone !== 'function') {
        throw new BadRequestError(
          'Validação de fuso indisponível neste backend — série não pode ser gravada sem verificação do fuso.',
        )
      }

      const ruleCheck = calendar.validateRule(ruleObj)
      if (!ruleCheck.ok) {
        // 400 seguro: primeiro motivo padronizado — sem stack/texto integral.
        const first = ruleCheck.errors && ruleCheck.errors.length > 0 ? ruleCheck.errors[0] : null
        const why = first && first.field ? ' (' + String(first.field) + ')' : ''
        throw new BadRequestError('Regra da série inválida' + why + '.')
      }
      const tzCheck = tzAdapter.resolveTimezone(String(ruleObj.timezone || ''))
      if (!tzCheck.ok) {
        throw new BadRequestError(
          'Fuso da regra da série inválido: informe nome IANA explícito (ex.: America/Sao_Paulo) ou UTC.',
        )
      }

      // ---------- template v1 derivado SOMENTE da fonte fresca ----------
      // Título puro (sem "AV-N" nem rótulo); herança (pai) NÃO é copiada —
      // responsibility_id direto da fonte permanece direto.
      const rawTitle = source.getString('title')
      const titleText = rawTitle === null || rawTitle === undefined ? '' : String(rawTitle)
      const dot = titleText.indexOf(' — ')
      const pureTitle = dot > 0 ? titleText.slice(0, dot) : titleText
      const trimmedTitle = pureTitle.trim()
      if (trimmedTitle === '') {
        throw new BadRequestError('Avanço de origem sem título utilizável para o template.')
      }

      const template = {
        version: 1,
        title: trimmedTitle,
        context: source.getString('context'),
      }
      const rawDescription = source.getString('description')
      if (
        rawDescription !== null &&
        rawDescription !== undefined &&
        String(rawDescription) !== ''
      ) {
        template.description = String(rawDescription)
      }
      const sourceProjectId = source.getString('project_id')
      if (sourceProjectId !== '') {
        template.project_id = String(sourceProjectId)
      }
      const sourceResponsibilityId = source.getString('responsibility_id')
      if (sourceResponsibilityId !== '') {
        template.responsibility_id = String(sourceResponsibilityId)
      }
      const sourceStrategyId = source.getString('strategy_id')
      if (sourceStrategyId !== '') {
        template.strategy_id = String(sourceStrategyId)
      }

      // ---------- criação do rascunho (guardas 6B1 validam o estado FINAL) ----------
      const series = new Record(txApp.findCollectionByNameOrId('recurrence_series'))
      series.set('user_id', userId) // derivado da sessão, nunca do payload
      series.set('source_action_id', sourceActionId)
      series.set('status', 'draft')
      series.set('rule', ruleObj)
      series.set('template', template)
      series.set('revision', 1)
      // A guarda onRecordValidate de recurrence_series (6B1) roda neste save:
      // revalida rule (calendário/fuso) e template (pais do mesmo dono/contexto,
      // referências ativas), confere fonte/dono e força status draft/revision 1.
      // Falha reverte a transação — nada persiste.
      txApp.save(series)

      result = { series: series, duplicate: false, configApplied: true }
    })
  }

  // Concorrência: mesmo com a pré-checagem, o índice UNIQUE
  // idx_recurrence_series_source (0015) é a garantia final. Erro de conflito
  // daquele índice → reler existente do dono UMA vez e devolver duplicate.
  // Qualquer outra causa (validação de guarda, DB, etc.) sobe honesta.
  try {
    run()
  } catch (err) {
    let errMsg = ''
    try {
      errMsg = String(err && err.message ? err.message : '')
    } catch (_) {
      errMsg = ''
    }
    let isSourceUniqueConflict = false
    try {
      isSourceUniqueConflict =
        errMsg.indexOf('idx_recurrence_series_source') >= 0 && errMsg.indexOf('UNIQUE') >= 0
    } catch (_) {
      isSourceUniqueConflict = false
    }
    if (!isSourceUniqueConflict) {
      throw err
    }
    // Conflito efetivo daquele índice: a série foi criada pela chamada
    // concorrente. Reler existente do dono (fora da transação, leitura).
    let existingAfterRollback = null
    try {
      const found = e.app.findRecordsByFilter(
        'recurrence_series',
        'source_action_id = {:sid} && user_id = {:uid}',
        'created',
        1,
        0,
        { sid: sourceActionId, uid: userId },
      )
      if (found && found.length > 0) existingAfterRollback = found[0]
    } catch (_) {
      existingAfterRollback = null
    }
    if (!existingAfterRollback) {
      // Causa não pôde ser distinguida/resolvida: erro honesto, sem sucesso
      // inventado. Nova tentativa/consulta é permitida.
      throw new ApiError(409, 'Conflito ao registrar a série — consulte e tente novamente.')
    }
    result = { series: existingAfterRollback, duplicate: true, configApplied: false }
  }

  if (!result) {
    throw new ApiError(500, 'Falha interna ao registrar a série.')
  }

  // ---------- serialização do registro efetivamente salvo ----------
  // JSON wrappers convertidos para objeto simples; parse falho NUNCA vira {}
  // nem fonte reconstruída — é 500 honesto.
  const serializeSeries = (rec) => {
    const readJsonField = (fieldName) => {
      let raw = null
      try {
        raw = rec.get(fieldName)
      } catch (_) {
        raw = null
      }
      if (raw === null || raw === undefined) {
        throw new ApiError(500, 'Registro de série persistido sem ' + fieldName + ' legível.')
      }
      let text = ''
      if (typeof raw === 'string') {
        text = raw
      } else if (typeof raw === 'object' && typeof raw.string === 'function') {
        try {
          text = raw.string()
        } catch (_) {
          text = ''
        }
      } else if (Array.isArray(raw)) {
        if (raw.length === 0 || typeof raw[0] !== 'number') {
          throw new ApiError(500, 'Registro de série persistido com ' + fieldName + ' ilegível.')
        }
        for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      } else if (typeof raw === 'object') {
        try {
          text = JSON.stringify(raw)
        } catch (_) {
          text = ''
        }
      }
      if (text === '' || text === 'null') {
        throw new ApiError(500, 'Registro de série persistido sem ' + fieldName + ' legível.')
      }
      try {
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not object')
        }
        return parsed
      } catch (_) {
        throw new ApiError(500, 'Registro de série persistido com ' + fieldName + ' ilegível.')
      }
    }
    let instants = { created: '', updated: '' }
    try {
      instants.created = rec.getDateTime('created').string()
      instants.updated = rec.getDateTime('updated').string()
    } catch (_) {
      try {
        instants.created = rec.getString('created')
        instants.updated = rec.getString('updated')
      } catch (_) {}
    }
    return {
      id: rec.id,
      user_id: rec.getString('user_id'),
      source_action_id: rec.getString('source_action_id'),
      status: rec.getString('status'),
      revision: rec.getInt('revision'),
      rule: readJsonField('rule'),
      template: readJsonField('template'),
      created: instants.created,
      updated: instants.updated,
    }
  }

  return e.json(200, {
    series: serializeSeries(result.series),
    duplicate: result.duplicate === true,
    config_applied: result.configApplied === true,
  })
})

// ================== GET /backend/v1/recurrence/series/{seriesId} ==================

routerAdd('GET', '/backend/v1/recurrence/series/{seriesId}', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id

  const seriesId = e.request.pathValue('seriesId')
  if (typeof seriesId !== 'string' || seriesId.length === 0) {
    throw new NotFoundError('Série de recorrência não encontrada.')
  }

  let series = null
  try {
    series = e.app.findRecordById('recurrence_series', seriesId)
  } catch (err) {
    let msg = ''
    try {
      msg = String(err && err.message ? err.message : '')
    } catch (_) {
      msg = ''
    }
    if (msg.indexOf('no rows') >= 0) {
      throw new NotFoundError('Série de recorrência não encontrada.')
    }
    throw new ApiError(500, 'Falha ao consultar a série de recorrência.')
  }
  // 404 seguro: série de outro dono não é revelada.
  if (series.getString('user_id') !== userId) {
    throw new NotFoundError('Série de recorrência não encontrada.')
  }

  // ---------- serialização do que está PERSISTIDO (mesma do POST) ----------
  const readJsonField = (rec, fieldName) => {
    let raw = null
    try {
      raw = rec.get(fieldName)
    } catch (_) {
      raw = null
    }
    if (raw === null || raw === undefined) {
      throw new ApiError(500, 'Registro de série persistido sem ' + fieldName + ' legível.')
    }
    let text = ''
    if (typeof raw === 'string') {
      text = raw
    } else if (typeof raw === 'object' && typeof raw.string === 'function') {
      try {
        text = raw.string()
      } catch (_) {
        text = ''
      }
    } else if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') {
        throw new ApiError(500, 'Registro de série persistido com ' + fieldName + ' ilegível.')
      }
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
    } else if (typeof raw === 'object') {
      try {
        text = JSON.stringify(raw)
      } catch (_) {
        text = ''
      }
    }
    if (text === '' || text === 'null') {
      throw new ApiError(500, 'Registro de série persistido sem ' + fieldName + ' legível.')
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not object')
      }
      return parsed
    } catch (_) {
      throw new ApiError(500, 'Registro de série persistido com ' + fieldName + ' ilegível.')
    }
  }
  let instants = { created: '', updated: '' }
  try {
    instants.created = series.getDateTime('created').string()
    instants.updated = series.getDateTime('updated').string()
  } catch (_) {
    try {
      instants.created = series.getString('created')
      instants.updated = series.getString('updated')
    } catch (_) {}
  }

  return e.json(200, {
    series: {
      id: series.id,
      user_id: series.getString('user_id'),
      source_action_id: series.getString('source_action_id'),
      status: series.getString('status'),
      revision: series.getInt('revision'),
      rule: readJsonField(series, 'rule'),
      template: readJsonField(series, 'template'),
      created: instants.created,
      updated: instants.updated,
    },
  })
})

// Nenhuma série é ativada, editada ou materializada nesta fatia. Sem endpoint
// de listagem (a leitura de coleção protegida do dono já cobre isso).
