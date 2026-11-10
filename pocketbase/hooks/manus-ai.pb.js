// FATIA M1A — Base Manus no backend, DESLIGADA por padrão.
//
// Rotas nativas autenticadas (prefixo /backend/v1/ — routerAdd não acrescenta
// prefixo; /api/ é reservado ao PocketBase):
//   POST /backend/v1/ai/clarify                body: { capture_id, context, local_request_id }
//   GET  /backend/v1/ai/requests/{id}          (consulta local; sincroniza só com gate ON)
//   POST /backend/v1/ai/requests/{id}/answer   body: { text, answer_request_id? }
//
// Regras duráveis desta fatia:
// - GATE server-side EXCLUSIVO: $os.getenv('MANUS_AI_ENABLED') ausente/"0"/
//   "false" desliga TUDO. A existência da chave NÃO ativa. Com gate OFF, nada
//   é persistido nem chamado — 503 "Integração Manus desligada/não configurada"
//   (nunca resultado fictício). Motivo para NÃO persistir: uma intenção
//   'registrado' criada hoje ficaria presa quando o gate for ligado depois
//   (o dedup por local_request_id a traria como duplicate sem POST remoto).
// - Chave MANUS_API_KEY lida via $os.getenv, usada APENAS no header
//   x-manus-api-key — nunca em prompt, resposta, log, migration ou payload.
// - NENHUMA chamada a api.manus.ai nesta rodada (gate OFF): o adaptador
//   manusCall é exercitado só por mocks locais (scripts/manus-ai-fixtures.mjs).
// - Intenção local persistida ANTES do POST (state 'registrado'); falha do POST
//   deixa 'criacao_incerta' (request_id só se recebido), SEM reenvio
//   automático, sem revogar/limpar nada. Dedup local ≠ exactly-once remoto.
// - HTTP externo FORA de transação; runInTransaction void (resultado em
//   variável local; resposta HTTP só após commit, status numérico — JSVM não
//   expõe o pacote http).
// - Hooks não acessam declarações de topo: helpers são funções DENTRO de cada
//   callback (cópia por rota).
// - NÃO codificar stop/cancel nem task.confirmAction nesta fatia. Timeout de
//   consulta ≠ cancelamento remoto: nada vira "cancelada" sem confirmação.
//
// NOTA (aplicação futura atômica): converter o resultado em action/project
// NÃO é implementado aqui (capture-convert.pb.js intocado). Quando for,
// REVALIDAR dono da sessão, estado atual da captura e origin_revision gravada
// contra a origem viva antes de gravar — atomicamente.

routerAdd('POST', '/backend/v1/ai/clarify', (e) => {
  // ---------- gate ----------
  const enabledRaw = $os.getenv('MANUS_AI_ENABLED') || ''
  const enabledVal = String(enabledRaw).trim().toLowerCase()
  const enabled = enabledVal === '1' || enabledVal === 'true' || enabledVal === 'yes'
  if (!enabled) {
    throw new ApiError(503, 'Integração Manus desligada/não configurada.')
  }

  // ---------- helpers (inline: JSVM não enxerga declarações de topo) ----------
  function str(v) {
    return typeof v === 'string' ? v.trim() : ''
  }
  function sanitizeErr(err, resp) {
    // Nunca ecoar headers/corpo bruto (podem conter credenciais).
    if (resp && typeof resp.statusCode === 'number') {
      return 'Manus respondeu HTTP ' + resp.statusCode + '.'
    }
    if (err && err.message && String(err.message).indexOf('timeout') >= 0) {
      return 'Timeout contatando Manus.'
    }
    return 'Falha de rede contatando Manus.'
  }
  function manusCall(apiKey, method, path, bodyObj, timeoutSec) {
    const resp = $http.send({
      url: 'https://api.manus.ai' + path,
      method: method,
      headers: { 'x-manus-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: timeoutSec || 15,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
    })
    return resp
  }
  function parseCreateResponse(resp) {
    if (!resp || typeof resp.statusCode !== 'number' || resp.statusCode >= 300) {
      return { ok: false, error: sanitizeErr(null, resp) }
    }
    const j = resp.json
    const taskId = j ? str(j.task_id) || str(j.taskId) || str(j.id) : ''
    if (!taskId) return { ok: false, error: 'Resposta de criação sem task_id.' }
    return {
      ok: true,
      taskId: taskId,
      taskUrl: j ? str(j.task_url) || str(j.url) || str(j.share_url) : '',
      requestId: j ? str(j.request_id) || str(j.requestId) : '', // só se recebido
    }
  }
  function buildCreatePrompt(rawText, context) {
    return (
      'Contexto do dono: ' +
      context +
      '.\n' +
      'Captura original (texto bruto, não alterar): "' +
      rawText +
      '".\n' +
      'Tarefa: esclarecer a intenção desta captura. Regras estritas:\n' +
      '(1) Faltam dados, há espera ou decisão pendente? Responda com kind=' +
      '"esclarecimento" e a pergunta/explicação em explanation — NÃO invente ' +
      'proposta. Esclarecimento sem conversão é um resultado válido.\n' +
      '(2) Só proponha (proposal) quando houver dados suficientes: kind=' +
      '"projeto" (título, contexto, aspiração, entrega controlável, condição de ' +
      'término — campos faltantes em null) ou kind="acao" (título e contexto ' +
      'apenas).\n' +
      '(3) Sugira um próximo avanço em next_step_suggestion sem alegar que ' +
      'qualquer coisa já foi gravada ou convertida.\n' +
      '(4) Nunca repita dados do dono para fora; nada de credenciais ou links ' +
      'de outras tarefas.'
    )
  }
  function buildCreatePayload(rec, rawText) {
    // Contrato Manus v2 (fixo server-side; cliente nunca manda id/URL/chave).
    return {
      message: { content: buildCreatePrompt(rawText, rec.getString('context')) },
      project_id: 'QYbSBGo5T5KRsS2p9X8XYv',
      clear_connectors: true,
      interactive_mode: true,
      share_visibility: 'private',
      hide_in_task_list: false,
      profile: 'standard', // perfil standard explícito
      structured_output_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['esclarecimento', 'projeto', 'acao'] },
          missing_data: { type: 'boolean' },
          waiting_or_decision: { type: 'boolean' },
          explanation: { type: 'string' },
          proposal: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['projeto', 'acao'] },
                  title: { type: 'string' },
                  context: { type: 'string', enum: ['vida', 'trabalho'] },
                  aspiration: { type: ['string', 'null'] },
                  controllable_delivery: { type: ['string', 'null'] },
                  completion_condition: { type: ['string', 'null'] },
                },
                required: [
                  'kind',
                  'title',
                  'context',
                  'aspiration',
                  'controllable_delivery',
                  'completion_condition',
                ],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
          next_step_suggestion: { type: ['string', 'null'] },
        },
        required: [
          'kind',
          'missing_data',
          'waiting_or_decision',
          'explanation',
          'proposal',
          'next_step_suggestion',
        ],
        additionalProperties: false,
      },
    }
  }
  function markUncertain(app, rec, msg) {
    rec.set('state', 'criacao_incerta')
    rec.set('error', msg)
    app.save(rec)
  }
  function serializeRequest(r) {
    const q = r.get('question')
    return {
      id: r.id,
      user_id: r.getString('user_id'),
      origin_type: r.getString('origin_type'),
      origin_id: r.getString('origin_id'),
      origin_revision: r.getString('origin_revision'),
      context: r.getString('context'),
      local_request_id: r.getString('local_request_id'),
      remote_task_id: r.getString('remote_task_id') || undefined,
      remote_request_id: r.getString('remote_request_id') || undefined,
      task_url: r.getString('task_url') || undefined,
      schema_version: r.getString('schema_version'),
      prompt_revision: r.getString('prompt_revision'),
      state: r.getString('state'),
      question: q && typeof q === 'object' ? q : undefined,
      result: r.get('result') || undefined,
      last_polled_at: r.getString('last_polled_at') || undefined,
      error: r.getString('error') || undefined,
      created: r.getString('created'),
      updated: r.getString('updated'),
    }
  }

  // ---------- entrada ----------
  const info = e.requestInfo()
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id
  const body = info.body || {}
  const captureId = str(body.capture_id)
  const context = body.context
  if (!captureId) throw new BadRequestError('capture_id é obrigatório.')
  if (context !== 'vida' && context !== 'trabalho') {
    // Capturas não têm campo context — a escolha é EXPLÍCITA, nunca inferida.
    throw new BadRequestError('context é obrigatório e deve ser "vida" ou "trabalho".')
  }
  const localRequestId = str(body.local_request_id)
  if (!localRequestId) {
    throw new BadRequestError('local_request_id é obrigatório (idempotência por dono).')
  }

  // ---------- chave: exigida antes de persistir (evita intenção presa) ----------
  const apiKey = $os.getenv('MANUS_API_KEY') || ''
  if (!apiKey) {
    throw new ApiError(503, 'Integração Manus desligada/não configurada.')
  }

  // ---------- origem: captura PENDENTE do dono ----------
  let capture
  try {
    capture = e.app.findRecordById('captures', captureId)
  } catch (_) {
    throw new NotFoundError('Captura não encontrada.')
  }
  if (capture.getString('user_id') !== userId) {
    throw new ForbiddenError('Captura pertence a outro usuário.')
  }
  if (capture.getString('status') !== 'pendente') {
    throw new ApiError(409, 'Captura não está mais pendente.')
  }
  const rawText = capture.getString('raw_text')
  // revisão da origem: raw_text + updated no instante do pedido
  const originRevision = rawText + '|' + capture.getString('updated')

  const SCHEMA_VERSION = '2026-11-10'
  const PROMPT_REVISION = 'm1a-1'

  // ---------- dedup local (fora da transação, leitura apenas) ----------
  let existing = null
  try {
    existing = e.app.findFirstRecordByFilter(
      'ai_requests',
      'user_id = {:u} && local_request_id = {:l}',
      { u: userId, l: localRequestId },
    )
  } catch (_) {
    existing = null
  }
  if (existing) {
    if (existing.getString('origin_id') !== captureId) {
      throw new ApiError(409, 'local_request_id já usado para outra origem.')
    }
    return e.json(200, { duplicate: true, request: serializeRequest(existing) })
  }

  // ---------- persistir intenção ANTES do POST ----------
  let rec = null
  let dup = null
  let commitErr = null
  e.app.runInTransaction((txApp) => {
    // Re-checagem dentro da transação: a unicidade nativa (user_id +
    // local_request_id) decide a corrida entre dois POSTs simultâneos.
    let inner = null
    try {
      inner = txApp.findFirstRecordByFilter(
        'ai_requests',
        'user_id = {:u} && local_request_id = {:l}',
        { u: userId, l: localRequestId },
      )
    } catch (_) {
      inner = null
    }
    if (inner) {
      if (inner.getString('origin_id') !== captureId) {
        commitErr = new ApiError(409, 'local_request_id já usado para outra origem.')
      } else {
        dup = inner
      }
      return
    }
    const col = txApp.findCollectionByNameOrId('ai_requests')
    const r = new Record(col)
    r.set('user_id', userId) // derivado da sessão, nunca do payload
    r.set('origin_type', 'captura')
    r.set('origin_id', captureId)
    r.set('origin_revision', originRevision)
    r.set('context', context)
    r.set('local_request_id', localRequestId)
    r.set('schema_version', SCHEMA_VERSION)
    r.set('prompt_revision', PROMPT_REVISION)
    r.set('state', 'registrado')
    try {
      txApp.save(r)
      rec = r
    } catch (saveErr) {
      void saveErr // corrida: unicidade nativa venceu
      commitErr = new ApiError(409, 'local_request_id já registrado (corrida local).')
    }
  })
  if (commitErr) throw commitErr
  if (dup) return e.json(200, { duplicate: true, request: serializeRequest(dup) })
  if (!rec) throw new ApiError(500, 'Falha interna ao registrar a intenção.')

  // ---------- POST externo FORA de transação ----------
  let resp = null
  let postErr = null
  try {
    resp = manusCall(apiKey, 'POST', '/v2/task.create', buildCreatePayload(rec, rawText), 15)
  } catch (err) {
    postErr = err
  }

  if (postErr) {
    // Timeout/rede: confirmação perdida → 'criacao_incerta', sem request_id
    // (nada foi recebido). NÃO reenviar; NÃO revogar/limpar nada.
    markUncertain(e.app, rec, sanitizeErr(postErr, null))
    throw new ApiError(502, 'Manus não confirmou a criação da tarefa; tarefa não reenviada.')
  }
  const created = parseCreateResponse(resp)
  if (!created.ok) {
    markUncertain(e.app, rec, created.error)
    throw new ApiError(502, 'Manus recusou a criação da tarefa; tarefa não reenviada.')
  }

  rec.set('remote_task_id', created.taskId)
  if (created.taskUrl) rec.set('task_url', created.taskUrl)
  if (created.requestId) rec.set('remote_request_id', created.requestId)
  rec.set('state', 'em_execucao')
  rec.set('last_polled_at', new Date().toISOString())
  rec.set('error', '')
  e.app.save(rec)

  return e.json(200, { duplicate: false, request: serializeRequest(rec) })
})

routerAdd('GET', '/backend/v1/ai/requests/{id}', (e) => {
  // ---------- helpers (inline por rota) ----------
  function str(v) {
    return typeof v === 'string' ? v.trim() : ''
  }
  function sanitizeErr(err, resp) {
    if (resp && typeof resp.statusCode === 'number') {
      return 'Manus respondeu HTTP ' + resp.statusCode + '.'
    }
    if (err && err.message && String(err.message).indexOf('timeout') >= 0) {
      return 'Timeout contatando Manus.'
    }
    return 'Falha de rede contatando Manus.'
  }
  function manusCall(apiKey, method, path, bodyObj, timeoutSec) {
    const resp = $http.send({
      url: 'https://api.manus.ai' + path,
      method: method,
      headers: { 'x-manus-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: timeoutSec || 10,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
    })
    return resp
  }
  function extractText(content) {
    // content pode ser string ou array de partes {type:'text', text}.
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      let out = ''
      for (const part of content) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          out += (out ? ' ' : '') + part.text.trim()
        }
      }
      return out.trim()
    }
    return ''
  }
  function parseQuestion(listResp) {
    // Procura a última espera messageAskUser/cascadeAskUser nas mensagens.
    // Sem forma reconhecível → 'outra' (decisão externa — nunca responder).
    if (!listResp || !listResp.json || !Array.isArray(listResp.json)) {
      return { kind: 'outra', text: '' }
    }
    const msgs = listResp.json
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] || {}
      const mType = str(m.type) || str(m.message && m.message.type)
      const isAsk = mType === 'messageAskUser' || mType === 'cascadeAskUser'
      if (!isAsk) continue
      const text = extractText(m.content || (m.message && m.message.content))
      return {
        kind: 'ask_user',
        text: text,
        messageId: str(m.id) || str(m.message_id) || '',
        type: mType,
      }
    }
    return { kind: 'outra', text: '' }
  }
  function validateResultValue(v) {
    // Validação server-side do JSON do resultado (subset do schema versionado).
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, error: 'Resultado estruturado não é um objeto.' }
    }
    const kind = str(v.kind)
    if (kind !== 'esclarecimento' && kind !== 'projeto' && kind !== 'acao') {
      return { ok: false, error: 'Campo kind inválido no resultado.' }
    }
    if (typeof v.missing_data !== 'boolean' || typeof v.waiting_or_decision !== 'boolean') {
      return { ok: false, error: 'Flags missing_data/waiting_or_decision inválidas.' }
    }
    if (typeof v.explanation !== 'string') {
      return { ok: false, error: 'Campo explanation inválido.' }
    }
    const p = v.proposal
    if (p !== null && p !== undefined) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        return { ok: false, error: 'Proposal inválida.' }
      }
      const pk = str(p.kind)
      if (pk !== 'projeto' && pk !== 'acao') {
        return { ok: false, error: 'Proposal com kind inválido.' }
      }
      if (!str(p.title)) return { ok: false, error: 'Proposal sem título.' }
      if (str(p.context) !== 'vida' && str(p.context) !== 'trabalho') {
        return { ok: false, error: 'Proposal com contexto inválido.' }
      }
      if (pk === 'acao') {
        // Ação: só título e contexto — campos extras não são aceitos.
        const extras = ['aspiration', 'controllable_delivery', 'completion_condition']
        for (const ex of extras) {
          if (p[ex] !== null && p[ex] !== undefined && p[ex] !== '') {
            return { ok: false, error: 'Proposal de ação com campo de projeto (' + ex + ').' }
          }
        }
      }
    }
    if (
      v.next_step_suggestion !== null &&
      v.next_step_suggestion !== undefined &&
      typeof v.next_step_suggestion !== 'string'
    ) {
      return { ok: false, error: 'Campo next_step_suggestion inválido.' }
    }
    return { ok: true }
  }
  function parseStructuredResult(detailResp, apiKey, taskId) {
    // Prioriza task.detail.structured_output; senão procura o evento
    // structured_output_result em task.listMessages.
    let so = null
    if (detailResp && detailResp.json) {
      const t = detailResp.json.task || detailResp.json
      if (
        t &&
        typeof t === 'object' &&
        t.structured_output &&
        typeof t.structured_output === 'object'
      ) {
        so = t.structured_output
      }
    }
    if (!so) {
      let listResp = null
      try {
        listResp = manusCall(
          apiKey,
          'GET',
          '/v2/task.listMessages?task_id=' + encodeURIComponent(taskId) + '&order=asc',
          null,
          10,
        )
      } catch (_) {
        return { ok: false, error: 'Falha de rede lendo resultado estruturado.' }
      }
      if (!listResp || !listResp.json || !Array.isArray(listResp.json)) {
        return { ok: false, error: 'Resultado estruturado não encontrado.' }
      }
      for (let i = listResp.json.length - 1; i >= 0; i--) {
        const m = listResp.json[i] || {}
        if (str(m.type) === 'structured_output_result' && m.structured_output_result) {
          so = m.structured_output_result
          break
        }
      }
      if (!so) return { ok: false, error: 'Resultado estruturado não encontrado.' }
    }
    // success:false ou erro de extração NUNCA é ready.
    if (so.success !== true) {
      const msg = so.error && typeof so.error === 'string' ? so.error : ''
      return { ok: false, error: 'Extração sem sucesso' + (msg ? ': ' + msg : '.') }
    }
    const val = validateResultValue(so.value)
    if (!val.ok) return { ok: false, error: val.error }
    return { ok: true, value: so.value }
  }
  // ---------- sessão ----------
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id

  // ---------- gate ----------
  const enabledRaw = $os.getenv('MANUS_AI_ENABLED') || ''
  const enabledVal = String(enabledRaw).trim().toLowerCase()
  const enabled = enabledVal === '1' || enabledVal === 'true' || enabledVal === 'yes'
  const syncAllowed = enabled // consulta LOCAL existe sem gate; sincronização não

  const id = e.request.pathValue('id')
  let rec
  try {
    rec = e.app.findRecordById('ai_requests', id)
  } catch (_) {
    throw new NotFoundError('Pedido de esclarecimento não encontrado.')
  }
  if (rec.getString('user_id') !== userId) {
    throw new ForbiddenError('Pedido pertence a outro usuário.')
  }

  const state = rec.getString('state')
  if (!syncAllowed) {
    // Sem gate: devolve o estado local sem sincronizar (jamais resultado
    // fictício). Consultas locais existentes podem continuar.
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }

  // ---------- coalescência/backoff (não consultar perto do limite de quota) ----------
  const nowMs = Date.now()
  const lastPoll = rec.getString('last_polled_at') // datetime serializa como string
  const lastPollMs = lastPoll ? Date.parse(lastPoll) : 0
  const COALESCE_MS = 15000
  if (lastPollMs && nowMs - lastPollMs < COALESCE_MS) {
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }

  const taskId = rec.getString('remote_task_id')
  if (!taskId) {
    // 'criacao_incerta' sem task_id: sem reenvio automático — devolve estado.
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }
  const apiKey = $os.getenv('MANUS_API_KEY') || ''
  if (!apiKey) {
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }

  rec.set('last_polled_at', new Date().toISOString())
  e.app.save(rec)

  let detail = null
  let detailErr = null
  try {
    detail = manusCall(
      apiKey,
      'GET',
      '/v2/task.detail?task_id=' + encodeURIComponent(taskId),
      null,
      10,
    )
  } catch (err) {
    detailErr = err
  }
  if (detailErr) {
    // Timeout de consulta ≠ cancelamento remoto: mantém estado, sem "cancelada".
    rec.set('error', sanitizeErr(detailErr, null))
    e.app.save(rec)
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }
  if (!detail || typeof detail.statusCode !== 'number' || detail.statusCode >= 300) {
    rec.set('error', sanitizeErr(null, detail))
    e.app.save(rec)
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }

  const task = (detail.json && (detail.json.task || detail.json)) || {}
  rec.set('error', '')
  const status = str(task.status)
  const stopReason = str(task.stop_reason)
  // has_running_background_jobs: true = em execução; false = encerrado de
  // verdade; OMISSÃO = desconhecido (tratado como ainda em execução).
  const bgTrue = task.has_running_background_jobs === true
  const bgFalse = task.has_running_background_jobs === false
  const bgOmitted = typeof task.has_running_background_jobs === 'undefined'

  if (status === 'error') {
    rec.set('state', 'falha')
    e.app.save(rec)
    return e.json(200, { request: serializeRequest(rec), synced: true })
  }

  // Espera de pergunta comum vs outras esperas: stop_reason 'ask'.
  if (status === 'running' || bgTrue || (stopReason === 'ask' && !bgFalse)) {
    if (stopReason === 'ask' && !bgTrue && status !== 'running') {
      const q = parseQuestion(detail)
      if (q.kind === 'ask_user' && q.text) {
        rec.set('state', 'aguardando_pergunta')
        rec.set('question', {
          type: q.type,
          text: q.text,
          message_id: q.messageId,
          task_id: taskId,
        })
        e.app.save(rec)
        return e.json(200, { request: serializeRequest(rec), synced: true })
      }
      // Espera não reconhecida como pergunta ao dono → decisão externa.
      rec.set('state', 'decisao_externa')
      rec.set('question', null)
      e.app.save(rec)
      return e.json(200, { request: serializeRequest(rec), synced: true })
    }
    rec.set('state', 'em_execucao')
    e.app.save(rec)
    return e.json(200, { request: serializeRequest(rec), synced: true })
  }

  // status 'stopped': NÃO é ready por si só — exigir stop_reason 'finish' +
  // has_running_background_jobs:false + resultado estruturado success:true.
  if (status === 'stopped') {
    if (stopReason !== 'finish') {
      // Encerrado sem finish (ex.: pausa/ask não capturada acima): decisão
      // externa necessária com task_url real — nunca responder/pular/confirmar.
      rec.set('state', 'decisao_externa')
      rec.set('question', null)
      e.app.save(rec)
      return e.json(200, { request: serializeRequest(rec), synced: true })
    }
    const done = parseStructuredResult(detail, apiKey, taskId)
    if (done.ok) {
      rec.set('state', 'pronta')
      rec.set('result', done.value)
      rec.set('question', null)
      rec.set('error', '')
      e.app.save(rec)
      return e.json(200, { request: serializeRequest(rec), synced: true })
    }
    if (bgFalse) {
      rec.set('state', 'falha')
      rec.set('error', done.error)
      e.app.save(rec)
      return e.json(200, { request: serializeRequest(rec), synced: true })
    }
    // bg true/omissido: encerramento ainda incerto — mantém em execução.
    rec.set('state', 'em_execucao')
    e.app.save(rec)
    return e.json(200, { request: serializeRequest(rec), synced: true })
  }

  rec.set('state', 'em_execucao')
  e.app.save(rec)
  return e.json(200, { request: serializeRequest(rec), synced: true })
})

routerAdd('POST', '/backend/v1/ai/requests/{id}/answer', (e) => {
  // ---------- helpers (inline por rota) ----------
  function str(v) {
    return typeof v === 'string' ? v.trim() : ''
  }
  function sanitizeErr(err, resp) {
    if (resp && typeof resp.statusCode === 'number') {
      return 'Manus respondeu HTTP ' + resp.statusCode + '.'
    }
    if (err && err.message && String(err.message).indexOf('timeout') >= 0) {
      return 'Timeout contatando Manus.'
    }
    return 'Falha de rede contatando Manus.'
  }
  function manusCall(apiKey, method, path, bodyObj, timeoutSec) {
    const resp = $http.send({
      url: 'https://api.manus.ai' + path,
      method: method,
      headers: { 'x-manus-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: timeoutSec || 12,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
    })
    return resp
  }
  function parseSendResponse(resp) {
    if (!resp || typeof resp.statusCode !== 'number' || resp.statusCode >= 300) {
      return { ok: false, error: sanitizeErr(null, resp) }
    }
    return { ok: true }
  }
  // ---------- sessão + gate ----------
  const info = e.requestInfo()
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id
  const enabledRaw = $os.getenv('MANUS_AI_ENABLED') || ''
  const enabledVal = String(enabledRaw).trim().toLowerCase()
  const enabled = enabledVal === '1' || enabledVal === 'true' || enabledVal === 'yes'
  if (!enabled) {
    throw new ApiError(503, 'Integração Manus desligada/não configurada.')
  }

  const id = e.request.pathValue('id')
  const body = info.body || {}
  const text = str(body.text)
  const answerRequestId = str(body.answer_request_id)
  if (!text) throw new BadRequestError('text é obrigatório e não pode ser vazio.')

  let rec
  try {
    rec = e.app.findRecordById('ai_requests', id)
  } catch (_) {
    throw new NotFoundError('Pedido de esclarecimento não encontrado.')
  }
  if (rec.getString('user_id') !== userId) {
    throw new ForbiddenError('Pedido pertence a outro usuário.')
  }

  // ---------- idempotência local da resposta ----------
  // O marcador de resposta fica no JSON `question` (question.answered). Se o
  // mesmo answer_request_id volta e a resposta já foi confirmada, devolve
  // duplicate — sem reenviar ao Manus.
  const q = rec.get('question')
  const answeredMarker = q && typeof q === 'object' && q.answered ? q : null
  if (answerRequestId && answeredMarker && answeredMarker.answer_request_id === answerRequestId) {
    return e.json(200, { duplicate: true, request: serializeRequest(rec) })
  }

  // ---------- pré-condição: espera de pergunta comum ----------
  if (rec.getString('state') !== 'aguardando_pergunta') {
    throw new ApiError(409, 'Pedido não está aguardando resposta do dono.')
  }
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    throw new ApiError(409, 'Pedido sem pergunta pendente registrada.')
  }
  const qType = str(q.type)
  // Apenas espera de pergunta comum (messageAskUser/cascadeAskUser): outras
  // esperas ficam em 'decisao_externa' — nunca responder/pular/confirmar.
  if (qType !== 'messageAskUser' && qType !== 'cascadeAskUser') {
    throw new ApiError(409, 'Espera atual não é uma pergunta ao dono; decisão externa necessária.')
  }
  const taskId = rec.getString('remote_task_id')
  if (!taskId) {
    throw new ApiError(409, 'Pedido sem tarefa remota vinculada.')
  }
  const apiKey = $os.getenv('MANUS_API_KEY') || ''
  if (!apiKey) {
    throw new ApiError(503, 'Integração Manus desligada/não configurada.')
  }

  // ---------- task.sendMessage FORA de transação ----------
  const msgPayload = {
    task_id: taskId,
    message: { content: [{ type: 'text', text: text, visibility: 'visible' }] },
    clear_connectors: true,
  }
  let resp = null
  let sendErr = null
  try {
    resp = manusCall(apiKey, 'POST', '/v2/task.sendMessage', msgPayload, 12)
  } catch (err) {
    sendErr = err
  }
  if (sendErr) {
    // Sem retry cego: erro sanitizado, estado de espera preservado.
    rec.set('error', sanitizeErr(sendErr, null))
    e.app.save(rec)
    throw new ApiError(502, 'Manus não confirmou o recebimento da resposta; não reenviada.')
  }
  const parsed = parseSendResponse(resp)
  if (!parsed.ok) {
    rec.set('error', parsed.error)
    e.app.save(rec)
    throw new ApiError(502, 'Manus recusou a resposta; não reenviada.')
  }

  // ---------- commit local (depois do 2xx remoto) ----------
  rec.set('state', 'em_execucao')
  rec.set('question', {
    type: qType,
    text: str(q.text),
    message_id: str(q.message_id),
    task_id: taskId,
    answered: true,
    answer_request_id: answerRequestId || '',
  })
  rec.set('last_polled_at', new Date().toISOString())
  rec.set('error', '')
  e.app.save(rec)

  return e.json(200, { duplicate: false, request: serializeRequest(rec) })
})
