// Testes locais de EXPECTATIVAS CORRETAS do acompanhamento v0.0.17.
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
function setup({ initial = {}, http, beforeReservation }) {
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
check(
  'pergunta diretamente identificada usa o ID da mensagem e aceita continuação de pronta',
  () => {
    const s = setup({
      initial: { state: 'pronta', result: VALID },
      http(config) {
        return config.url.includes('task.detail')
          ? detail('waiting')
          : page([waiting(), message('pergunta-atual', 'Pergunta nova', 500)])
      },
    })
    s.invoke()
    assert.equal(s.row().state, 'aguardando_pergunta')
    assert.equal(s.row().question.message_id, 'pergunta-atual')
    assert.equal(s.row().result, null)
  },
)
check('mensagem de progresso intercalada não impede encontrar a pergunta correta', () => {
  const s = setup({
    http(config) {
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([
            waiting(),
            message('progresso', 'Texto de progresso', 550),
            message('pergunta-atual', 'Pergunta correta', 500),
          ])
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.row().question.text, 'Pergunta correta')
  assert.equal(s.row().question.message_id, 'pergunta-atual')
})
check('a pergunta correspondente pode estar na página seguinte após progresso', () => {
  const s = setup({
    http(config) {
      if (config.url.includes('task.detail')) return detail('waiting')
      if (config.url.includes('cursor='))
        return page([message('pergunta-atual', 'Pergunta correta', 500)])
      return page([waiting(), message('progresso', 'Progresso', 550)], true, 'pagina-2')
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.row().question.text, 'Pergunta correta')
})
check('associação ausente permanece inconclusiva, sem texto arbitrário', () => {
  const s = setup({
    http(config) {
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([waiting(), message('progresso', 'Progresso', 550)])
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'em_execucao')
  assert.ok(!s.row().question)
})
check('resultado pronta é invalidado pela mensagem de continuação nova', () => {
  const s = setup({
    initial: { state: 'pronta', result: VALID },
    http(config) {
      return config.url.includes('task.detail')
        ? detail('stopped')
        : page([event('usuario-500', 'user_message', { content: 'Continuar' }, 500), resultEvent()])
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'em_execucao')
  assert.equal(s.row().result, null)
})
for (const [name, payload] of [
  ['null', null],
  ['string', 'inválido'],
  ['array', []],
  ['success ausente', {}],
]) {
  check('envelope estruturado recebido ' + name + ' é falha explícita', () => {
    const s = setup({
      http(config) {
        return config.url.includes('task.detail')
          ? detail('stopped')
          : page([event('malformado', 'structured_output_result', payload, 300)])
      },
    })
    s.invoke()
    assert.equal(s.row().state, 'falha')
    assert.match(s.row().error, /malformado/)
  })
}
for (const state of ['pronta', 'falha', 'aguardando_pergunta']) {
  check(
    'consulta antiga não sobrescreve gravação nova em estado ' +
      state +
      ' (snapshots independentes)',
    () => {
      const newer = {
        state,
        result: state === 'pronta' ? VALID : null,
        question:
          state === 'aguardando_pergunta'
            ? { type: 'messageAskUser', text: 'Nova', message_id: 'nova' }
            : null,
        error: state === 'falha' ? 'Falha nova confirmada' : '',
      }
      const s = setup({
        http(config, api) {
          if (config.url.includes('task.detail')) {
            // A leu snapshot antigo e reservou timestamp. B confirmou estado novo
            // enquanto A aguardava HTTP. A deve detectar snapshot obsoleto ao gravar.
            api.newerCommit(newer)
            return detail('stopped')
          }
          return page([message('progresso-antigo', 'Resultado ainda ausente', 100)])
        },
      })
      s.invoke()
      assert.equal(s.row().state, state)
      assert.deepEqual(s.row().result, newer.result)
      assert.deepEqual(s.row().question, newer.question)
    },
  )
}
check('falha transitória de uma consulta antiga também preserva o estado mais novo', () => {
  const s = setup({
    http(config, api) {
      api.newerCommit({ state: 'pronta', result: VALID })
      throw new Error('timeout fictício')
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'pronta')
  assert.deepEqual(s.row().result, VALID)
})
check('timeout sem concorrência persiste a nota após a revisão criada pela própria reserva', () => {
  const s = setup({
    http() {
      throw new Error('timeout fictício')
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'em_execucao')
  assert.match(s.row().error, /Timeout/)
})
check(
  'reserva relê a janela fresca atomicamente e evita HTTP de uma leitura prévia concorrente',
  () => {
    const s = setup({
      beforeReservation(api) {
        // B reservou depois da leitura inicial de A, antes de A entrar na transação.
        api.newerCommit({
          last_polled_at: new Date().toISOString(),
          state: 'pronta',
          result: VALID,
        })
      },
      http() {
        throw new Error('HTTP não deveria ocorrer')
      },
    })
    const r = s.invoke()
    assert.equal(s.calls.length, 0)
    assert.equal(s.row().state, 'pronta')
    assert.equal(r.value.request.state, 'pronta')
  },
)
check('varredura não reaproveita pergunta anterior à fronteira user_message', () => {
  const s = setup({
    http(config) {
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([
            waiting(),
            message('progresso', 'Progresso', 550),
            event('inicio-execucao', 'user_message', { content: 'Nova solicitação' }, 450),
            message('pergunta-velha', 'Pergunta da execução anterior', 300, { options: ['x'] }),
          ])
    },
  })
  s.invoke()
  assert.equal(s.row().state, 'em_execucao')
  assert.ok(!s.row().question)
})
check(
  'saída terminal inconclusiva devolve atualização concorrente, sem salvar pronta velha',
  () => {
    const s = setup({
      initial: { state: 'pronta', result: VALID },
      http(config, api) {
        if (config.url.includes('task.detail')) {
          api.newerCommit({
            state: 'aguardando_pergunta',
            result: null,
            question: { type: 'messageAskUser', text: 'Pergunta nova', message_id: 'nova' },
          })
          return detail('stopped')
        }
        return page([])
      },
    })
    const r = s.invoke()
    assert.equal(s.row().state, 'aguardando_pergunta')
    assert.equal(r.value.request.state, 'aguardando_pergunta')
    assert.equal(s.row().result, null)
  },
)
console.log(
  'Resumo dirigido: ' + pass + ' aprovados; ' + fail + ' falhas. Sem JSVM/rede/banco reais.',
)
if (fail) process.exitCode = 1
