// FATIA M1A1 — Contrato/rotas Manus v2 corrigidos; integração DESLIGADA por padrão.
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
//   (nunca resultado fictício). GET mantém leitura LOCAL (synced:false, sem HTTP).
// - Chave MANUS_API_KEY lida via $os.getenv, usada APENAS no header
//   x-manus-api-key — nunca em prompt, resposta, log, migration ou payload.
// - NENHUMA chamada a api.manus.ai nesta rodada (gate OFF): os callbacks são
//   exercitados só por mocks locais (scripts/manus-ai-fixtures.mjs, que rodam
//   o FONTE REAL em Node VM com stubs).
// - Intenção local persistida ANTES do POST (state 'registrado'); falha do POST
//   deixa 'criacao_incerta' (request_id só se recebido), SEM reenvio
//   automático, sem revogar/limpar nada. Dedup local ≠ exactly-once remoto.
// M1A2a: claim durável answer_delivery (enviando→incerta|confirmada) dentro de
//   question — autoriza um único POST task.sendMessage; nada de campo novo.
// - HTTP externo FORA de transação; runInTransaction void (resultado em
//   variável local; resposta HTTP só após commit, status numérico — JSVM não
//   expõe o pacote http).
// - Hooks não acessam declarações de topo: helpers (serializeRequest incluída)
//   são funções DENTRO de cada callback (cópia por rota) — callbacks são
//   escopos separados na JSVM.
// - Contrato v2 (M1A1): task.create usa agent_profile ('standard'); resposta
//   oficial exige ok===true (corpo de erro ok:false jamais é sucesso).
//   task.detail traz status/has_running_background_jobs (NUNCA stop_reason/
//   structured_output — isso é do webhook); task.listMessages retorna ENVELOPE
//   { messages, has_more, next_cursor }; espera = status 'waiting' com tipo em
//   status_update.status_detail.waiting_for_event_type; texto da pergunta em
//   assistant_message.content; resultado no evento structured_output_result
//   (após finish), da execução CORRENTE (user_message mais novo que o último
//   resultado = continuação; resultado antigo NÃO é reaproveitado). 'pronta'
//   exige has_running_background_jobs === false explícito (true/omissão nunca).
// - Distinção de estados: ausência/paginação incompleta/rede/timeout/resultado
//   ainda não encontrado = recuperável ('em_execucao' + nota de erro);
//   structured_output success:false ou JSON inválido EFETIVAMENTE recebido =
//   falha real ('falha') — incluindo envelope structured_output_result PRESENTE
//   porém malformado (payload null/string/objeto sem success booleano), que é
//   falha de formato explícita e NÃO ausência recuperável (M1A1b).
// - Associação de pergunta (M1A1b): o texto/id gravados em question vêm do
//   assistant_message REALMENTE correspondente à espera (waiting_for_event_id
//   que aponte para essa mensagem exposta, ou assistant_message com
//   question_expectation na execução corrente). Sem correspondência segura, a
//   leitura fica inconclusiva — nunca texto de mensagem de progresso.
// - Identidade de leitura (M1A1b): a escrita compara o snapshot da reserva
//   com o registro novo na transação. Leitura velha/fora de ordem NÃO substitui
//   estado mais novo (vale para 'pronta' E para 'falha'); evento/execução
//   identificada pelos eventos atuais (ou user_message mais novo que o
//   resultado gravado) invalida o resultado antigo e grava o estado novo. Sem
//   campo de schema novo: snapshot local da reserva, fora do JSON do modelo.
// - NÃO codificar stop/cancel nem task.confirmAction nesta fatia. Timeout de
//   consulta ≠ cancelamento remoto: nada vira "cancelada" sem confirmação.
// - CLAIM DURÁVEL DO ANSWER (M1A2a): question.answer_delivery = identificação
//   da pergunta, tentativa e texto normalizado (campo json existente; NENHUM campo de schema novo).
//   Estados: 'enviando' (gravado atomicamente ANTES do task.sendMessage — é a
//   autorização para um ÚNICO POST), 'incerta' (timeout/rede/resposta não
//   confirmatória) e 'confirmada' (2xx + ok:true + persistência local OK).
//   Enquanto enviando/incerta, QUALQUER novo POST (mesmo ou outro
//   answer_request_id) é 409 — sem TTL, sem reenvio automático; marcador
//   answered:true antigo (sem delivery) também bloqueia. answered:true só
//   significa SUCESSO CONFIRMADO. Sem promessa de idempotência remota.
// - Criação/recuperação pós-POST do clarify (M1A2b) NÃO nesta fatia.
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
  function officialOk(resp) {
    // Resposta oficial v2: HTTP < 300 E corpo com ok === true. Corpo de erro
    // (ok:false) jamais é tratado como sucesso, venha com o HTTP que vier.
    return (
      !!resp &&
      typeof resp.statusCode === 'number' &&
      resp.statusCode < 300 &&
      resp.json &&
      typeof resp.json === 'object' &&
      resp.json.ok === true
    )
  }
  function parseCreateResponse(resp) {
    if (!resp || typeof resp.statusCode !== 'number') {
      return { ok: false, error: 'Resposta inválida de Manus.' }
    }
    if (resp.statusCode >= 300) {
      return { ok: false, error: sanitizeErr(null, resp) }
    }
    const j = resp.json
    if (!j || typeof j !== 'object' || j.ok !== true) {
      return { ok: false, error: 'Criação sem confirmação oficial (ok).' }
    }
    const taskId = str(j.task_id)
    if (!taskId) return { ok: false, error: 'Resposta de criação sem task_id.' }
    return {
      ok: true,
      taskId: taskId,
      taskUrl: str(j.task_url) || str(j.share_url),
      requestId: str(j.request_id), // só se recebido
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
      agent_profile: 'standard', // perfil standard explícito (contrato v2)
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
  const PROMPT_REVISION = 'm1a1-1'

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
  // ---------- helpers (inline por callback) ----------
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
    return $http.send({
      url: 'https://api.manus.ai' + path,
      method: method,
      headers: { 'x-manus-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: timeoutSec || 10,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
    })
  }
  function officialOk(resp) {
    return (
      !!resp &&
      typeof resp.statusCode === 'number' &&
      resp.statusCode >= 200 &&
      resp.statusCode < 300 &&
      resp.json &&
      typeof resp.json === 'object' &&
      resp.json.ok === true
    )
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
  function fetchEventPage(apiKey, taskId, cursor) {
    // task.listMessages retorna ENVELOPE OBJETO { messages, has_more,
    // next_cursor } — nunca um array. Uma página por chamada.
    // verbose=true: sem ele a página traz apenas user_message/assistant_message/
    // error_message/status_update/user_stop — structured_output_result fica de fora.
    let path =
      '/v2/task.listMessages?task_id=' +
      encodeURIComponent(taskId) +
      '&order=desc&limit=50&verbose=true'
    if (cursor) path += '&cursor=' + encodeURIComponent(cursor)
    let resp = null
    try {
      resp = manusCall(apiKey, 'GET', path, null, 10)
    } catch (err) {
      return { error: sanitizeErr(err, null) }
    }
    if (!officialOk(resp)) return { error: sanitizeErr(null, resp) }
    const j = resp.json || {}
    if (!Array.isArray(j.messages)) {
      return { error: 'Envelope de eventos em formato inesperado.' }
    }
    return { msgs: j.messages, hasMore: j.has_more === true, nextCursor: str(j.next_cursor) }
  }
  const MAX_EVENT_PAGES = 5
  function scanEvents(apiKey, taskId, mode) {
    // Percorre páginas (order=desc, mais recentes primeiro) até achar o primeiro
    // evento de interesse da execução CORRENTE, com limite duro de páginas —
    // consulta nunca vira espera ilimitada.
    // mode 'result': primeiro structured_output_result; user_message mais novo
    //   que ele = continuação (resultado antigo não serve).
    // mode 'question': primeiro status_update waiting; o texto da pergunta é a
    //   assistant_message CORRESPONDENTE à espera (waiting_for_event_id que
    //   aponte para essa mensagem, ou assistant_message com question_expectation
    //   na execução corrente) — nunca a primeira mensagem anterior qualquer
    //   (M1A1b: mensagem de progresso intercalada não é pergunta).
    let cursor = ''
    let waiting = null
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const pg = fetchEventPage(apiKey, taskId, cursor)
      if (pg.error) return { error: pg.error }
      for (let i = 0; i < pg.msgs.length; i++) {
        const m = pg.msgs[i] || {}
        const t = str(m.type)
        if (mode === 'result') {
          if (t === 'structured_output_result') {
            const so = m.structured_output_result
            // Envelope PRESENTE: malformado (null/string/array/sem success
            // booleano) é falha de formato explícita — NÃO ausência
            // recuperável. Só a AUSÊNCIA é inconclusiva (M1A1b).
            if (so === null || so === undefined) {
              return { found: { malformed: true } }
            }
            if (typeof so !== 'object' || Array.isArray(so) || typeof so.success !== 'boolean') {
              return { found: { malformed: true } }
            }
            return { found: { so: so } }
          }
          if (t === 'user_message') return { found: { continuation: true } }
          // (continuation é evidência de execução nova: o caller invalida
          // resultados/estados anteriores a ela)
        } else if (mode === 'question') {
          // Não buscar pergunta pertencente a execução anterior à mensagem do dono.
          if (t === 'user_message') {
            if (!waiting) return { found: { continuation: true } }
            return {
              found: { question: { type: waiting.type, id: waiting.id, text: '', expect: null } },
            }
          }
          if (waiting && t === 'structured_output_result') {
            return {
              found: { question: { type: waiting.type, id: waiting.id, text: '', expect: null } },
            }
          }
          const su = m.status_update
          if (waiting && t === 'status_update' && su && str(su.agent_status) === 'waiting') {
            const older =
              su.status_detail && typeof su.status_detail === 'object' ? su.status_detail : {}
            const olderId = str(older.waiting_for_event_id)
            if (olderId && olderId !== waiting.id) {
              return {
                found: { question: { type: waiting.type, id: waiting.id, text: '', expect: null } },
              }
            }
          }
          if (
            !waiting &&
            t === 'status_update' &&
            su &&
            typeof su === 'object' &&
            str(su.agent_status) === 'waiting'
          ) {
            const sd =
              su.status_detail && typeof su.status_detail === 'object' ? su.status_detail : {}
            // waiting_for_event_id referencia o EVENTO aguardado — NÃO é o ID
            // do assistant_message da pergunta (M1A1b: não confundir).
            waiting = {
              type: str(sd.waiting_for_event_type),
              id: str(sd.waiting_for_event_id),
            }
            continue
          }
          if (waiting && t === 'assistant_message') {
            const am =
              m.assistant_message && typeof m.assistant_message === 'object'
                ? m.assistant_message
                : {}
            const text = extractText(am.content)
            // Correspondência segura (M1A1b): o assistant_message é a pergunta
            // desta espera SOMENTE se (a) waiting_for_event_id aponta
            // diretamente para ESTE evento, ou (b) a própria mensagem carrega
            // question_expectation. O ID gravado é SEMPRE o do assistant_message
            // selecionado — o ID da espera (waiting_for_event_id) NUNCA vira
            // question.message_id.
            const matchedById = !!waiting.id && str(m.id) === waiting.id
            const hasExpect = am.question_expectation && typeof am.question_expectation === 'object'
            if (matchedById || hasExpect) {
              return {
                found: {
                  question: {
                    type: waiting.type,
                    id: str(m.id),
                    text: text,
                    expect: hasExpect ? am.question_expectation : null,
                  },
                },
              }
            }
            // assistant_message SEM correspondência provada com a espera:
            // mensagem de progresso intercalada — a candidata não corresponde;
            // continuar nesta página e nas próximas (M1A1b).
            continue
          }
        }
      }
      if (!pg.hasMore || !pg.nextCursor) break
      cursor = pg.nextCursor
    }
    if (mode === 'question' && waiting) {
      // Espera encontrada, mas texto provado não veio dentro do limite de
      // páginas. Candidata (assistant_message logo após a espera, sem prova de
      // correspondência) só é usada se não houver outra mensagem entre ela e a
      // espera na página — caso contrário, texto arbitrário de mensagem de
      // progresso NUNCA vira pergunta (M1A1b: leitura inconclusiva).
      return { found: { question: { type: waiting.type, id: waiting.id, text: '', expect: null } } }
    }
    return { exhausted: true }
  }
  function validateResultValue(v, authorizedContext) {
    // Validação server-side do schema COMPLETO: required na raiz e na proposal,
    // additionalProperties:false (campo desconhecido é rejeitado), tipos
    // nullable exatos, título válido, kind coerente e proposal.context IGUAL ao
    // context autorizado do pedido. Campos de projeto em ação não permitidos.
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, error: 'Resultado estruturado não é um objeto.' }
    }
    const ROOT_FIELDS = [
      'kind',
      'missing_data',
      'waiting_or_decision',
      'explanation',
      'proposal',
      'next_step_suggestion',
    ]
    for (const k in v) {
      if (ROOT_FIELDS.indexOf(k) < 0) {
        return { ok: false, error: 'Campo desconhecido no resultado: ' + k + '.' }
      }
    }
    for (let i = 0; i < ROOT_FIELDS.length; i++) {
      if (typeof v[ROOT_FIELDS[i]] === 'undefined') {
        return { ok: false, error: 'Campo obrigatório ausente: ' + ROOT_FIELDS[i] + '.' }
      }
    }
    const kind = v.kind
    if (
      typeof kind !== 'string' ||
      (kind !== 'esclarecimento' && kind !== 'projeto' && kind !== 'acao')
    ) {
      return { ok: false, error: 'Campo kind inválido no resultado.' }
    }
    if (typeof v.missing_data !== 'boolean' || typeof v.waiting_or_decision !== 'boolean') {
      return { ok: false, error: 'Flags missing_data/waiting_or_decision inválidas.' }
    }
    if (typeof v.explanation !== 'string') {
      return { ok: false, error: 'Campo explanation inválido.' }
    }
    if (v.next_step_suggestion !== null && typeof v.next_step_suggestion !== 'string') {
      return { ok: false, error: 'Campo next_step_suggestion deve ser texto ou null.' }
    }
    const p = v.proposal
    if (kind === 'esclarecimento') {
      if (p !== null) {
        return { ok: false, error: 'Esclarecimento não admite proposal (deve ser null).' }
      }
    } else {
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        return { ok: false, error: 'Proposal obrigatória para kind ' + kind + '.' }
      }
      const P_FIELDS = [
        'kind',
        'title',
        'context',
        'aspiration',
        'controllable_delivery',
        'completion_condition',
      ]
      for (const k in p) {
        if (P_FIELDS.indexOf(k) < 0) {
          return { ok: false, error: 'Campo desconhecido na proposal: ' + k + '.' }
        }
      }
      for (let i = 0; i < P_FIELDS.length; i++) {
        if (typeof p[P_FIELDS[i]] === 'undefined') {
          return { ok: false, error: 'Campo obrigatório ausente na proposal: ' + P_FIELDS[i] + '.' }
        }
      }
      if (p.kind !== kind) {
        return { ok: false, error: 'Proposal com kind divergente do resultado.' }
      }
      if (typeof p.title !== 'string' || !p.title.trim()) {
        return { ok: false, error: 'Proposal sem título válido.' }
      }
      if (p.context !== authorizedContext) {
        return { ok: false, error: 'Proposal com contexto diferente do autorizado no pedido.' }
      }
      const NULLABLE = ['aspiration', 'controllable_delivery', 'completion_condition']
      for (let i = 0; i < NULLABLE.length; i++) {
        if (p[NULLABLE[i]] !== null && typeof p[NULLABLE[i]] !== 'string') {
          return { ok: false, error: 'Campo ' + NULLABLE[i] + ' deve ser texto ou null.' }
        }
      }
      if (kind === 'acao') {
        for (let i = 0; i < NULLABLE.length; i++) {
          if (p[NULLABLE[i]] !== null) {
            return {
              ok: false,
              error: 'Proposal de ação com campo de projeto (' + NULLABLE[i] + ').',
            }
          }
        }
      }
    }
    return { ok: true }
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

  if (!syncAllowed) {
    // Sem gate: devolve o estado local sem sincronizar (jamais resultado
    // fictício) e sem NENHUMA chamada HTTP.
    return e.json(200, { request: serializeRequest(rec), synced: false })
  }

  // ---------- coalescência/backoff (não consultar perto do limite de quota) ----------
  const nowMs = Date.now()
  const lastPoll = rec.getString('last_polled_at')
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

  // ---------- RESERVA de polling (M1A1b/Ponto 1) ----------
  // Reserva local atômica; nenhum HTTP dentro da transação.
  // Snapshot canônico dos campos relevantes, inclusive revisão automática.
  function canonicalValue(v) {
    if (Array.isArray(v)) return v.map(canonicalValue)
    if (v && typeof v === 'object') {
      const out = {}
      Object.keys(v)
        .sort()
        .forEach((key) => {
          out[key] = canonicalValue(v[key])
        })
      return out
    }
    return v
  }
  function snapshotKey(r) {
    return JSON.stringify(
      canonicalValue([
        r.getString('updated'),
        r.getString('last_polled_at'),
        r.getString('user_id'),
        r.getString('remote_task_id'),
        r.getString('state'),
        r.getString('error'),
        r.getString('context'),
        r.getString('origin_revision'),
        r.get('question'),
        r.get('result'),
      ]),
    )
  }
  // ---- M1A2a: preservação do claim/answered da MESMA pergunta no GET ----
  function answerDeliveryOf(q) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) return null
    return q.answer_delivery && typeof q.answer_delivery === 'object' ? q.answer_delivery : null
  }
  function preserveExistingAnswer(currentQ, nextQ) {
    // nextQ pode não conter uma pergunta identificada. Preservar a reserva e
    // o marcador confirmado na mesma pergunta ou em leitura inconclusiva.
    // Só uma pergunta COM ID comprovado e DIFERENTE pode substituí-los.
    if (!currentQ || typeof currentQ !== 'object' || Array.isArray(currentQ)) return nextQ
    const d = answerDeliveryOf(currentQ)
    if (!d && currentQ.answered !== true) return nextQ
    const nextId =
      nextQ && typeof nextQ === 'object' && !Array.isArray(nextQ) ? str(nextQ.message_id || '') : ''
    const currentId = str(currentQ.message_id || '')
    // Sem ID novo comprovado, manter a reserva: ausência de evento não é ack.
    if (!nextId) return currentQ
    // Pergunta comprovadamente diferente pode avançar normalmente.
    if (nextId !== currentId) return nextQ
    const out = {}
    for (const k in nextQ) out[k] = nextQ[k]
    if (d) out.answer_delivery = d
    if (currentQ.answered === true) {
      out.answered = true
      if (currentQ.answer_request_id) out.answer_request_id = currentQ.answer_request_id
    }
    return out
  }
  function keepWaitingAnswer(fresh, computed) {
    // Espera antiga NÃO reabre pergunta já confirmada: se a pergunta confirmada
    // (answered:true) continua sendo a pendente, o estado permanece em_execucao
    // e a pergunta confirmada é mantida — o GET não regredi o ack do dono.
    const q = fresh.get('question')
    if (!q || typeof q !== 'object' || q.answered !== true) return computed
    if (computed.state !== 'aguardando_pergunta') return computed
    const curId = str(q.message_id || '')
    const newId = computed.question ? str(computed.question.message_id || '') : ''
    if (curId && newId && curId === newId) {
      return { state: 'em_execucao', question: null, error: '' }
    }
    return computed
  }
  const pollTicket = { snapshot: '', lastPolledAt: '' }
  let reserved = false
  e.app.runInTransaction((txApp) => {
    const fresh = txApp.findRecordById('ai_requests', rec.id)
    if (fresh.getString('user_id') !== userId) {
      throw new ForbiddenError('Pedido pertence a outro usuário.')
    }
    rec = fresh
    // Revalidar a janela DENTRO da transação: uma leitura prévia não reserva.
    const freshPollMs = Date.parse(fresh.getString('last_polled_at')) || 0
    if (freshPollMs && Date.now() - freshPollMs < COALESCE_MS) return
    if (fresh.getString('remote_task_id') !== taskId) return
    fresh.set('last_polled_at', new Date().toISOString())
    txApp.save(fresh)
    // updated pertence à versão APÓS salvar, não à anterior à reserva.
    rec = txApp.findRecordById('ai_requests', fresh.id)
    pollTicket.lastPolledAt = rec.getString('last_polled_at')
    pollTicket.snapshot = snapshotKey(rec)
    reserved = true
  })
  if (!reserved) return e.json(200, { request: serializeRequest(rec), synced: false })
  function stillOurs(fresh) {
    return (
      fresh.getString('last_polled_at') === pollTicket.lastPolledAt &&
      snapshotKey(fresh) === pollTicket.snapshot
    )
  }

  // ---------- task.detail (metadados/status/background) — HTTP FORA da transação ----------
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
  if (detailErr || !officialOk(detail)) {
    // Falha transitória de consulta: estado mantido (recuperável), sem
    // 'falha' irrecuperável e sem 'cancelada'. synced:false — leitura inválida.
    // Escrita CONDICIONADA (M1A1b/Ponto 1): dentro da transação, só persiste a
    // nota de erro se a reserva (updated + last_polled_at) e a revisão do
    // registro continuarem atuais — leitura obsoleta NÃO sobrescreve estado
    // mais novo gravado por outra consulta; devolve o registro ATUAL.
    let outReq = serializeRequest(rec)
    let stale = false
    e.app.runInTransaction((txApp) => {
      let fresh = null
      try {
        fresh = txApp.findRecordById('ai_requests', rec.id)
      } catch (_) {
        fresh = null
      }
      if (!fresh || typeof fresh.getString !== 'function') {
        throw new NotFoundError('Pedido de esclarecimento não encontrado.')
      }
      if (!stillOurs(fresh)) {
        stale = true
        return
      }
      // Compara DENTRO da transação com o snapshot fresco (não só o texto de
      // erro do rec velho): se o registro mudou enquanto A aguardava HTTP, o
      // rec antigo NÃO é salvo.
      if (
        str(fresh.getString('error')) !== rec.getString('error') ||
        fresh.getString('state') !== rec.getString('state')
      ) {
        // registro mudou além da nossa reserva: não sobrescrever
        stale = true
        return
      }
      fresh.set('error', detailErr ? sanitizeErr(detailErr, null) : sanitizeErr(null, detail))
      txApp.save(fresh)
      rec = fresh
      outReq = serializeRequest(fresh)
    })
    if (stale || !outReq) {
      // Devolve o registro ATUAL (relido), não o rec velho.
      const current = e.app.findRecordById('ai_requests', rec.id)
      return e.json(200, { request: serializeRequest(current), synced: false })
    }
    return e.json(200, { request: outReq, synced: false })
  }
  const task = detail.json.task && typeof detail.json.task === 'object' ? detail.json.task : {}
  const status = str(task.status)
  // has_running_background_jobs: true = pode acordar de novo; false =
  // encerrado de verdade; OMISSÃO = desconhecido → política conservadora:
  // NUNCA 'pronta' (só === false autoriza prontidão).
  const bgFalse = task.has_running_background_jobs === false

  // ---------- computação do estado (HTTP já feito; escrita vem depois) ----------
  let computed = null
  // Evidência de continuação: user_message mais recente que o último resultado
  // — a execução corrente não é mais a que produziu o estado gravado, e o
  // estado gravado (mesmo terminal) passa a ser inválido.
  let continuationEvidence = false
  if (status === 'error') {
    computed = { state: 'falha', error: 'Tarefa remota reportou erro.' }
  } else if (status === 'waiting') {
    const scan = scanEvents(apiKey, taskId, 'question')
    if (scan.found && scan.found.continuation) continuationEvidence = true
    if (scan.found && scan.found.question) {
      const q = scan.found.question
      if ((q.type === 'messageAskUser' || q.type === 'cascadeAskUser') && q.text) {
        const question = { type: q.type, text: q.text, message_id: q.id, task_id: taskId }
        if (q.expect && typeof q.expect === 'object') question.question_expectation = q.expect
        computed = { state: 'aguardando_pergunta', question: question, error: '' }
      } else if (q.type === 'messageAskUser' || q.type === 'cascadeAskUser') {
        // Pergunta ao dono cujo texto ainda não chegou aos eventos: recuperável —
        // a próxima consulta traz o assistant_message.
        computed = {
          state: 'em_execucao',
          error: 'Pergunta ao dono ainda sem texto nos eventos (consulta inconclusiva).',
        }
      } else {
        // Espera identificada mas não é pergunta ao dono → decisão externa;
        // nunca responder/pular/confirmar.
        computed = { state: 'decisao_externa', question: null, error: '' }
      }
    } else {
      // Evento de espera não alcançado (rede/paginação): recuperável.
      computed = {
        state: 'em_execucao',
        error: 'Espera ainda não identificada nos eventos (consulta inconclusiva).',
      }
    }
  } else if (status === 'stopped') {
    if (!bgFalse) {
      // bg true/omitido: pode acordar de novo / desconhecido — nunca 'pronta'.
      computed = { state: 'em_execucao', error: '' }
    } else {
      const scan = scanEvents(apiKey, taskId, 'result')
      if (scan.found && scan.found.continuation) {
        // Nova execução em curso (mensagem do dono mais recente que o último
        // resultado): resultado antigo NÃO é reaproveitado — continuação
        // comprovada também invalida um estado terminal gravado (M1A1b).
        continuationEvidence = true
        computed = { state: 'em_execucao', result: null, error: '' }
      } else if (scan.found && scan.found.so) {
        const so = scan.found.so
        if (so.success === true) {
          const val = validateResultValue(so.value, rec.getString('context'))
          if (val.ok) {
            computed = { state: 'pronta', result: so.value, error: '' }
          } else {
            // JSON efetivamente recebido e inválido → falha real.
            computed = { state: 'falha', error: 'JSON do resultado inválido: ' + val.error }
          }
        } else {
          const msg = so.error && typeof so.error === 'string' ? so.error : ''
          computed = { state: 'falha', error: 'Extração sem sucesso' + (msg ? ': ' + msg : '.') }
        }
      } else if (scan.found && scan.found.malformed) {
        // Envelope structured_output_result PRESENTE e malformado: falha de
        // formato explícita — NÃO ausência recuperável (M1A1b).
        computed = { state: 'falha', error: 'Envelope do resultado estruturado malformado.' }
      } else {
        // Resultado ainda não encontrado (ausência/paginação/rede): recuperável.
        computed = { state: 'em_execucao', error: 'Resultado estruturado ainda não disponível.' }
      }
    }
  } else {
    // running, deleted ou status desconhecido: segue em execução (recuperável).
    computed = { state: 'em_execucao', error: '' }
  }

  // ---------- identidade do evento (M1A1b) ----------
  // Identidade do evento que originou ESTA leitura computada: pergunta pela
  // message_id real; resultado pelo conteúdo; falha pela mensagem de erro.
  function questionReadKey(q) {
    if (!q || typeof q !== 'object') return ''
    return str(q.message_id) || (typeof q.text === 'string' ? 't:' + q.text : '')
  }
  function resultReadKey(r) {
    if (r === null || r === undefined) return ''
    try {
      return 'r:' + JSON.stringify(r)
    } catch (_) {
      return 'r:?'
    }
  }
  // Evento comprovadamente NOVO em relação ao estado gravado: em
  // 'aguardando_pergunta', uma pergunta de message_id diferente do gravado;
  // em 'pronta', um resultado de conteúdo diferente do gravado; em 'falha',
  // uma causa de erro diferente da gravada. Só um evento novo comprovado (ou
  // registro sem estado terminal anterior) autoriza SOBRESCREVER um estado
  // terminal gravado — leitura velha/fora de ordem (mesma identidade de evento
  // que a já gravada) NÃO regredi (M1A1b).
  const terminalFresh = ['pronta', 'falha', 'decisao_externa']
  let isNewEvent = false
  if (computed.state === 'aguardando_pergunta') {
    const fq = rec.get('question')
    isNewEvent = questionReadKey(fq) !== questionReadKey(computed.question)
  } else if (computed.state === 'pronta') {
    isNewEvent = resultReadKey(rec.get('result')) !== resultReadKey(computed.result)
  } else if (computed.state === 'falha') {
    isNewEvent = str(rec.getString('error')) !== str(computed.error)
  } else if (computed.state === 'decisao_externa') {
    isNewEvent = true
  }
  // Continuação comprovada (user_message mais recente que o resultado gravado):
  // a execução atual não é mais a que produziu o estado terminal — o resultado
  // antigo é invalidado seja qual for o estado computado (M1A1b).
  if (continuationEvidence) isNewEvent = true
  const recTerminal = terminalFresh.indexOf(rec.getString('state')) >= 0
  if (recTerminal && !isNewEvent) {
    // Leitura velha/fora de ordem sobre estado terminal: o estado gravado é
    // mais novo — nada é substituído (vale para pronta, falha E decisao;
    // M1A1b: o guard antigo protegia só 'pronta' e congelava o estado).
    // A reserva já foi gravada. Nunca salvar o snapshot antigo nesta saída.
    const current = e.app.findRecordById('ai_requests', rec.id)
    return e.json(200, { request: serializeRequest(current), synced: false })
  }
  // recTerminal && isNewEvent: continuação legítima (pergunta/resultado/erro
  // comprovadamente novos) — invalida o estado/resultado antigo e grava abaixo.
  // !recTerminal: escrita normal como antes.
  // Espera antiga NÃO reabre pergunta de resposta já confirmada (M1A2a).
  computed = keepWaitingAnswer(rec, computed)
  // ---------- escrita guardada (transação void; resposta só após commit) ----------
  let outReq = null
  let wrote = false
  e.app.runInTransaction((txApp) => {
    let fresh = null
    try {
      fresh = txApp.findRecordById('ai_requests', rec.id)
    } catch (_) {
      fresh = null
    }
    if (!fresh || typeof fresh.getString !== 'function') {
      throw new NotFoundError('Pedido de esclarecimento não encontrado.')
    }
    if (!stillOurs(fresh)) {
      outReq = serializeRequest(fresh)
      return
    }
    fresh.set('state', computed.state)
    let newQuestion = computed.question !== undefined ? computed.question : null
    if (newQuestion === null) {
      const fq = fresh.get('question')
      if (fq && typeof fq === 'object' && fq.answered === true) newQuestion = fq
    }
    // M1A2a: preservar answer_delivery/answered da MESMA pergunta (mesmo
    // message_id) quando a leitura nova a redefine; leitura sem ID de pergunta
    // NUNCA apaga o claim; somente ID novo comprovado libera a substituição.
    newQuestion = preserveExistingAnswer(fresh.get('question'), newQuestion)
    fresh.set('question', newQuestion)
    if (computed.result !== undefined) {
      fresh.set('result', computed.result)
    } else if (recTerminal || computed.state !== 'aguardando_pergunta') {
      // Estado que não é resultado novo (ex.: pergunta nova sobre um 'pronta'
      // gravado, em_execucao após continuação): resultado antigo NÃO sobrevive
      // — ele pertence à execução anterior (M1A1b).
      fresh.set('result', null)
    }
    if (computed.error !== undefined || computed.state !== 'aguardando_pergunta') {
      fresh.set('error', computed.error !== undefined ? computed.error : '')
    }
    txApp.save(fresh)
    wrote = true
    outReq = serializeRequest(fresh)
  })
  if (!outReq) throw new ApiError(500, 'Não foi possível ler o pedido atualizado.')
  return e.json(200, { request: outReq, synced: wrote })
})

routerAdd('POST', '/backend/v1/ai/requests/{id}/answer', (e) => {
  // ---------- helpers (inline por callback) ----------
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
    return $http.send({
      url: 'https://api.manus.ai' + path,
      method: method,
      headers: { 'x-manus-api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: timeoutSec || 12,
      body: bodyObj ? JSON.stringify(bodyObj) : null,
    })
  }
  function officialOk(resp) {
    return (
      !!resp &&
      typeof resp.statusCode === 'number' &&
      resp.statusCode < 300 &&
      resp.json &&
      typeof resp.json === 'object' &&
      resp.json.ok === true
    )
  }
  function parseSendResponse(resp) {
    if (!officialOk(resp)) {
      return { ok: false, error: sanitizeErr(null, resp) }
    }
    return { ok: true }
  }
  function normalizeAnswerText(t) {
    // Texto normalizado da resposta — impressão digital nativa estável
    // (trim + colapso de espaços). SEM hash inventado.
    return String(t == null ? '' : t)
      .trim()
      .replace(/\s+/g, ' ')
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
  const questionId = str(body.question_id)
  // Contrato M1A2a: text, answer_request_id e question_id NÃO vazios
  // (question_id = message_id da pergunta EXIBIDA ao dono).
  if (!text) throw new BadRequestError('text é obrigatório e não pode ser vazio.')
  if (!answerRequestId) {
    throw new BadRequestError('answer_request_id é obrigatório.')
  }
  if (!questionId) {
    throw new BadRequestError('question_id é obrigatório (message_id da pergunta exibida).')
  }

  let rec
  try {
    rec = e.app.findRecordById('ai_requests', id)
  } catch (_) {
    throw new NotFoundError('Pedido de esclarecimento não encontrado.')
  }
  if (rec.getString('user_id') !== userId) {
    throw new ForbiddenError('Pedido pertence a outro usuário.')
  }

  // ---------- leitura local (dedup sem transação) ----------
  // Confirmação já finalizada para ESTA pergunta: duplicate sem HTTP.
  const q = rec.get('question')
  const questionObj = q && typeof q === 'object' && !Array.isArray(q) ? q : null
  const delivery =
    questionObj && questionObj.answer_delivery && typeof questionObj.answer_delivery === 'object'
      ? questionObj.answer_delivery
      : null
  if (questionObj && questionObj.answered === true) {
    const confirmedSame =
      !!delivery &&
      delivery.state === 'confirmada' &&
      str(questionObj.message_id) === questionId &&
      str(delivery.question_id) === questionId &&
      str(delivery.remote_task_id) === rec.getString('remote_task_id') &&
      str(questionObj.task_id) === rec.getString('remote_task_id') &&
      delivery.answer_request_id === answerRequestId &&
      typeof delivery.text === 'string' &&
      delivery.text === normalizeAnswerText(text)
    if (confirmedSame) {
      return e.json(200, { duplicate: true, request: serializeRequest(rec) })
    }
    // Marcador antigo answered:true SEM delivery (era anterior ao claim): bloqueia
    // reenvio — nunca inferir nem reescrever históricos.
    throw new ApiError(409, 'Resposta desta pergunta já foi confirmada anteriormente.')
  }
  // Claim vivo (enviando/incerta): bloqueia QUALQUER segundo POST (mesmo ou
  // outro answer_request_id/texto) — sem TTL, sem refresh, sem reenvio.
  if (delivery && (delivery.state === 'enviando' || delivery.state === 'incerta')) {
    throw new ApiError(409, 'Resposta em envio/incerta: confirmação pendente; não reenviada.')
  }

  // ---------- pré-condição: espera de pergunta comum ----------
  if (rec.getString('state') !== 'aguardando_pergunta') {
    throw new ApiError(409, 'Pedido não está aguardando resposta do dono.')
  }
  if (!questionObj) {
    throw new ApiError(409, 'Pedido sem pergunta pendente registrada.')
  }
  const qType = str(questionObj.type)
  // Apenas espera de pergunta comum (messageAskUser/cascadeAskUser): outras
  // esperas ficam em 'decisao_externa' — nunca responder/pular/confirmar.
  if (qType !== 'messageAskUser' && qType !== 'cascadeAskUser') {
    throw new ApiError(409, 'Espera atual não é uma pergunta ao dono; decisão externa necessária.')
  }
  // A pergunta respondida tem de ser a MESMA exibida ao dono (id esperado).
  if (str(questionObj.message_id) !== questionId) {
    throw new ApiError(409, 'Pergunta respondida não é mais a pergunta pendente.')
  }
  const taskId = rec.getString('remote_task_id')
  if (!taskId) {
    throw new ApiError(409, 'Pedido sem tarefa remota vinculada.')
  }
  const apiKey = $os.getenv('MANUS_API_KEY') || ''
  if (!apiKey) {
    throw new ApiError(503, 'Integração Manus desligada/não configurada.')
  }

  // ---------- CLAIM durável: gravar 'enviando' ANTES do POST ----------
  // Transação void (contrato JSVM): resultado em variável local; resposta HTTP
  // só após commit. Sem HTTP dentro da transação. task_id/owner derivados do
  // registro RELIDO na transação — nunca do payload do cliente.
  let claimOk = false
  let claimErr = null
  e.app.runInTransaction((txApp) => {
    let fresh = null
    try {
      fresh = txApp.findRecordById('ai_requests', id)
    } catch (_) {
      fresh = null
    }
    if (!fresh || typeof fresh.getString !== 'function') {
      claimErr = new NotFoundError('Pedido de esclarecimento não encontrado.')
      return
    }
    // Revalidação ATÔMICA dentro da transação: dono, tarefa remota, estado,
    // tipo de pergunta comum e ID esperado — tudo contra o registro fresco.
    if (fresh.getString('user_id') !== userId) {
      claimErr = new ForbiddenError('Pedido pertence a outro usuário.')
      return
    }
    const fq = fresh.get('question')
    const freshQ = fq && typeof fq === 'object' && !Array.isArray(fq) ? fq : null
    const freshDelivery =
      freshQ && freshQ.answer_delivery && typeof freshQ.answer_delivery === 'object'
        ? freshQ.answer_delivery
        : null
    if (freshQ && freshQ.answered === true) {
      claimErr = new ApiError(409, 'Resposta desta pergunta já foi confirmada anteriormente.')
      return
    }
    if (
      freshDelivery &&
      (freshDelivery.state === 'enviando' || freshDelivery.state === 'incerta')
    ) {
      claimErr = new ApiError(
        409,
        'Resposta em envio/incerta: confirmação pendente; não reenviada.',
      )
      return
    }
    if (fresh.getString('state') !== 'aguardando_pergunta') {
      claimErr = new ApiError(409, 'Pedido não está aguardando resposta do dono.')
      return
    }
    if (
      !freshQ ||
      (str(freshQ.type) !== 'messageAskUser' && str(freshQ.type) !== 'cascadeAskUser')
    ) {
      claimErr = new ApiError(
        409,
        'Espera atual não é uma pergunta ao dono; decisão externa necessária.',
      )
      return
    }
    if (str(freshQ.message_id) !== questionId) {
      claimErr = new ApiError(409, 'Pergunta respondida não é mais a pergunta pendente.')
      return
    }
    const freshTaskId = fresh.getString('remote_task_id')
    if (!freshTaskId) {
      claimErr = new ApiError(409, 'Pedido sem tarefa remota vinculada.')
      return
    }
    // O vínculo observado na tela/leitura inicial não pode mudar antes do claim.
    if (freshTaskId !== taskId || str(freshQ.task_id) !== freshTaskId) {
      claimErr = new ApiError(409, 'Vínculo da tarefa mudou; atualize o pedido antes de responder.')
      return
    }
    const freshQText = str(freshQ.text)
    const claim = {
      state: 'enviando',
      question_id: questionId,
      answer_request_id: answerRequestId,
      remote_task_id: freshTaskId,
      text: normalizeAnswerText(text),
    }
    const newQuestion = {
      type: str(freshQ.type),
      text: freshQText,
      message_id: questionId,
      task_id: freshTaskId,
    }
    if (freshQ.question_expectation && typeof freshQ.question_expectation === 'object') {
      newQuestion.question_expectation = freshQ.question_expectation
    }
    newQuestion.answer_delivery = claim
    fresh.set('question', newQuestion)
    try {
      txApp.save(fresh)
      claimOk = true
    } catch (_) {
      // Falha ao gravar o claim: SEM POST — persistir é a autorização.
      claimErr = new ApiError(
        500,
        'Não foi possível reservar o envio da resposta; nada foi enviado.',
      )
    }
  })
  if (claimErr) throw claimErr
  if (!claimOk)
    throw new ApiError(500, 'Não foi possível reservar o envio da resposta; nada foi enviado.')

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

  // ---------- finalização: reler em transação, validar dono e tuple ----------
  // Nunca salvar snapshot pré-HTTP; nunca substituir pergunta NOVA. Timeout,
  // rede ou resposta não confirmatória → claim 'incerta', erro sanitizado, sem
  // answered — confirmação pendente, não cancelamento.
  let outReq = null
  let finishErr = null
  e.app.runInTransaction((txApp) => {
    let fresh = null
    try {
      fresh = txApp.findRecordById('ai_requests', id)
    } catch (_) {
      fresh = null
    }
    if (!fresh || typeof fresh.getString !== 'function') {
      finishErr = new NotFoundError('Pedido de esclarecimento não encontrado.')
      return
    }
    if (fresh.getString('user_id') !== userId) {
      finishErr = new ForbiddenError('Pedido pertence a outro usuário.')
      return
    }
    const fq = fresh.get('question')
    const freshQ = fq && typeof fq === 'object' && !Array.isArray(fq) ? fq : null
    const freshDelivery =
      freshQ && freshQ.answer_delivery && typeof freshQ.answer_delivery === 'object'
        ? freshQ.answer_delivery
        : null
    // Tuple do claim deve ser EXATAMENTE o nosso (pergunta nova não pode ter
    // avançado; outro submit não pode ter tomado a reserva).
    const tupleOk =
      !!freshQ &&
      (str(freshQ.type) === 'messageAskUser' || str(freshQ.type) === 'cascadeAskUser') &&
      fresh.getString('remote_task_id') === taskId &&
      str(freshQ.message_id) === questionId &&
      str(freshQ.task_id) === taskId &&
      !!freshDelivery &&
      freshDelivery.state === 'enviando' &&
      str(freshDelivery.question_id) === questionId &&
      str(freshDelivery.answer_request_id) === answerRequestId &&
      str(freshDelivery.remote_task_id) === taskId &&
      freshDelivery.text === normalizeAnswerText(text)
    if (!tupleOk) {
      // Pergunta avançou ou claim não é mais o nosso: NUNCA sobrescrever a
      // pergunta nova nem fingir envio não ocorrido.
      finishErr = new ApiError(
        409,
        'Envio já finalizado por outra tentativa; resposta não reenviada.',
      )
      return
    }
    const parsedSend = sendErr ? null : parseSendResponse(resp)
    const okRemote = !!parsedSend && parsedSend.ok
    // request_id remoto só se REALMENTE recebido no corpo ok:true.
    const remoteRequestId =
      okRemote && resp.json && typeof resp.json === 'object' && str(resp.json.request_id)
        ? str(resp.json.request_id)
        : ''
    if (!okRemote) {
      // Incerta: confirmação pendente; sem answered; estado de espera
      // preservado; NUNCA apagar a reserva nem reenviar automaticamente.
      const incerta = {
        state: 'incerta',
        question_id: questionId,
        answer_request_id: answerRequestId,
        remote_task_id: taskId,
        text: normalizeAnswerText(text),
      }
      const newQuestion = {
        type: str(freshQ.type),
        text: str(freshQ.text),
        message_id: questionId,
        task_id: taskId,
      }
      if (freshQ.question_expectation && typeof freshQ.question_expectation === 'object') {
        newQuestion.question_expectation = freshQ.question_expectation
      }
      newQuestion.answer_delivery = incerta
      fresh.set('question', newQuestion)
      fresh.set('error', sendErr ? sanitizeErr(sendErr, null) : sanitizeErr(null, resp))
      try {
        txApp.save(fresh)
        outReq = serializeRequest(fresh)
      } catch (saveErr) {
        // Compensação falhou: a reserva 'enviando' persiste bloqueando retry
        // (crash-safe). Nada é apagado nem fingido.
        void saveErr
        outReq = serializeRequest(fresh)
      }
      return
    }
    // Confirmação: persistência local confirmada dentro da transação.
    const confirmed = {
      state: 'confirmada',
      question_id: questionId,
      answer_request_id: answerRequestId,
      remote_task_id: taskId,
      text: normalizeAnswerText(text),
    }
    const newQuestion = {
      type: str(freshQ.type),
      text: str(freshQ.text),
      message_id: questionId,
      task_id: taskId,
      answered: true,
      answer_request_id: answerRequestId,
      answer_delivery: confirmed,
    }
    if (freshQ.question_expectation && typeof freshQ.question_expectation === 'object') {
      newQuestion.question_expectation = freshQ.question_expectation
    }
    fresh.set('state', 'em_execucao')
    fresh.set('question', newQuestion)
    fresh.set('last_polled_at', new Date().toISOString())
    fresh.set('error', '')
    if (remoteRequestId) fresh.set('remote_request_id', remoteRequestId)
    try {
      txApp.save(fresh)
      outReq = serializeRequest(fresh)
    } catch (saveErr) {
      // Aceitação remota MAS persistência local falhou: claim 'enviando'
      // persiste (crash-safe). Compensação: tentar marcar 'incerta'.
      void saveErr
      let comp = {
        state: 'incerta',
        question_id: questionId,
        answer_request_id: answerRequestId,
        remote_task_id: taskId,
        text: normalizeAnswerText(text),
      }
      const cQ = {
        type: str(freshQ.type),
        text: str(freshQ.text),
        message_id: questionId,
        task_id: taskId,
      }
      if (freshQ.question_expectation && typeof freshQ.question_expectation === 'object') {
        cQ.question_expectation = freshQ.question_expectation
      }
      cQ.answer_delivery = comp
      fresh.set('question', cQ)
      fresh.set('error', 'Resposta possivelmente recebida pelo Manus; confirmação pendente.')
      try {
        txApp.save(fresh)
        outReq = serializeRequest(fresh)
      } catch (_) {
        // Compensação também falhou: reserva 'enviando' permanece — bloqueia
        // retry; nunca fingir envio não ocorrido.
        outReq = serializeRequest(fresh)
      }
    }
  })
  if (finishErr) throw finishErr
  if (!outReq) throw new ApiError(500, 'Não foi possível ler o pedido atualizado.')
  // Reexamina o resultado final da transação para decidir o status HTTP.
  const finalQ = outReq.question && typeof outReq.question === 'object' ? outReq.question : null
  const finalDelivery = finalQ && finalQ.answer_delivery ? finalQ.answer_delivery.state : ''
  if (finalDelivery === 'confirmada') {
    return e.json(200, { duplicate: false, request: outReq })
  }
  if (finalDelivery === 'enviando' && sendErr === null && resp !== null) {
    // Aceitação remota, mas persistência local falhou (compensação incluída):
    // confirmação pendente, nunca cancelamento/rejeição certa.
    throw new ApiError(502, 'Resposta possivelmente recebida pelo Manus; confirmação pendente.')
  }
  throw new ApiError(502, 'Manus não confirmou o recebimento da resposta; confirmação pendente.')
})
