// FATIA 6B1 — SÉRIES RECORRENTES: GUARDA DE MODELO E DE REQUEST (fundação).
//
// Escopo: coleção NOVA `recurrence_series` (migration 0015) e os TRÊS campos
// técnicos de identidade de `actions` (recurrence_series_id, recurrence_ordinal,
// recurrence_revision). NADA de geração, comandos, rotas, editor ou UI nesta
// fatia — nenhuma série é criada ou ativada aqui.
//
// Pontos de modelo (onRecordValidate — alcança API comum, painel e saves
// internos/txApp; falha → nada persiste; sucesso → e.next() encadeia):
//
// 1. recurrence_series: dono/fonte imutáveis por natureza do caminho (createRule
//    nula — escrita só interna), status draft|active|paused|stopped com criação
//    SEMPRE draft (valor omitido não ativa), rule JSON objeto regra v1 validada
//    pelo avaliador puro 6A2 (recurrence-calendar.validateRule) + fuso nativo
//    (recurrence-timezone.resolveTimezone), template JSON objeto com EXATAMENTE
//    version:1 e APENAS title/description/context/project_id/responsibility_id/
//    strategy_id (título simples obrigatório; pais existentes do mesmo dono e
//    contexto; strategy só com project_id compatível e ativa; responsibility
//    direta somente sem Resultado), revision inteiro positivo (criação sem
//    valor = 1; até existir comando próprio, não muda fora de draft).
//    after_completion sem âncora é ACEITO (validateRule não exige próxima data).
//
// 2. actions (tupla de identidade, vazio canônico é ''/0):
//    - Série vazia exige ordinal 0 e revisão 0; série informada exige ordinal >= 1
//      e revisão >= 1; série do MESMO dono do Avanço; nada é inferido de
//      planned_date, posição, título, conclusão ou sequence_number.
//    - Uma vez persistida identidade (série + ordinal >= 1 + revisão >= 1), ela
//      NÃO pode ser trocada/removida em edição normal — a guarda compara contra
//      o estado PERSISTIDO e rejeita qualquer mudança da tupla, inclusive
//      tentativa de gravar vazio/0 por cima.
//    - Atribuição inicial vazio→identidade é permitida em save interno (sem
//      exigir sessão, sem flag de bypass) para o comando nativo FUTURO.
//
// Ponto de request (onRecordCreateRequest/onRecordUpdateRequest de actions):
// campos técnicos de identidade NÃO são editáveis pelo cliente comum. A guarda
// inspeciona o PAYLOAD BRUTO (e.requestInfo().body — presença, inclusive vazio/
// 0/valor igual, rejeita; omissão do campo passa ilesa). Sem reenvio por spread
// no app, POST/PATCH normais seguem intactos. Texto do body NUNCA vai no erro.
// Superusuário mantém acesso administrativo (contorna por design).
//
// JSON: wrappers nativos (goja) são convertidos para objeto simples pelo padrão
// REAL local (time-entries.pb.js: string/varredura de bytes/parse). Parse falho
// NUNCA é tratado como regra vazia — é rejeição explícita.
//
// NOTAS JSVM desta instância: lógica INLINE nos callbacks (declarações de topo
// não são compartilhadas entre pools de requisição); require dos módulos 6A2
// DENTRO do callback; runInTransaction não é usado aqui (nenhum save nesta
// guarda); sem pacote http (nenhuma rota é criada nesta fatia).

// =========================== recurrence_series ===========================

onRecordValidate((e) => {
  // --- conversão de wrapper JSON para objeto simples (padrão REAL local) ---
  // undefined = entrada não-objeto/parse falho → rejeição explícita.
  const plainObjectOrNull = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null
    if (typeof raw === 'string') {
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch (_) {
        return undefined
      }
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        return undefined
      }
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
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        return undefined
      }
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
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        return undefined
      }
      return parsed
    }
    if (typeof raw === 'object') return raw
    return undefined
  }

  // Chaves de um objeto (wrapper goja pode não expor Object.keys) — via
  // serialização ida-e-volta. Falha → null (rejeição explícita).
  const keysOf = (obj) => {
    let text = ''
    try {
      text = JSON.stringify(obj)
    } catch (_) {
      return null
    }
    if (typeof text !== 'string' || text.length === 0 || text.charAt(0) !== '{') return null
    try {
      return Object.keys(JSON.parse(text))
    } catch (_) {
      return null
    }
  }

  // --- regra v1: estrutura/calendário pelo avaliador puro 6A2 + fuso nativo ---
  const rec = e.record
  const ruleObj = plainObjectOrNull(rec.get('rule'))
  if (ruleObj === null || ruleObj === undefined) {
    throw new BadRequestError('Regra da série é obrigatória (objeto JSON da regra v1).')
  }

  let calendar = null
  let tzAdapter = null
  try {
    calendar = require(__hooks + '/lib/recurrence-calendar.js')
    tzAdapter = require(__hooks + '/lib/recurrence-timezone.js')
  } catch (_) {
    throw new BadRequestError(
      'Validação da regra indisponível neste backend — série não pode ser gravada sem verificação da regra.',
    )
  }
  if (!calendar || typeof calendar.validateRule !== 'function') {
    throw new BadRequestError(
      'Validação da regra indisponível neste backend — série não pode ser gravada sem verificação da regra.',
    )
  }

  const ruleCheck = calendar.validateRule(ruleObj)
  if (!ruleCheck.ok) {
    const first = ruleCheck.errors && ruleCheck.errors.length > 0 ? ruleCheck.errors[0] : null
    const why = first && first.field ? ' (' + String(first.field) + ')' : ''
    throw new BadRequestError('Regra da série inválida' + why + '.')
  }

  // Existência do nome IANA é da camada nativa de fuso (nunca troca por UTC).
  if (!tzAdapter || typeof tzAdapter.resolveTimezone !== 'function') {
    throw new BadRequestError(
      'Validação de fuso indisponível neste backend — série não pode ser gravada sem verificação do fuso.',
    )
  }
  const tzCheck = tzAdapter.resolveTimezone(String(ruleObj.timezone || ''))
  if (!tzCheck.ok) {
    throw new BadRequestError(
      'Fuso da regra da série inválido: informe nome IANA explícito (ex.: America/Sao_Paulo) ou UTC.',
    )
  }

  // --- template v1: version:1 e APENAS os seis campos do contrato ---
  const tpl = plainObjectOrNull(rec.get('template'))
  if (tpl === null || tpl === undefined) {
    throw new BadRequestError('Template da série é obrigatório (objeto JSON v1).')
  }
  const tplKeys = keysOf(tpl)
  if (tplKeys === null) {
    throw new BadRequestError('Template da série não pôde ser verificado.')
  }
  const ALLOWED = [
    'version',
    'title',
    'description',
    'context',
    'project_id',
    'responsibility_id',
    'strategy_id',
  ]
  for (let i = 0; i < tplKeys.length; i += 1) {
    if (ALLOWED.indexOf(tplKeys[i]) < 0) {
      throw new BadRequestError('Template da série contém campo não permitido.')
    }
  }
  if (tpl.version !== 1) {
    throw new BadRequestError('Template da série exige version:1.')
  }
  if (typeof tpl.title !== 'string' || tpl.title.trim() === '') {
    throw new BadRequestError('Título do template da série é obrigatório (texto simples).')
  }
  if (tpl.title.length > 200) {
    throw new BadRequestError('Título do template da série excede 200 caracteres.')
  }
  if (tpl.description !== undefined && tpl.description !== null && tpl.description !== '') {
    if (typeof tpl.description !== 'string' || tpl.description.length > 3000) {
      throw new BadRequestError('Descrição do template da série inválida (máx. 3000).')
    }
  }
  if (tpl.context !== 'vida' && tpl.context !== 'trabalho') {
    throw new BadRequestError('Contexto do template da série deve ser vida ou trabalho.')
  }

  // --- pais do template: existentes, mesmo dono, contexto coerente ---
  const userId = rec.getString('user_id')
  if (userId === '') {
    throw new BadRequestError('Série exige dono (user_id).')
  }
  const projectId = tpl.project_id ? String(tpl.project_id) : ''
  const responsibilityId = tpl.responsibility_id ? String(tpl.responsibility_id) : ''
  const strategyId = tpl.strategy_id ? String(tpl.strategy_id) : ''

  if (projectId) {
    let project = null
    try {
      project = e.app.findRecordById('projects', projectId)
    } catch (_) {
      throw new BadRequestError('Resultado do template inválido.')
    }
    if (project.getString('user_id') !== userId) {
      throw new ForbiddenError('Resultado do template pertence a outro usuário.')
    }
    if (project.getString('context') !== tpl.context) {
      throw new BadRequestError('Contexto do template difere do contexto do Resultado.')
    }
    if (responsibilityId) {
      // Responsabilidade direta SOMENTE sem Resultado (com Resultado fica
      // vazia — herança é leitura do pai).
      throw new BadRequestError(
        'Responsabilidade direta do template só existe sem Resultado (com Resultado, herança do pai).',
      )
    }
    if (strategyId) {
      // Estratégia só com project_id compatível e ativa (vínculo novo).
      let strategy = null
      try {
        strategy = e.app.findRecordById('strategies', strategyId)
      } catch (_) {
        throw new BadRequestError('Estratégia do template inválida.')
      }
      if (strategy.getString('user_id') !== userId) {
        throw new ForbiddenError('Estratégia do template pertence a outro usuário.')
      }
      if (strategy.getString('project_id') !== projectId) {
        throw new BadRequestError('Estratégia do template pertence a outro Resultado.')
      }
      if (strategy.getString('status') !== 'ativa') {
        throw new BadRequestError('Estratégia do template deve estar ativa (vínculo novo).')
      }
    }
  } else if (strategyId) {
    throw new BadRequestError('Estratégia do template exige Resultado no template.')
  }

  if (responsibilityId && !projectId) {
    let responsibility = null
    try {
      responsibility = e.app.findRecordById('responsibilities', responsibilityId)
    } catch (_) {
      throw new BadRequestError('Responsabilidade do template inválida.')
    }
    if (responsibility.getString('user_id') !== userId) {
      throw new ForbiddenError('Responsabilidade do template pertence a outro usuário.')
    }
    if (responsibility.getString('context') !== tpl.context) {
      throw new BadRequestError('Contexto do template difere do contexto da Responsabilidade.')
    }
  }

  // --- fonte: Avanço existente do MESMO dono (pertencimento, não cópia) ---
  const sourceId = rec.getString('source_action_id')
  if (sourceId === '') {
    throw new BadRequestError('Série exige Avanço de origem (source_action_id).')
  }
  let source = null
  try {
    source = e.app.findRecordById('actions', sourceId)
  } catch (_) {
    throw new BadRequestError('Avanço de origem da série inválido.')
  }
  if (source.getString('user_id') !== userId) {
    throw new ForbiddenError('Avanço de origem da série pertence a outro usuário.')
  }

  // --- status/revision: criação SEMPRE draft, revision inicial/fixa em 1 ---
  const isNew = rec.id === '' || rec.original() === null
  const status = rec.getString('status')
  if (isNew) {
    if (status !== '' && status !== 'draft') {
      throw new BadRequestError('Criação de série começa em draft — valor omitido não ativa.')
    }
    rec.set('status', 'draft')
    const rev = rec.getInt('revision')
    if (rev !== 0 && rev !== 1) {
      throw new BadRequestError('Revisão inicial da série é 1.')
    }
    rec.set('revision', 1)
  } else {
    // Sem comando próprio ainda: rule/template/revision não mudam fora de draft.
    // Comparação de mudança é por CHAVES/valores essenciais (wrapper não tem
    // JSON.stringify estável entre pools).
    const orig = rec.original()
    const persistedStatus = orig.getString('status')
    const revisionChanged = rec.getInt('revision') !== orig.getInt('revision')
    const sameText = (a, b) => {
      const ta = a === null || a === undefined ? '' : String(a)
      const tb = b === null || b === undefined ? '' : String(b)
      return ta === tb
    }
    let ruleChanged = true
    let tplChanged = true
    try {
      ruleChanged = !sameText(
        JSON.stringify(plainObjectOrNull(orig.get('rule')) || {}),
        JSON.stringify(ruleObj),
      )
      tplChanged = !sameText(
        JSON.stringify(plainObjectOrNull(orig.get('template')) || {}),
        JSON.stringify(tpl),
      )
    } catch (_) {
      ruleChanged = true
      tplChanged = true
    }
    if (persistedStatus !== 'draft' && (ruleChanged || tplChanged || revisionChanged)) {
      throw new BadRequestError(
        'Regra/template/revisão da série só podem mudar em draft (nenhum comando de edição existe ainda).',
      )
    }
    if (revisionChanged) {
      throw new BadRequestError('Revisão da série não pode mudar nesta fundação (fica em 1).')
    }
    // Dono/fonte imutáveis também em edição interna.
    if (rec.getString('user_id') !== orig.getString('user_id')) {
      throw new BadRequestError('Dono da série é imutável.')
    }
    if (rec.getString('source_action_id') !== orig.getString('source_action_id')) {
      throw new BadRequestError('Avanço de origem da série é imutável.')
    }
  }
  e.next()
}, 'recurrence_series')

// =================== actions: tupla de identidade (modelo) ===================

onRecordValidate((e) => {
  const rec = e.record
  const seriesId = rec.getString('recurrence_series_id')
  const ordinal = rec.getInt('recurrence_ordinal')
  const revision = rec.getInt('recurrence_revision')

  // Estado PERSISTIDO (não snapshot stale): e.record.original() quando existe.
  let persistedSeries = ''
  let persistedOrdinal = 0
  let persistedRevision = 0
  let hasPersisted = false
  try {
    const orig = rec.original()
    if (orig !== null && orig.id !== '') {
      hasPersisted = true
      persistedSeries = orig.getString('recurrence_series_id')
      persistedOrdinal = orig.getInt('recurrence_ordinal')
      persistedRevision = orig.getInt('recurrence_revision')
    }
  } catch (_) {
    hasPersisted = false
  }

  if (hasPersisted) {
    // Identidade já persistida NÃO pode ser trocada/removida em edição normal —
    // nem por vazio/0. Atribuição inicial (vazio→identidade) segue permitida
    // para o comando nativo FUTURO (save interno, sem sessão, sem bypass).
    const hadIdentity = persistedSeries !== ''
    const hasIdentityNow = seriesId !== ''
    if (hadIdentity) {
      const identityChanged =
        seriesId !== persistedSeries ||
        ordinal !== persistedOrdinal ||
        revision !== persistedRevision
      if (identityChanged) {
        throw new BadRequestError(
          'Identidade de recorrência deste Avanço é imutável — não pode ser trocada ou removida.',
        )
      }
      if (seriesId !== '') {
        // Série do MESMO dono do Avanço; ordinal/revisão positivos coerentes.
        const userId = rec.getString('user_id')
        if (userId === '') {
          throw new BadRequestError('Avanço sem dono definido.')
        }
        let series = null
        try {
          series = e.app.findRecordById('recurrence_series', seriesId)
        } catch (_) {
          throw new BadRequestError('Série de recorrência deste Avanço inválida.')
        }
        if (series.getString('user_id') !== userId) {
          throw new ForbiddenError('Série de recorrência pertence a outro usuário.')
        }
        if (ordinal < 1 || revision < 1) {
          throw new BadRequestError(
            'Ocorrência vinculada a série exige ordinal e revisão positivos.',
          )
        }
      }
    } else if (hasIdentityNow) {
      // Atribuição inicial vazio→identidade: valida tupla e mesmo dono.
      if (ordinal < 1 || revision < 1) {
        throw new BadRequestError('Ocorrência vinculada a série exige ordinal e revisão positivos.')
      }
      const userId = rec.getString('user_id')
      if (userId === '') {
        throw new BadRequestError('Avanço sem dono definido.')
      }
      let series = null
      try {
        series = e.app.findRecordById('recurrence_series', seriesId)
      } catch (_) {
        throw new BadRequestError('Série de recorrência deste Avanço inválida.')
      }
      if (series.getString('user_id') !== userId) {
        throw new ForbiddenError('Série de recorrência pertence a outro usuário.')
      }
      const seriesRevision = series.getInt('revision')
      if (revision > seriesRevision) {
        throw new BadRequestError(
          'Revisão da identidade não pode exceder a versão corrente da série.',
        )
      }
      if (seriesRevision !== 1) {
        throw new BadRequestError('Identidade só pode ser atribuída com a versão corrente (1).')
      }
    }
  } else {
    // Criação: tupla coerente (série vazia ⇒ ordinal 0/revisão 0; série
    // informada ⇒ ambos >= 1), série do MESMO dono.
    if (seriesId === '') {
      if (ordinal !== 0 || revision !== 0) {
        throw new BadRequestError(
          'Avanço sem série não pode ter ordinal ou revisão de recorrência.',
        )
      }
    } else {
      if (ordinal < 1 || revision < 1) {
        throw new BadRequestError('Ocorrência vinculada a série exige ordinal e revisão positivos.')
      }
      const userId = rec.getString('user_id')
      if (userId === '') {
        throw new BadRequestError('Avanço sem dono definido.')
      }
      let series = null
      try {
        series = e.app.findRecordById('recurrence_series', seriesId)
      } catch (_) {
        throw new BadRequestError('Série de recorrência deste Avanço inválida.')
      }
      if (series.getString('user_id') !== userId) {
        throw new ForbiddenError('Série de recorrência pertence a outro usuário.')
      }
      const seriesRevision = series.getInt('revision')
      if (revision > seriesRevision) {
        throw new BadRequestError(
          'Revisão da identidade não pode exceder a versão corrente da série.',
        )
      }
      if (seriesRevision !== 1) {
        throw new BadRequestError('Identidade só pode ser atribuída com a versão corrente (1).')
      }
    }
  }
  e.next()
}, 'actions')

// ============ actions: campos técnicos fora do alcance do cliente ============

// Inspeciona o PAYLOAD BRUTO: presença (inclusive vazio/0/valor igual) é
// rejeitada; omissão passa. Texto do body NUNCA vai na mensagem de erro.
// Superusuário mantém acesso administrativo (contorna por design).
// JSVM desta instância não acessa declarações de topo: a lista de campos vai
// INLINE em cada callback (padrão vigente).
onRecordCreateRequest((e) => {
  const fields = ['recurrence_series_id', 'recurrence_ordinal', 'recurrence_revision']
  const body = e.requestInfo().body
  for (let i = 0; i < fields.length; i += 1) {
    if (body && body[fields[i]] !== undefined) {
      throw new BadRequestError('Campo técnico de recorrência não é editável pelo cliente.')
    }
  }
  e.next()
}, 'actions')

onRecordUpdateRequest((e) => {
  const fields = ['recurrence_series_id', 'recurrence_ordinal', 'recurrence_revision']
  const body = e.requestInfo().body
  for (let i = 0; i < fields.length; i += 1) {
    if (body && body[fields[i]] !== undefined) {
      throw new BadRequestError('Campo técnico de recorrência não é editável pelo cliente.')
    }
  }
  e.next()
}, 'actions')

// ============ proteção da fonte: exclusão de Avanço referenciado ============

// Bloqueia exclusão comum da FONTE enquanto qualquer série a referencia e de
// qualquer Avanço COM identidade — sem desvincular/renumerar. Falha na
// contagem bloqueia (fail-closed); superusuário/SQL direto podem contornar
// por design (alcance declarado, não segurança absoluta).
onRecordDelete((e) => {
  const rec = e.record
  if (rec.getString('recurrence_series_id') !== '') {
    throw new BadRequestError('Avanço com identidade de recorrência não pode ser excluído.')
  }
  let referencing = 1 // fail-closed: só libera se a contagem rodar e vier 0
  try {
    referencing = e.app.countRecords('recurrence_series', "source_action_id = '" + rec.id + "'")
  } catch (_) {
    referencing = 1
  }
  if (referencing > 0) {
    throw new BadRequestError(
      'Avanço de origem de série recorrente não pode ser excluído enquanto a série existir.',
    )
  }
  e.next()
}, 'actions')

// Nenhuma série é criada ou ativada nesta fatia.
