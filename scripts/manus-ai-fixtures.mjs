// Variante local: a pergunta normal possui associação por ID explicitamente demonstrada.
// VARIANTE LOCAL: somente expectativas de teste corrigidas. Hook original intacto.
// Fixtures M1A1 — execução ISOLADA dos callbacks REAIS do hook
// pocketbase/hooks/manus-ai.pb.js em Node VM (sem JSVM, rede ou banco real).
// Nada aqui chama api.manus.ai: $http é stub; gate OFF é o cenário padrão.
//
// Não é lógica espelhada: o FONTE do hook é carregado e as rotas registradas
// são invocadas com eventos (e), app, Record, $os e $http simulados.
//
// Executar na máquina do dono:  node scripts/manus-ai-fixtures.mjs
// (a plataforma Skip não executa Node — resultado aqui não substitui QA).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../pocketbase/hooks/manus-ai.pb.js', import.meta.url), 'utf8')

const PATHS = {
  create: 'POST /backend/v1/ai/clarify',
  get: 'GET /backend/v1/ai/requests/{id}',
  answer: 'POST /backend/v1/ai/requests/{id}/answer',
}

const VALID_RESULT = {
  kind: 'esclarecimento',
  missing_data: false,
  waiting_or_decision: false,
  explanation: 'Explicação fictícia.',
  proposal: null,
  next_step_suggestion: 'Próximo passo fictício.',
}

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const errorClass = (status) =>
  class extends ApiError {
    constructor(m) {
      super(status, m)
    }
  }

// Record simulado com semântica PocketBase: getString devolve '' para vazio e
// set atualiza o MESMO valor lido por getString/get.
class Rec {
  constructor(f = {}) {
    this.id = f.id || 'pedido-ficticio'
    this.f = { ...f }
  }
  getString(k) {
    const v = this.f[k]
    return v == null ? '' : String(v)
  }
  get(k) {
    return this.f[k]
  }
  set(k, v) {
    this.f[k] = v
  }
}

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString()
}

// httpStub(config) é chamado a cada $http.send — regista e devolve a resposta.
function setup({ enabled = true, request = {}, capture = {}, httpStub, existing = false } = {}) {
  const routes = new Map()
  const calls = []
  const saves = []
  const createdRecords = new Map() // somente registros salvos pelo callback de criação

  const rec = new Rec({
    user_id: 'usuario-ficticio',
    state: 'em_execucao',
    remote_task_id: 'tarefa-ficticia',
    context: 'vida',
    origin_type: 'captura',
    origin_id: 'captura-ficticia',
    origin_revision: 'Texto fictício|2026-11-10 00:00:00.000Z',
    local_request_id: 'l1',
    schema_version: '2026-11-10',
    prompt_revision: 'm1a1-1',
    last_polled_at: isoAgo(10 * 60 * 1000), // fora da janela de coalescência
    ...request,
  })
  const cap = new Rec({
    id: 'captura-ficticia',
    user_id: 'usuario-ficticio',
    status: 'pendente',
    raw_text: 'Texto fictício',
    updated: '2026-11-10 00:00:00.000Z',
    ...capture,
  })

  const app = {
    findRecordById(col, id) {
      if (col === 'captures') return cap
      if (col === 'ai_requests') return createdRecords.get(id) || rec
      throw new Error('Coleção inesperada no mock: ' + col)
    },
    findFirstRecordByFilter(col, filter, params) {
      // Dedup: registro existente APENAS quando o teste declara existing=true
      // (simula um pedido anterior com o mesmo local_request_id).
      if (
        existing &&
        col === 'ai_requests' &&
        params &&
        params.l === rec.getString('local_request_id')
      ) {
        return rec
      }
      throw new Error('Registro não encontrado no mock.')
    },
    findRecordsByFilter(col, filter, sort, limit, offset, params) {
      // Modela os dois contratos atuais da consulta, não SQL/JSVM nativo.
      assert.equal(col, 'ai_requests')
      assert.equal(sort, '')
      assert.equal(limit, 1)
      assert.equal(offset, 0)
      const byId = 'user_id = {:u} && local_request_id = {:l}'
      const byOrigin =
        "user_id = {:u} && origin_id = {:o} && (state = 'registrado' || state = 'criacao_incerta')"
      assert.ok(filter === byId || filter === byOrigin, 'filtro não modelado pelo harness')
      const records = [...createdRecords.values()]
      if (existing && !records.includes(rec)) records.push(rec)
      return records
        .filter((r) => {
          if (r.getString('user_id') !== params.u) return false
          if (filter === byId) return r.getString('local_request_id') === params.l
          return (
            r.getString('origin_id') === params.o &&
            ['registrado', 'criacao_incerta'].includes(r.getString('state'))
          )
        })
        .slice(0, limit)
    },
    findCollectionByNameOrId() {
      return {}
    },
    runInTransaction(cb) {
      // Contrato JSVM: callback void — retorno de objeto reverteria a transação.
      // Harness legado de referência: semântica de retorno void; não modela
      // rollback geral. A suíte dedicada de criação possui snapshots/rollback.
      assert.equal(cb(app), undefined, 'callback de transação deve ser void')
    },
    save(r) {
      saves.push({ ...r.f })
      if (r !== rec) createdRecords.set(r.id, r)
    },
  }

  const globals = {
    routerAdd(method, path, cb) {
      routes.set(method + ' ' + path, cb)
    },
    ApiError,
    UnauthorizedError: errorClass(401),
    ForbiddenError: errorClass(403),
    BadRequestError: errorClass(400),
    NotFoundError: errorClass(404),
    Record: Rec,
    $os: {
      // Objeto com getenv (como na JSVM) — NÃO uma função.
      getenv(k) {
        if (k === 'MANUS_AI_ENABLED') return enabled ? '1' : ''
        if (k === 'MANUS_API_KEY') return enabled ? 'CHAVE-FICTICIA-SEM-VALIDADE' : ''
        return ''
      },
    },
    $http: {
      send(config) {
        calls.push(config)
        if (httpStub) return httpStub(config)
        return { statusCode: 200, json: { ok: true, task_id: 'tarefa-ficticia' } }
      },
    },
  }
  vm.runInContext(source, vm.createContext(globals), {
    timeout: 1000,
    filename: 'manus-ai.pb.js',
  })

  function invoke(key, body = {}) {
    const e = {
      auth: { id: 'usuario-ficticio' },
      app,
      requestInfo() {
        return { body }
      },
      request: {
        pathValue() {
          return rec.id
        },
      },
      json(status, value) {
        return { status, value }
      },
    }
    try {
      return { response: routes.get(key)(e) }
    } catch (error) {
      return { error }
    }
  }
  return { rec, cap, calls, saves, invoke }
}

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('OK: ' + name)
  } catch (err) {
    failures.push(name)
    console.log('FALHOU: ' + name + ' — ' + (err && err.message))
  }
}

const listPage = (msgs, hasMore = false, nextCursor = '') => ({
  statusCode: 200,
  json: {
    ok: true,
    request_id: 'req',
    task_id: 'tarefa-ficticia',
    messages: msgs,
    has_more: hasMore,
    next_cursor: nextCursor,
  },
})
const detailOf = (task) => ({ statusCode: 200, json: { ok: true, task } })
const ev = (type, extra = {}, ts = 0) => ({
  id: 'ev-' + type + '-' + ts,
  type,
  timestamp: ts,
  ...extra,
})
const waitEvent = (waitType, ts) =>
  ev(
    'status_update',
    {
      status_update: {
        agent_status: 'waiting',
        status_detail: { waiting_for_event_type: waitType, waiting_for_event_id: 'ev-espera' },
      },
    },
    ts,
  )
const askMsg = (text, ts) => ev('assistant_message', { assistant_message: { content: text } }, ts)
const soEvent = (value, ts) =>
  ev('structured_output_result', { structured_output_result: { success: true, value } }, ts)

// ---------------------------------------------------------------- gate OFF --
check('gate OFF: clarify devolve 503, sem HTTP e sem gravação', () => {
  const s = setup({ enabled: false })
  assert.equal(
    s.invoke(PATHS.create, {
      capture_id: 'captura-ficticia',
      context: 'vida',
      local_request_id: 'l1',
    }).error.status,
    503,
  )
  assert.equal(s.calls.length, 0)
  assert.equal(s.saves.length, 0)
})
check('gate OFF: GET devolve request local com synced:false, sem HTTP e sem erro de helper', () => {
  const s = setup({
    enabled: false,
    request: {
      state: 'aguardando_pergunta',
      question: { type: 'messageAskUser', text: 'Pergunta fictícia', message_id: 'q1' },
    },
  })
  const r = s.invoke(PATHS.get)
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.synced, false)
  assert.equal(r.response.value.request.state, 'aguardando_pergunta')
  assert.equal(r.response.value.request.question.text, 'Pergunta fictícia')
  assert.equal(s.calls.length, 0)
})
check('gate OFF: answer devolve 503 sem HTTP e sem alterar estado', () => {
  const s = setup({
    enabled: false,
    request: {
      state: 'aguardando_pergunta',
      question: { type: 'messageAskUser', text: 'Pergunta fictícia', message_id: 'q1' },
    },
  })
  assert.equal(
    s.invoke(PATHS.answer, { text: 'Resposta fictícia', answer_request_id: 'a1' }).error.status,
    503,
  )
  assert.equal(s.calls.length, 0)
  assert.equal(s.rec.getString('state'), 'aguardando_pergunta')
})

// ----------------------------------------------------------------- clarify --
check('clarify: payload usa agent_profile standard, sem profile, com campos v2 fixos', () => {
  const s = setup()
  const r = s.invoke(PATHS.create, {
    capture_id: 'captura-ficticia',
    context: 'vida',
    local_request_id: 'l1',
  })
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.duplicate, false)
  const payload = JSON.parse(s.calls[0].body)
  assert.equal(s.calls[0].url, 'https://api.manus.ai/v2/task.create')
  assert.equal(payload.agent_profile, 'standard')
  assert.equal(payload.profile, undefined)
  assert.equal(payload.project_id, 'QYbSBGo5T5KRsS2p9X8XYv')
  assert.equal(payload.clear_connectors, true)
  assert.equal(payload.share_visibility, 'private')
  assert.equal(payload.interactive_mode, true)
  assert.equal(payload.hide_in_task_list, false)
})
check(
  'clarify: confirmação oficial exige ok:true — corpo ok:false vira criacao_incerta/502',
  () => {
    const s = setup({
      httpStub: () => ({
        statusCode: 200,
        json: { ok: false, error: { code: 'x', message: 'recusado' } },
      }),
    })
    const r = s.invoke(PATHS.create, {
      capture_id: 'captura-ficticia',
      context: 'vida',
      local_request_id: 'l1',
    })
    assert.equal(r.error.status, 502)
    assert.equal(s.saves.at(-1).state, 'criacao_incerta')
    assert.ok(!s.saves.at(-1).remote_task_id)
  },
)
check('clarify: HTTP 5xx com corpo ok:true NÃO é sucesso', () => {
  const s = setup({
    httpStub: () => ({ statusCode: 502, json: { ok: true, task_id: 'tarefa-ficticia' } }),
  })
  const r = s.invoke(PATHS.create, {
    capture_id: 'captura-ficticia',
    context: 'vida',
    local_request_id: 'l1',
  })
  assert.equal(r.error.status, 502)
  assert.equal(s.saves.at(-1).state, 'criacao_incerta')
})
check('clarify: contexto ausente/inválido é recusado antes de persistir', () => {
  const s = setup()
  assert.equal(
    s.invoke(PATHS.create, { capture_id: 'captura-ficticia', local_request_id: 'l1' }).error.status,
    400,
  )
  assert.equal(
    s.invoke(PATHS.create, {
      capture_id: 'captura-ficticia',
      context: 'pessoal',
      local_request_id: 'l2',
    }).error.status,
    400,
  )
  assert.equal(s.saves.length, 0)
  assert.equal(s.calls.length, 0)
  for (const context of ['vida', 'trabalho']) {
    const valid = setup()
    const response = valid.invoke(PATHS.create, {
      capture_id: 'captura-ficticia',
      context,
      local_request_id: 'valido-' + context,
    })
    assert.equal(response.response.status, 200)
    assert.equal(JSON.parse(valid.calls[0].body).message.content.includes(context), true)
  }
})

// -------------------------------------------------------------- GET: espera --
check(
  'GET: waiting + status_update(messageAskUser) + assistant_message => aguardando_pergunta com texto',
  () => {
    const s = setup({
      httpStub(config) {
        if (config.url.includes('task.detail'))
          return detailOf({ status: 'waiting', has_running_background_jobs: true })
        // order=desc: eventos mais recentes primeiro — espera (ts 200) vem antes
        // da assistant_message que a originou (ts 100).
        if (config.url.includes('task.listMessages'))
          return listPage([
            waitEvent('messageAskUser', 200),
            { ...askMsg('Qual o prazo?', 100), id: 'ev-espera' },
          ])
        throw new Error('URL inesperada: ' + config.url)
      },
    })
    const r = s.invoke(PATHS.get)
    assert.equal(r.response.status, 200)
    assert.equal(r.response.value.synced, true)
    assert.equal(s.rec.getString('state'), 'aguardando_pergunta')
    assert.equal(s.rec.get('question').text, 'Qual o prazo?')
    assert.equal(s.rec.get('question').type, 'messageAskUser')
    assert.equal(s.calls.length, 2) // detail + 1 página de eventos
  },
)
check('GET: waiting de pergunta SEM texto nos eventos permanece recuperável (em_execucao)', () => {
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail')) return detailOf({ status: 'waiting' })
      if (config.url.includes('task.listMessages'))
        return listPage([waitEvent('messageAskUser', 100)])
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  const r = s.invoke(PATHS.get)
  assert.equal(r.response.status, 200)
  assert.equal(s.rec.getString('state'), 'em_execucao')
})
check('GET: espera que não é pergunta ao dono vira decisao_externa', () => {
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail')) return detailOf({ status: 'waiting' })
      if (config.url.includes('task.listMessages'))
        return listPage([waitEvent('confirmAction', 200), askMsg('Agendado.', 100)])
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'decisao_externa')
})
check(
  'GET: task.detail stopped SEM stop_reason/structured_output (polling) + evento => pronta',
  () => {
    const s = setup({
      httpStub(config) {
        if (config.url.includes('task.detail'))
          return detailOf({ status: 'stopped', has_running_background_jobs: false })
        if (config.url.includes('task.listMessages'))
          return listPage([soEvent(VALID_RESULT, 300), askMsg('Feito.', 200)])
        throw new Error('URL inesperada: ' + config.url)
      },
    })
    const r = s.invoke(PATHS.get)
    assert.equal(r.response.status, 200)
    assert.equal(s.rec.getString('state'), 'pronta')
    assert.deepEqual(s.rec.get('result'), VALID_RESULT)
  },
)
check('GET: paginação segue next_cursor e listMessages é consultada com verbose=true', () => {
  let listCalls = 0
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail'))
        return detailOf({ status: 'stopped', has_running_background_jobs: false })
      if (config.url.includes('task.listMessages')) {
        listCalls++
        assert.ok(config.url.includes('verbose=true'), 'listMessages deve pedir verbose=true')
        if (listCalls === 1) {
          assert.ok(config.url.includes('cursor=') === false)
          return listPage([askMsg('Trabalhando...', 400)], true, 'cursor-pagina-2')
        }
        assert.ok(config.url.includes('cursor=cursor-pagina-2'))
        return listPage([soEvent(VALID_RESULT, 300)])
      }
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  const r = s.invoke(PATHS.get)
  assert.equal(listCalls, 2)
  assert.equal(s.rec.getString('state'), 'pronta')
})
check('GET: resultado fora da janela de páginas fica recuperável, nunca falso sucesso', () => {
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail'))
        return detailOf({ status: 'stopped', has_running_background_jobs: false })
      if (config.url.includes('task.listMessages'))
        return listPage([askMsg('Andamento.', 400)], false, '')
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  const r = s.invoke(PATHS.get)
  assert.equal(r.response.value.synced, true)
  assert.equal(s.rec.getString('state'), 'em_execucao')
  assert.ok(s.rec.getString('error').length > 0)
})

// --------------------------------------------- GET: prontidão conservadora --
for (const bg of [true, undefined]) {
  check(
    'GET: stopped com has_running_background_jobs ' +
      (bg === undefined ? 'OMITIDO' : 'true') +
      ' NUNCA vira pronta',
    () => {
      const task = { status: 'stopped' }
      if (bg !== undefined) task.has_running_background_jobs = bg
      const s = setup({
        httpStub(config) {
          if (config.url.includes('task.detail')) return detailOf(task)
          if (config.url.includes('task.listMessages'))
            return listPage([soEvent(VALID_RESULT, 300)])
          throw new Error('URL inesperada: ' + config.url)
        },
      })
      s.invoke(PATHS.get)
      assert.equal(s.rec.getString('state'), 'em_execucao')
      assert.equal(s.calls.length, 1) // só detail: resultado nem é consultado
    },
  )
}
check(
  'GET: user_message mais recente que o structured_output_result = continuação; resultado antigo não reaproveitado',
  () => {
    const s = setup({
      request: { result: { antigo: true } },
      httpStub(config) {
        if (config.url.includes('task.detail'))
          return detailOf({ status: 'stopped', has_running_background_jobs: false })
        if (config.url.includes('task.listMessages')) {
          return listPage([
            ev('user_message', { user_message: { content: 'Continua, muda o título' } }, 500),
            soEvent(VALID_RESULT, 300),
            askMsg('Feito antes.', 200),
          ])
        }
        throw new Error('URL inesperada: ' + config.url)
      },
    })
    s.invoke(PATHS.get)
    assert.equal(s.rec.getString('state'), 'em_execucao')
    assert.equal(s.rec.get('result'), null)
  },
)

// ------------------------------------------------------- GET: falhas reais --
check('GET: structured_output success:false EFETIVAMENTE recebido é falha real', () => {
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail'))
        return detailOf({ status: 'stopped', has_running_background_jobs: false })
      if (config.url.includes('task.listMessages'))
        return listPage([
          ev(
            'structured_output_result',
            { structured_output_result: { success: false, error: 'extração sem dados' } },
            300,
          ),
        ])
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'falha')
  assert.ok(s.rec.getString('error').includes('extração sem dados'))
})
for (const [nome, valor] of [
  ['campo desconhecido', { ...VALID_RESULT, campo_desconhecido: true }],
  [
    'required ausente (sem proposal)',
    { kind: 'esclarecimento', missing_data: false, waiting_or_decision: false, explanation: 'x' },
  ],
  [
    'contexto divergente',
    {
      ...VALID_RESULT,
      kind: 'projeto',
      proposal: {
        kind: 'projeto',
        title: 'T',
        context: 'trabalho',
        aspiration: null,
        controllable_delivery: null,
        completion_condition: null,
      },
    },
  ],
  [
    'ação com campo de projeto',
    {
      ...VALID_RESULT,
      kind: 'acao',
      proposal: {
        kind: 'acao',
        title: 'T',
        context: 'vida',
        aspiration: 'x',
        controllable_delivery: null,
        completion_condition: null,
      },
    },
  ],
  [
    'nullable violado',
    {
      ...VALID_RESULT,
      kind: 'projeto',
      proposal: {
        kind: 'projeto',
        title: 'T',
        context: 'vida',
        aspiration: 7,
        controllable_delivery: null,
        completion_condition: null,
      },
    },
  ],
  ['proposal ausente em projeto', { ...VALID_RESULT, kind: 'projeto', proposal: null }],
]) {
  check('GET: JSON inválido (' + nome + ') recebido é falha real, não pronta', () => {
    const s = setup({
      httpStub(config) {
        if (config.url.includes('task.detail'))
          return detailOf({ status: 'stopped', has_running_background_jobs: false })
        if (config.url.includes('task.listMessages')) return listPage([soEvent(valor, 300)])
        throw new Error('URL inesperada: ' + config.url)
      },
    })
    s.invoke(PATHS.get)
    assert.equal(s.rec.getString('state'), 'falha')
  })
}
check('GET: esclarecimento com proposal null e campos de projeto em null continua válido', () => {
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail'))
        return detailOf({ status: 'stopped', has_running_background_jobs: false })
      if (config.url.includes('task.listMessages')) return listPage([soEvent(VALID_RESULT, 300)])
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'pronta')
})
check('GET: erro de rede no task.detail é transitório — estado preservado, synced:false', () => {
  const s = setup({
    httpStub() {
      throw new Error('timeout fictício')
    },
  })
  const r = s.invoke(PATHS.get)
  assert.equal(r.response.value.synced, false)
  assert.equal(s.rec.getString('state'), 'em_execucao')
  assert.ok(s.rec.getString('error').includes('Timeout'))
})
check('GET: task.detail status error é falha real', () => {
  const s = setup({
    httpStub() {
      return detailOf({ status: 'error' })
    },
  })
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'falha')
})
check('GET: coalescência (última consulta < 15s) não consulta Manus', () => {
  const s = setup({ request: { last_polled_at: new Date().toISOString() } })
  const r = s.invoke(PATHS.get)
  assert.equal(r.response.value.synced, false)
  assert.equal(s.calls.length, 0)
})
check('GET: leitura sobreposta não regredi estado terminal mais novo (pronta)', () => {
  // A escrita da primeira consulta deixa pronta; a segunda (evento antigo)
  // não pode regredir para em_execucao.
  let listCalls = 0
  const s = setup({
    httpStub(config) {
      if (config.url.includes('task.detail'))
        return detailOf({ status: 'stopped', has_running_background_jobs: false })
      if (config.url.includes('task.listMessages')) {
        listCalls++
        return listCalls === 1
          ? listPage([soEvent(VALID_RESULT, 300)])
          : listPage([askMsg('Ainda trabalhando.', 400)], false, '')
      }
      throw new Error('URL inesperada: ' + config.url)
    },
  })
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'pronta')
  s.rec.set('last_polled_at', isoAgo(10 * 60 * 1000)) // reabre janela de consulta
  s.invoke(PATHS.get)
  assert.equal(s.rec.getString('state'), 'pronta')
})

// ----------------------------------------------------------------- answer --
// M1A2a: answer_request_id E question_id (message_id da pergunta exibida)
// são OBRIGATÓRIOS; a rota revalida tudo dentro da transação do claim.
const answerRec = {
  state: 'aguardando_pergunta',
  question: {
    type: 'messageAskUser',
    text: 'Pergunta fictícia',
    message_id: 'q1',
    task_id: 'tarefa-ficticia',
  },
}
const answerSubmit = (s, text = 'Resposta fictícia', extra = {}) =>
  s.invoke(PATHS.answer, { text, answer_request_id: 'a1', question_id: 'q1', ...extra })

check('answer: sucesso remoto confirma localmente (question.answered, estado em_execucao)', () => {
  const s = setup({
    request: answerRec,
    httpStub: () => ({ statusCode: 200, json: { ok: true, request_id: 'r' } }),
  })
  const r = answerSubmit(s)
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.duplicate, false)
  assert.equal(s.rec.getString('state'), 'em_execucao')
  assert.equal(s.rec.get('question').answered, true)
  assert.equal(s.rec.get('question').answer_request_id, 'a1')
  assert.equal(s.rec.get('question').answer_delivery.state, 'confirmada')
  // request_id remoto só se REALMENTE recebido — e gravado no registro.
  assert.equal(s.rec.getString('remote_request_id'), 'r')
  const payload = JSON.parse(s.calls[0].body)
  assert.equal(s.calls[0].url, 'https://api.manus.ai/v2/task.sendMessage')
  assert.equal(payload.task_id, 'tarefa-ficticia')
})
check('answer: mesmo answer_request_id confirmado é duplicate sem segundo HTTP', () => {
  const s = setup({ request: answerRec, httpStub: () => ({ statusCode: 200, json: { ok: true } }) })
  assert.equal(answerSubmit(s).response.value.duplicate, false)
  const before = s.calls.length
  const r = answerSubmit(s)
  assert.equal(r.response.value.duplicate, true)
  assert.equal(s.calls.length, before)
})
check(
  'answer: timeout → claim incerta bloqueia reenvio; espera preservada; erro sanitizado',
  () => {
    const s = setup({
      request: answerRec,
      httpStub() {
        throw new Error('timeout fictício')
      },
    })
    assert.equal(answerSubmit(s).error.status, 502)
    // Estado geral segue somente valores existentes; sem answered.
    assert.equal(s.rec.getString('state'), 'aguardando_pergunta')
    assert.equal(s.rec.get('question').answered, undefined)
    const d = s.rec.get('question').answer_delivery
    assert.equal(d.state, 'incerta')
    assert.equal(d.question_id, 'q1')
    assert.equal(d.answer_request_id, 'a1')
    assert.equal(d.remote_task_id, 'tarefa-ficticia')
    // Mesmo ID: NÃO libera segundo POST.
    assert.equal(answerSubmit(s).error.status, 409)
    // Outro ID também não libera (sem TTL, sem reenvio).
    assert.equal(
      answerSubmit(s, 'Resposta fictícia', { answer_request_id: 'a2' }).error.status,
      409,
    )
    assert.ok(s.rec.getString('error').length > 0)
  },
)
check('answer: estado sem pergunta pendente é recusado com 409', () => {
  const s = setup({ request: { state: 'pronta' } })
  assert.equal(answerSubmit(s).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('answer: espera decisao_externa nunca é respondida', () => {
  const s = setup({
    request: {
      state: 'decisao_externa',
      question: { type: 'confirmAction', text: 'Confirmar?', message_id: 'q2' },
    },
  })
  assert.equal(answerSubmit(s, 'ok').error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('answer: question_id ausente é 400; id errado é 409; nada é enviado', () => {
  const s = setup({ request: answerRec })
  assert.equal(answerSubmit(s, 'x', { question_id: '' }).error.status, 400)
  assert.equal(answerSubmit(s, 'x', { question_id: 'outra' }).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('answer: answer_request_id ausente é 400', () => {
  const s = setup({ request: answerRec })
  assert.equal(answerSubmit(s, 'x', { answer_request_id: '' }).error.status, 400)
  assert.equal(s.calls.length, 0)
})

// ------------------------------------------------------------------- resumo --
console.log('')
if (failures.length) {
  console.log('FALHAS: ' + failures.length + ' — ' + failures.join(' | '))
  process.exit(1)
}
console.log(
  'Total: ' +
    passed +
    ' verificações passaram. Execução isolada dos callbacks reais do hook; sem rede/banco reais.',
)
