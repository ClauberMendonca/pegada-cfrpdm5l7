// FATIA 6B2B — ADOÇÃO DA FONTE E CICLO DE VIDA DE SÉRIES RECORRENTES — SEM GERADOR.
//
// Rota nativa autenticada (padrão local /backend/v1/):
//   POST /backend/v1/recurrence/series/{seriesId}/state
//
// - Sessão users OBRIGATÓRIA; dono deriva EXCLUSIVAMENTE da sessão (e.auth.id).
//   404 seguro para série inexistente/inacessível (não revela existência).
// - Body JSON ESTRITO: command (activate|pause|resume|stop),
//   expected_lifecycle_version (inteiro seguro >= 0) e, SOMENTE em activate,
//   expected_source_updated (literal UTC/PocketBase exato, sem
//   parsing/trim/truncamento) e expected_revision (inteiro positivo). Campos
//   extras → 400 (inclusive owner/source/status/rule/template/identidade/
//   número/flags). A fonte vem da SÉRIE, nunca do body.
// - UMA runInTransaction (callback VOID, padrão local): releitura FRESCA da
//   série e da fonte via txApp, saves na MESMA txApp; resultado em variável
//   LOCAL da requisição; resposta HTTP só DEPOIS do commit. Sem SQL SELECT FOR
//   UPDATE, $app global, transação paralela, save recursivo, bypass flag ou
//   lock em memória. Sem pacote http (literais numéricos nos status).
// - TABELA DE TRANSIÇÃO (com expected_lifecycle_version == corrente):
//     activate: draft -> active (somente adoção inicial — seção 3)
//     pause:    active -> paused
//     resume:   paused -> active (sem nova adoção)
//     stop:     draft|active|paused -> stopped (terminal: sem activate/resume)
//   Estado-alvo já atingido com identidade coerente e versão corrente:
//   changed:false/duplicate:false, SEM save. activate não substitui resume nem
//   reativa paused/stopped.
// - RETENTATIVA (corrente == expected+1, estado-alvo correto e última
//   transição identificável como MESMO comando): duplicate:true/changed:false,
//   SEM save. activate exige origem draft/versão 0 (resume posterior não é
//   confundido com repetição da ativação). Identidade adotada é confirmada em
//   activate/resume; na repetição de activate NÃO se exige updated da fonte
//   ainda igual ao anterior à adoção. Ambíguo → 409 honesto. Versões
//   obsoletas → 409 MESMO com status aparentemente igual (ABA). Sem
//   retry/ledger/request_id. A versão monotônica protege as transições.
// - ADOÇÃO ATÔMICA (activate em draft/versão 0): reler a fonte do MESMO dono,
//   conferir expected_source_updated LITERAL e expected_revision == revision
//   corrente; tupla comum vazia/0/0. Identidade estrangeira/incompatível ou
//   índice ocupado → 409 sem desvincular/renumerar. Cancelada não é fonte
//   inicial válida; fonte feita sem completed_at conhecido/válido (legado) →
//   409 orienta outra fonte — nunca now/updated/plano/reconclusão como
//   compensação (guarda 93 preserva a âncora: gravação sem transição de
//   status não altera completed_at).
// - Calendário: PRIMEIRA data válida desde start_date pelo avaliador 95 REAL
//   (previewCalendar com from_date = start_date, ordinal 1 — NÃO de hoje).
//   Exige fonte.planned_date igual a ela e planned_timezone compatível com o
//   fuso literal validado da regra. Ausência/plano incoerente/dia ou fuso
//   diferente → 409 orienta ajustar a regra ou escolher outra fonte, sem
//   alterar o plano. Hora existente da fonte é PRESERVADA mesmo se diferente
//   da regra (exceção inicial). Fonte feita pode ser adotada sem inventar
//   conclusão histórica (a âncora não entra no calendário). Nenhuma próxima
//   ocorrência é calculada/gerada aqui.
// - Projeção canônica da fonte (title/description/context/project_id/
//   responsibility_id direto/strategy_id) comparada ao template registrado
//   (mesmo algoritmo de derivação do 104): divergência → 409 para revisar o
//   rascunho — nunca atualiza snapshot/configuração silenciosamente.
// - SAVE DA FONTE: SOMENTE recurrence_series_id = série,
//   recurrence_ordinal = 1, recurrence_revision = revision corrente; em
//   seguida série.status = active e lifecycle_version + 1. Guardas 96 rodam
//   por save interno da MESMA app (sem relaxar requests técnicos). Se
//   qualquer parte falhar, rollback de TODA adoção — nenhum vínculo parcial,
//   nenhum segundo PATCH. A fonte conserva ID/AV-N/title/description/plano/
//   prazo/status/Hoje/próximo avanço/completed_at/parentes/logs/progresso/
//   tempo. Nenhum clone/número/contador novo. A fonte consome a primeira
//   previsão do fim por quantidade (o materializador futuro começa nos
//   ordinais seguintes). Identidade imutável em pausa/parada/reabertura/
//   reconclusão.
// - pause/stop NÃO salvam fonte nem filhos e não exigem vínculos antigos.
//   resume: confirma pertencimento e identidade da fonte (série/ordinal 1/
//   revisão originadora), sem re-adotar. stopped é terminal. API comum de
//   séries continua fechada; campos técnicos de actions seguem protegidos.
// - SAÍDA 200: {series, changed, duplicate, source_adopted}. source_adopted
//   descreve identidade persistida, não promete gravação nesta chamada.
//   Timeout pode significar operação efetivada — consultar estado.
// - active aqui é SOMENTE estado preparado para o gerador FUTURO: nenhuma
//   série real é ativada nesta implementação; sem after-success, consumidor,
//   cron, timer ou serviço residente.
//
// NOTAS JSVM desta instância: lógica INLINE no callback; require dos módulos
// 6A2 DENTRO do callback; runInTransaction com callback VOID; sem pacote http
// (status por literais numéricos 200/400/401/404/409/500).

routerAdd('POST', '/backend/v1/recurrence/series/{seriesId}/state', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id

  const seriesId = e.request.pathValue('seriesId')
  if (typeof seriesId !== 'string' || seriesId.length === 0) {
    throw new NotFoundError('Série de recorrência não encontrada.')
  }

  // ---------- envelope JSON estrito ----------
  const info = e.requestInfo()
  const body = info && info.body ? info.body : null
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Corpo da requisição deve ser um objeto JSON.')
  }

  // Chaves via serialização ida-e-volta (padrão REAL local — wrapper goja).
  let bodyKeys = null
  try {
    bodyKeys = Object.keys(JSON.parse(JSON.stringify(body)))
  } catch (_) {
    bodyKeys = null
  }
  if (bodyKeys === null) {
    throw new BadRequestError('Corpo da requisição não pôde ser verificado.')
  }

  const command = body.command
  if (command !== 'activate' && command !== 'pause' && command !== 'resume' && command !== 'stop') {
    throw new BadRequestError('command deve ser activate, pause, resume ou stop.')
  }

  // Campos extras rejeitados em qualquer comando (400, mesmo valor igual).
  const BASE_FIELDS = ['command', 'expected_lifecycle_version']
  const ACTIVATE_FIELDS = ['expected_source_updated', 'expected_revision']
  for (let i = 0; i < bodyKeys.length; i += 1) {
    const key = bodyKeys[i]
    const isBase = BASE_FIELDS.indexOf(key) >= 0
    const isActivate = command === 'activate' && ACTIVATE_FIELDS.indexOf(key) >= 0
    if (!isBase && !isActivate) {
      throw new BadRequestError('Corpo contém campo não permitido para este comando.')
    }
  }
  const expectedCount = command === 'activate' ? 4 : 2
  if (bodyKeys.length !== expectedCount) {
    throw new BadRequestError(
      command === 'activate'
        ? 'Corpo exige command, expected_lifecycle_version, expected_source_updated e expected_revision.'
        : 'Corpo exige command e expected_lifecycle_version.',
    )
  }

  // expected_lifecycle_version: inteiro seguro >= 0 (sem string/float/boolean).
  const rawExpectedVersion = body.expected_lifecycle_version
  if (
    typeof rawExpectedVersion !== 'number' ||
    !isFinite(rawExpectedVersion) ||
    Math.floor(rawExpectedVersion) !== rawExpectedVersion ||
    rawExpectedVersion < 0 ||
    rawExpectedVersion > 9007199254740991
  ) {
    throw new BadRequestError('expected_lifecycle_version deve ser inteiro >= 0.')
  }

  let expectedSourceUpdated = ''
  let expectedRevision = 0
  if (command === 'activate') {
    expectedSourceUpdated = body.expected_source_updated
    if (typeof expectedSourceUpdated !== 'string' || expectedSourceUpdated.length === 0) {
      throw new BadRequestError(
        'expected_source_updated é obrigatório (literal exato do updated da leitura autenticada da fonte).',
      )
    }
    expectedRevision = body.expected_revision
    if (
      typeof expectedRevision !== 'number' ||
      !isFinite(expectedRevision) ||
      Math.floor(expectedRevision) !== expectedRevision ||
      expectedRevision < 1
    ) {
      throw new BadRequestError('expected_revision deve ser inteiro positivo.')
    }
  }

  // ---------- serialização do persistido (mesma do 104 + lifecycle_version) ----------
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
      lifecycle_version: rec.getInt('lifecycle_version'),
      rule: readJsonField('rule'),
      template: readJsonField('template'),
      created: instants.created,
      updated: instants.updated,
    }
  }

  // ---------- resultado local (resposta só após commit) ----------
  let result = null

  const run = () => {
    e.app.runInTransaction((txApp) => {
      // ---------- série: releitura FRESCA dentro da transação ----------
      let series = null
      try {
        series = txApp.findRecordById('recurrence_series', seriesId)
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
      if (series.getString('user_id') !== userId) {
        // 404 seguro: não revela existência de série de outro dono.
        throw new NotFoundError('Série de recorrência não encontrada.')
      }

      const currentVersion = series.getInt('lifecycle_version')
      const currentStatus = series.getString('status')

      // ---------- comando/versão correntes ----------
      if (rawExpectedVersion === currentVersion) {
        // ----- estado-alvo já atingido, sem save (não é nova transição) -----
        if (
          (command === 'activate' && currentStatus === 'active') ||
          (command === 'pause' && currentStatus === 'paused') ||
          (command === 'resume' && currentStatus === 'active') ||
          (command === 'stop' && currentStatus === 'stopped')
        ) {
          result = { series: series, changed: false, duplicate: false, sourceAdopted: false }
          return
        }
        // ----- transição real pela tabela -----
        if (command === 'activate') {
          if (currentStatus !== 'draft') {
            throw new ApiError(
              409,
              'activate só adota a partir de draft — não reativa paused/stopped nem substitui resume.',
            )
          }
          // ===== ADOÇÃO ATÔMICA (seção 3) =====
          adoptSource(txApp, series, userId, expectedSourceUpdated, expectedRevision, result)
          // adoptSource define result em caso de sucesso; falha interrompe a
          // transação com 409/500 e o rollback reverte toda a adoção.
          return
        }
        if (command === 'pause') {
          if (currentStatus !== 'active') {
            throw new ApiError(409, 'pause exige série ativa.')
          }
          // pause/stop NÃO salvam fonte nem filhos.
          series.set('status', 'paused')
          series.set('lifecycle_version', currentVersion + 1)
          txApp.save(series)
          result = { series: series, changed: true, duplicate: false, sourceAdopted: false }
          return
        }
        if (command === 'resume') {
          if (currentStatus !== 'paused') {
            throw new ApiError(409, 'resume exige série pausada.')
          }
          // Confirmar identidade adotada: pertencimento e fonte com série/
          // ordinal 1/revisão originadora preservados — sem re-adotar.
          const sourceId = series.getString('source_action_id')
          let source = null
          try {
            source = txApp.findRecordById('actions', sourceId)
          } catch (_) {
            throw new ApiError(
              409,
              'Fonte da série não pôde ser confirmada para retomada — consulte o estado atual.',
            )
          }
          if (source.getString('user_id') !== userId) {
            throw new ApiError(409, 'Fonte da série pertence a outro usuário.')
          }
          const identitySeries = source.getString('recurrence_series_id')
          const identityOrdinal = source.getInt('recurrence_ordinal')
          const identityRevision = source.getInt('recurrence_revision')
          if (
            identitySeries !== series.id ||
            identityOrdinal !== 1 ||
            identityRevision !== series.getInt('revision')
          ) {
            throw new ApiError(
              409,
              'Identidade da fonte da série diverge da adoção original — retomada recusa re-adoção.',
            )
          }
          series.set('status', 'active')
          series.set('lifecycle_version', currentVersion + 1)
          txApp.save(series)
          result = { series: series, changed: true, duplicate: false, sourceAdopted: true }
          return
        }
        // command === 'stop'
        if (currentStatus !== 'draft' && currentStatus !== 'active' && currentStatus !== 'paused') {
          throw new ApiError(409, 'Série já está parada (stopped é terminal).')
        }
        series.set('status', 'stopped')
        series.set('lifecycle_version', currentVersion + 1)
        txApp.save(series)
        result = { series: series, changed: true, duplicate: false, sourceAdopted: false }
        return
      }

      // ---------- RETENTATIVA: corrente == expected + 1 ----------
      if (rawExpectedVersion === currentVersion - 1) {
        // Estado-alvo correto e última transição identificável como MESMO comando.
        if (command === 'activate') {
          // Origem obrigatoriamente draft/versão 0 antes da adoção: resume
          // posterior NÃO é confundido com repetição da ativação.
          if (currentStatus === 'active' && currentVersion === 1) {
            // Confirmar identidade adotada (fonte da MESMA série/ordinal 1);
            // na repetição de activate NÃO se exige updated da fonte igual ao
            // anterior à adoção.
            const sourceId = series.getString('source_action_id')
            let adoptSourceRec = null
            try {
              adoptSourceRec = txApp.findRecordById('actions', sourceId)
            } catch (_) {
              adoptSourceRec = null
            }
            if (
              adoptSourceRec &&
              adoptSourceRec.getString('user_id') === userId &&
              adoptSourceRec.getString('recurrence_series_id') === series.id &&
              adoptSourceRec.getInt('recurrence_ordinal') === 1
            ) {
              result = { series: series, changed: false, duplicate: true, sourceAdopted: true }
              return
            }
            // Identidade não confirmável = ambíguo → 409 honesto.
            throw new ApiError(
              409,
              'Não foi possível confirmar a adoção anterior — consulte o estado atual da série.',
            )
          }
          throw new ApiError(
            409,
            'Versão de estado divergente para activate — consulte o estado atual da série.',
          )
        }
        if (command === 'pause') {
          if (currentStatus === 'paused') {
            result = { series: series, changed: false, duplicate: true, sourceAdopted: false }
            return
          }
          // pause antigo após pause/resume não pode ser reaplicado (ABA).
          throw new ApiError(
            409,
            'Versão de estado divergente — transição anterior não é repetição deste comando.',
          )
        }
        if (command === 'resume') {
          if (currentStatus === 'active' && currentVersion > 1) {
            const sourceId = series.getString('source_action_id')
            let resumeSource = null
            try {
              resumeSource = txApp.findRecordById('actions', sourceId)
            } catch (_) {
              resumeSource = null
            }
            if (
              resumeSource &&
              resumeSource.getString('user_id') === userId &&
              resumeSource.getString('recurrence_series_id') === series.id &&
              resumeSource.getInt('recurrence_ordinal') === 1 &&
              resumeSource.getInt('recurrence_revision') === series.getInt('revision')
            ) {
              result = { series: series, changed: false, duplicate: true, sourceAdopted: true }
              return
            }
            throw new ApiError(
              409,
              'Não foi possível confirmar a retomada anterior — consulte o estado atual da série.',
            )
          }
          throw new ApiError(
            409,
            'Versão de estado divergente — transição anterior não é repetição deste comando.',
          )
        }
        // command === 'stop'
        if (currentStatus === 'stopped') {
          result = { series: series, changed: false, duplicate: true, sourceAdopted: false }
          return
        }
        throw new ApiError(
          409,
          'Versão de estado divergente — transição anterior não é repetição deste comando.',
        )
      }

      // ---------- versões obsoletas: 409 MESMO com status aparentemente igual ----------
      throw new ApiError(
        409,
        'expected_lifecycle_version obsoleto — consulte o estado atual da série e repita com a versão corrente.',
      )
    })
  }

  // ---------- ADOÇÃO ATÔMICA: função INLINE ao callback (JSVM da instância) ----------
  const adoptSource = (txApp, series, ownerId, expUpdated, expRevision, out) => {
    // Série em draft/versão 0 é pré-condição do chamador; fonte vem da SÉRIE.
    const sourceId = series.getString('source_action_id')

    // Tupla comum vazia/0/0 (não reparar registros administrativos incoerentes).
    const source = null
    let sourceRec = null
    try {
      sourceRec = txApp.findRecordById('actions', sourceId)
    } catch (err) {
      let msg = ''
      try {
        msg = String(err && err.message ? err.message : '')
      } catch (_) {
        msg = ''
      }
      if (msg.indexOf('no rows') >= 0) {
        throw new ApiError(409, 'Fonte da série não encontrada — escolha outra fonte.')
      }
      throw new ApiError(500, 'Falha ao consultar a fonte da série.')
    }
    if (sourceRec.getString('user_id') !== ownerId) {
      throw new ApiError(409, 'Fonte da série pertence a outro usuário.')
    }
    const emptyVersion = sourceRec.getInt('lifecycle_version')
    const identitySeries = sourceRec.getString('recurrence_series_id')
    const identityOrdinal = sourceRec.getInt('recurrence_ordinal')
    const identityRevision = sourceRec.getInt('recurrence_revision')
    if (identitySeries !== '' || identityOrdinal !== 0 || identityRevision !== 0) {
      throw new ApiError(
        409,
        'Fonte já pertence a uma série de recorrência — sem desvincular ou renumerar.',
      )
    }
    // A variável emptyVersion acima é da SÉRIE (não usada); a checagem real
    // de versão 0 da série está no chamador (currentVersion === 0 exigido por
    // activate em draft + tabela).

    // Cancelada não é fonte inicial válida.
    if (sourceRec.getString('status') === 'cancelada') {
      throw new ApiError(409, 'Avanço cancelado não pode ser fonte inicial de série.')
    }

    // expected_revision: inteiro positivo == revision corrente da série.
    if (expRevision !== series.getInt('revision')) {
      throw new ApiError(
        409,
        'Revisão esperada difere da revisão corrente da série — revise o rascunho.',
      )
    }

    // expected_source_updated: comparação LITERAL (sem parsing/trim/truncamento).
    let freshUpdated = ''
    try {
      freshUpdated = sourceRec.getDateTime('updated').string()
    } catch (_) {
      freshUpdated = ''
    }
    if (freshUpdated === '') {
      try {
        freshUpdated = sourceRec.getString('updated')
      } catch (_) {
        freshUpdated = ''
      }
    }
    if (freshUpdated === '') {
      throw new ApiError(500, 'Falha ao ler o estado atual da fonte.')
    }
    if (freshUpdated !== expUpdated) {
      throw new ApiError(
        409,
        'Fonte mudou desde a leitura — escolha outra fonte ou revise o rascunho com o updated atual.',
      )
    }

    // Fonte feita exige completed_at persistido conhecido/válido; feito legado
    // sem âncora → 409 orienta outra fonte (nunca compensar com agora/updated/
    // plano/reconclusão). O calendário NÃO usa essa âncora.
    if (sourceRec.getString('status') === 'feita') {
      let anchorOk = false
      try {
        const stored = sourceRec.getDateTime('completed_at')
        if (stored && typeof stored.string === 'function') {
          const text = stored.string()
          if (text !== '') {
            const dt = new DateTime(text)
            if (dt && dt.time && typeof dt.time.isZero === 'function' && !dt.time().isZero()) {
              anchorOk = true
            }
          }
        }
      } catch (_) {
        anchorOk = false
      }
      if (!anchorOk) {
        throw new ApiError(
          409,
          'Avanço feito sem conclusão registrada — escolha outra fonte para a série.',
        )
      }
    }

    // ---------- regra/fuso/avaliador: módulos 6A2 REAIS dentro do callback ----------
    let calendar = null
    let tzAdapter = null
    try {
      calendar = require(__hooks + '/lib/recurrence-calendar.js')
      tzAdapter = require(__hooks + '/lib/recurrence-timezone.js')
    } catch (_) {
      calendar = null
      tzAdapter = null
    }
    if (!calendar || typeof calendar.previewCalendar !== 'function') {
      throw new ApiError(500, 'Avaliador do calendário indisponível neste backend.')
    }
    if (!tzAdapter || typeof tzAdapter.resolveTimezone !== 'function') {
      throw new ApiError(500, 'Validação de fuso indisponível neste backend.')
    }

    let ruleObj = null
    try {
      const rawRule = series.get('rule')
      if (typeof rawRule === 'string') {
        ruleObj = JSON.parse(rawRule)
      } else if (rawRule !== null && rawRule !== undefined && typeof rawRule === 'object') {
        if (typeof rawRule.string === 'function') {
          ruleObj = JSON.parse(rawRule.string())
        } else {
          ruleObj = rawRule
        }
      }
    } catch (_) {
      ruleObj = null
    }
    if (ruleObj === null || typeof ruleObj !== 'object' || Array.isArray(ruleObj)) {
      throw new ApiError(500, 'Regra persistida da série ilegível — consulte o estado atual.')
    }

    const ruleCheck = calendar.validateRule(ruleObj)
    if (!ruleCheck.ok) {
      throw new ApiError(409, 'Regra persistida da série inválida — revise o rascunho.')
    }
    const tzCheck = tzAdapter.resolveTimezone(String(ruleObj.timezone || ''))
    if (!tzCheck.ok) {
      throw new ApiError(409, 'Fuso da regra da série inválido — revise o rascunho.')
    }

    // ---------- projeção canônica da fonte vs template registrado ----------
    const rawTitle = sourceRec.getString('title')
    const titleText = rawTitle === null || rawTitle === undefined ? '' : String(rawTitle)
    const dot = titleText.indexOf(' — ')
    const pureTitle = dot > 0 ? titleText.slice(0, dot) : titleText
    const trimmedTitle = pureTitle.trim()

    const projection = { version: 1, title: trimmedTitle, context: sourceRec.getString('context') }
    const rawDescription = sourceRec.getString('description')
    if (rawDescription !== null && rawDescription !== undefined && String(rawDescription) !== '') {
      projection.description = String(rawDescription)
    }
    const projProjectId = sourceRec.getString('project_id')
    if (projProjectId !== '') {
      projection.project_id = String(projProjectId)
    }
    const projResponsibilityId = sourceRec.getString('responsibility_id')
    if (projResponsibilityId !== '') {
      projection.responsibility_id = String(projResponsibilityId)
    }
    const projStrategyId = sourceRec.getString('strategy_id')
    if (projStrategyId !== '') {
      projection.strategy_id = String(projStrategyId)
    }

    let templateObj = null
    try {
      const rawTpl = series.get('template')
      if (typeof rawTpl === 'string') {
        templateObj = JSON.parse(rawTpl)
      } else if (rawTpl !== null && rawTpl !== undefined && typeof rawTpl === 'object') {
        if (typeof rawTpl.string === 'function') {
          templateObj = JSON.parse(rawTpl.string())
        } else {
          templateObj = rawTpl
        }
      }
    } catch (_) {
      templateObj = null
    }
    if (templateObj === null || typeof templateObj !== 'object' || Array.isArray(templateObj)) {
      throw new ApiError(500, 'Template persistido da série ilegível — consulte o estado atual.')
    }
    // Divergência → 409 para revisar o rascunho — nunca atualizar snapshot/
    // configuração silenciosamente.
    let templateDiverged = false
    try {
      templateDiverged = JSON.stringify(projection) !== JSON.stringify(templateObj)
    } catch (_) {
      templateDiverged = true
    }
    if (templateDiverged) {
      throw new ApiError(
        409,
        'Fonte diverge do template registrado da série — revise o rascunho antes de adotar.',
      )
    }

    // ---------- calendário: PRIMEIRA data válida desde start_date (ordinal 1) ----------
    const first = calendar.previewCalendar(ruleObj, String(ruleObj.start_date), 1)
    if (first === null || first.state !== 'pronto' || !first.dates || first.dates.length === 0) {
      throw new ApiError(
        409,
        'Regra da série não produz a primeira ocorrência desde o começo — ajuste a regra ou escolha outra fonte.',
      )
    }
    const firstDate = String(first.dates[0].date)
    if (String(first.dates[0].ordinal) !== '1') {
      throw new ApiError(
        409,
        'Regra da série não produz ordinal 1 desde o começo — ajuste a regra ou escolha outra fonte.',
      )
    }

    // planned_date da fonte IGUAL à primeira data; fuso compatível com o
    // literal validado da regra. Hora existente da fonte é PRESERVADA (pode
    // divergir da regra — exceção inicial).
    const sourcePlannedDate = sourceRec.getString('planned_date')
    if (sourcePlannedDate === '' || sourcePlannedDate !== firstDate) {
      throw new ApiError(
        409,
        'Plano da fonte difere da primeira data da regra — ajuste a regra ou escolha outra fonte (o plano não é alterado aqui).',
      )
    }
    const sourcePlannedTz = sourceRec.getString('planned_timezone')
    const ruleTz = String(ruleObj.timezone)
    // Compatibilidade LITERAL com o fuso validado da regra (resolves p/ mesma
    // zona nativa). planned_timezone vazio só é aceito quando a regra é UTC.
    let tzCompatible = false
    if (sourcePlannedTz === '') {
      tzCompatible = ruleTz === 'UTC'
    } else {
      const srcTzCheck = tzAdapter.resolveTimezone(sourcePlannedTz)
      if (srcTzCheck.ok && ruleTz === srcTzCheck.zone.string()) {
        tzCompatible = true
      } else if (srcTzCheck.ok && srcTzCheck.zone.string() !== '' && ruleTz !== '') {
        // Ambos resolvem para zonas distintas → incompatível.
        tzCompatible = srcTzCheck.zone.string() === ruleTz
      }
    }
    if (!tzCompatible) {
      throw new ApiError(
        409,
        'Fuso do plano da fonte difere do fuso da regra — ajuste a regra ou escolha outra fonte (o plano não é alterado aqui).',
      )
    }

    // ---------- save da fonte: SOMENTE os três campos de identidade ----------
    // Guardas 96 (onRecordValidate de actions) rodam neste save interno da
    // MESMA app; guarda 93 (action-completion) NÃO altera completed_at em
    // gravação sem transição de status. Nenhum clone/número/contador novo.
    sourceRec.set('recurrence_series_id', series.id)
    sourceRec.set('recurrence_ordinal', 1)
    sourceRec.set('recurrence_revision', series.getInt('revision'))
    try {
      txApp.save(sourceRec)
    } catch (err) {
      // Falha de guarda/índice → rollback de TODA a adoção (nenhum vínculo
      // parcial, nenhum segundo PATCH); a fonte conserva tudo.
      throw new ApiError(409, 'Vínculo da fonte à série foi recusado pelas guardas de modelo.')
    }

    // ---------- série: status active e lifecycle_version + 1 (MESMA tx) ----------
    series.set('status', 'active')
    series.set('lifecycle_version', series.getInt('lifecycle_version') + 1)
    txApp.save(series)

    // Fonte consome a primeira previsão do fim por quantidade (materializador
    // futuro começa nos ordinais seguintes). Nenhuma próxima ocorrência é
    // gerada aqui.
    out.series = series
    out.changed = true
    out.duplicate = false
    out.sourceAdopted = true
  }

  // Sem transação paralela/execução fora do fluxo: run() é o único caminho.
  try {
    run()
  } catch (err) {
    // Repassar erros de API como estão (status/statusText/preservados nativos).
    throw err
  }

  if (!result) {
    throw new ApiError(500, 'Falha interna ao aplicar o comando de estado.')
  }

  return e.json(200, {
    series: serializeSeries(result.series),
    changed: result.changed === true,
    duplicate: result.duplicate === true,
    source_adopted: result.sourceAdopted === true,
  })
})

// Nenhum after-success, consumidor, cron, timer ou serviço residente nesta
// fatia. Nenhuma série real é ativada aqui.
