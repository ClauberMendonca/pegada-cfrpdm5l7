// Testes locais de EXPECTATIVAS CORRETAS do acompanhamento (M1A1b + M1A2a).
// Casos 1..17: GET/polling (M1A1b, intocados). answerSubmit/cases finais: M1A2a.
// Hook original carregado em VM; HTTP, autenticação e banco são simulados.
// Falha significa critério não atendido, não reprodução aprovada de um defeito.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../pocketbase/hooks/manus-ai.pb.js', import.meta.url), 'utf8')
const clone = (value) => JSON.parse(JSON.stringify(value))
const VALID = {
  kind: 'esclarecimento',
  missing_data: false,
  waiting_or_decision: false,
  explanation: 'Fictício',
  proposal: null,
  next_step_suggestion: 'Próximo passo',
}
class Rec {
  constructor(f = {}) {
    this.id = f.id || 'pedido-ficticio'
    this.f = clone(f)
  }
  getString(k) {
    return this.f[k] == null ? '' : String(this.f[k])
  }
  get(k) {
    return this.f[k]
  }
  set(k, v) {
    this.f[k] = v
  }
}
class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const err = (status) =>
  class extends ApiError {
    constructor(message) {
      super(status, message)
    }
  }
const event = (id, type, payload, timestamp) => ({ id, type, timestamp, [type]: payload })
const waiting = (id = 'pergunta-atual', timestamp = 600) =>
  event(
    'wait-' + timestamp,
    'status_update',
    {
      agent_status: 'waiting',
      status_detail: { waiting_for_event_type: 'messageAskUser', waiting_for_event_id: id },
    },
    timestamp,
  )
const message = (id, content, timestamp, expectation) =>
  event(
    id,
    'assistant_message',
    {
      content,
      ...(expectation ? { question_expectation: expectation } : {}),
    },
    timestamp,
  )
const resultEvent = (value = VALID, timestamp = 300) =>
  event('resultado-' + timestamp, 'structured_output_result', { success: true, value }, timestamp)
const detail = (status, background = false) => ({
  statusCode: 200,
  json: { ok: true, task: { status, has_running_background_jobs: background } },
})
const page = (messages, has_more = false, next_cursor = '') => ({
  statusCode: 200,
  json: { ok: true, messages, has_more, next_cursor },
})
function setup({ initial = {}, http, beforeReservation, authAs }) {
  let db = {
    id: 'pedido-ficticio',
    user_id: 'usuario-ficticio',
    state: 'em_execucao',
    context: 'vida',
    remote_task_id: 'tarefa-ficticia',
    last_polled_at: '2020-01-01T00:00:00Z',
    updated: 'revisao-0',
    ...clone(initial),
  }
  let revision = 0
  let transactionCount = 0
  const calls = []
  const routes = new Map()
  const api = {
    row: () => clone(db),
    newerCommit: (changes) => {
      db = { ...db, ...clone(changes), updated: 'revisao-' + ++revision }
    },
  }
  const app = {
    // Cada consulta retorna uma cópia: snapshots não compartilham objeto mutável.
    findRecordById(collection) {
      assert.equal(collection, 'ai_requests')
      return new Rec(db)
    },
    save(rec) {
      db = { ...clone(rec.f), updated: 'revisao-' + ++revision }
      rec.set('updated', db.updated)
    },
    runInTransaction(cb) {
      transactionCount++
      if (transactionCount === 1 && beforeReservation) beforeReservation(api)
      assert.equal(cb(app), undefined, 'callback deve ser void')
    },
  }
  const globals = {
    routerAdd(method, path, callback) {
      routes.set(method + ' ' + path, callback)
    },
    ApiError,
    UnauthorizedError: err(401),
    ForbiddenError: err(403),
    BadRequestError: err(400),
    NotFoundError: err(404),
    Record: Rec,
    $os: {
      getenv(k) {
        return k === 'MANUS_AI_ENABLED' ? '1' : k === 'MANUS_API_KEY' ? 'FICTICIA-SEM-VALIDADE' : ''
      },
    },
    $http: {
      send(config) {
        calls.push(config)
        return http(config, api)
      },
    },
  }
  vm.runInContext(source, vm.createContext(globals), { timeout: 1000 })
  return {
    app,
    ...api,
    calls,
    invoke() {
      const e = {
        auth: { id: 'usuario-ficticio' },
        app,
        request: {
          pathValue() {
            return 'pedido-ficticio'
          },
        },
        json(status, value) {
          return { status, value }
        },
      }
      const response = routes.get('GET /backend/v1/ai/requests/{id}')(e)
      assert.equal(response.status, 200)
      return response
    },
    // M1A2a: invocação do POST /answer real do hook.
    answerSubmit(body) {
      const e = {
        auth: { id: authAs || 'usuario-ficticio' },
        app,
        request: {
          pathValue() {
            return 'pedido-ficticio'
          },
        },
        requestInfo() {
          return { body: clone(body) }
        },
        json(status, value) {
          return { status, value }
        },
      }
      try {
        return { response: routes.get('POST /backend/v1/ai/requests/{id}/answer')(e) }
      } catch (error) {
        return { error }
      }
    },
  }
}
let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass++
    console.log('OK: ' + name)
  } catch (e) {
    fail++
    console.log('FALHOU: ' + name + ' — ' + e.message)
  }
}

const pendingQuestion = (state) => ({
  type: 'messageAskUser',
  text: 'Pergunta exibida',
  message_id: 'q1',
  task_id: 'tarefa-ficticia',
  answer_delivery: {
    state,
    question_id: 'q1',
    answer_request_id: 'a1',
    remote_task_id: 'tarefa-ficticia',
    text: 'Resposta fictícia',
  },
})
const answerBody = (extra = {}) => ({
  text: 'Resposta fictícia',
  answer_request_id: 'a1',
  question_id: 'q1',
  ...extra,
})
const successRemote = () => ({ statusCode: 200, json: { ok: true } })

for (const state of ['enviando', 'incerta']) {
  check('GET running preserva reserva ' + state + ' e bloqueia novo answer', () => {
    const s = setup({
      initial: { state: 'aguardando_pergunta', question: pendingQuestion(state) },
      http: () => detail('running'),
    })
    s.invoke()
    assert.equal(s.row().question?.answer_delivery?.state, state)
    assert.equal(s.answerSubmit(answerBody({ answer_request_id: 'a2' })).error.status, 409)
    assert.equal(s.calls.filter((c) => c.url.includes('task.sendMessage')).length, 0)
  })
  check('GET waiting inconclusivo preserva reserva ' + state, () => {
    const s = setup({
      initial: { state: 'aguardando_pergunta', question: pendingQuestion(state) },
      http(config) {
        return config.url.includes('task.detail') ? detail('waiting') : page([waiting('q1')])
      },
    })
    s.invoke()
    assert.equal(s.row().question?.answer_delivery?.state, state)
    assert.equal(s.row().question?.message_id, 'q1')
  })
}
check('timeout → GET running → pergunta reaparece: nenhum segundo POST é permitido', () => {
  let status = 'running'
  let postCount = 0
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    http(config) {
      if (config.url.includes('task.sendMessage')) {
        postCount++
        throw new Error('timeout fictício')
      }
      if (config.url.includes('task.detail')) return detail(status)
      return page([waiting('q1'), message('q1', 'Pergunta exibida', 500)])
    },
  })
  assert.equal(s.answerSubmit(answerBody()).error.status, 502)
  s.invoke()
  status = 'waiting'
  s.newerCommit({ last_polled_at: '2020-01-01T00:00:00Z' })
  s.invoke()
  const retry = s.answerSubmit(answerBody({ answer_request_id: 'a2' }))
  assert.equal(postCount, 1, 'polling reabriu a mesma pergunta e permitiu segundo POST')
  assert.equal(retry.error.status, 409)
})
for (const secondId of ['a1', 'a2']) {
  check('submit B dentro do HTTP de A, ID ' + secondId + ': claim bloqueia a sobreposição', () => {
    let second
    let postCount = 0
    const s = setup({
      initial: {
        state: 'aguardando_pergunta',
        question: {
          type: 'messageAskUser',
          text: 'Pergunta exibida',
          message_id: 'q1',
          task_id: 'tarefa-ficticia',
        },
      },
      http(config) {
        if (config.url.includes('task.sendMessage')) {
          postCount++
          assert.equal(postCount, 1)
          second = s.answerSubmit(answerBody({ answer_request_id: secondId }))
        }
        return successRemote()
      },
    })
    const first = s.answerSubmit(answerBody())
    assert.equal(first.response.status, 200)
    assert.equal(second.error.status, 409)
    assert.equal(postCount, 1)
  })
}
check('GET iniciado antes do claim não sobrescreve resposta confirmada durante HTTP', () => {
  let submitted = false
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    http(config) {
      if (config.url.includes('task.sendMessage')) return successRemote()
      if (config.url.includes('task.detail')) {
        if (!submitted) {
          submitted = true
          assert.equal(s.answerSubmit(answerBody()).response.status, 200)
        }
        return detail('waiting')
      }
      return page([waiting('q1'), message('q1', 'Pergunta exibida', 500)])
    },
  })
  s.invoke()
  assert.equal(s.row().question.answer_delivery.state, 'confirmada')
  assert.equal(s.row().question.answered, true)
  assert.equal(s.row().state, 'em_execucao')
})
check('GET durante POST encontra q2: finalização atrasada nunca substitui pergunta nova', () => {
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    http(config) {
      if (config.url.includes('task.sendMessage')) {
        s.invoke()
        return successRemote()
      }
      if (config.url.includes('task.detail')) return detail('waiting')
      return page([waiting('q2', 1000), message('q2', 'Pergunta nova', 900)])
    },
  })
  const r = s.answerSubmit(answerBody())
  assert.equal(r.error.status, 409)
  assert.equal(s.row().question.message_id, 'q2')
  assert.equal(s.row().question.answered, undefined)
})

check('vínculo muda entre leitura e claim: 409 antes de qualquer POST', () => {
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    beforeReservation(api) {
      api.newerCommit({
        remote_task_id: 'tarefa-nova',
        question: {
          type: 'messageAskUser',
          text: 'Pergunta exibida',
          message_id: 'q1',
          task_id: 'tarefa-nova',
        },
      })
    },
    http: () => successRemote(),
  })
  const r = s.answerSubmit(answerBody())
  assert.equal(r.error.status, 409)
  assert.equal(s.calls.length, 0, 'não enviar ao taskId da leitura obsoleta')
  assert.equal(s.row().remote_task_id, 'tarefa-nova')
  assert.equal(s.row().question.answer_delivery, undefined)
})
check('vínculo muda durante POST: finalização não sobrescreve metadados novos', () => {
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    http(config, api) {
      api.newerCommit({
        remote_task_id: 'tarefa-nova',
        question: {
          ...api.row().question,
          task_id: 'tarefa-nova',
        },
      })
      return successRemote()
    },
  })
  const r = s.answerSubmit(answerBody())
  assert.equal(r.error.status, 409)
  assert.equal(s.row().question.task_id, 'tarefa-nova')
  assert.equal(s.row().question.answered, undefined)
})
check('HTTP 199 + ok:true não confirma resposta; claim permanece incerta', () => {
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
      },
    },
    http: () => ({ statusCode: 199, json: { ok: true } }),
  })
  const r = s.answerSubmit(answerBody())
  assert.equal(r.error.status, 502)
  assert.equal(s.row().question.answer_delivery.state, 'incerta')
  assert.equal(s.row().question.answered, undefined)
})
for (const variant of ['sem answerID', 'sem texto', 'task divergente']) {
  check('confirmada com ' + variant + ' não recebe duplicate:true permissivo', () => {
    const q = pendingQuestion('confirmada')
    q.answered = true
    q.answer_request_id = 'a1'
    if (variant === 'sem answerID') delete q.answer_delivery.answer_request_id
    if (variant === 'sem texto') delete q.answer_delivery.text
    if (variant === 'task divergente') q.answer_delivery.remote_task_id = 'tarefa-outra'
    const s = setup({
      initial: { state: 'em_execucao', question: q },
      http() {
        throw new Error('não deveria')
      },
    })
    const r = s.answerSubmit(answerBody())
    assert.equal(r.error.status, 409)
    assert.equal(s.calls.length, 0)
  })
}

console.log('Resumo adicional: ' + pass + ' aprovados; ' + fail + ' falhas. Somente simuladores.')
if (fail) process.exitCode = 1
