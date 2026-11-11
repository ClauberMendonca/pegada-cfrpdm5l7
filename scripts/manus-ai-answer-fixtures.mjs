// Fixtures M1A2a autocontidos: executa os callbacks REAIS do hook
// manus-ai.pb.js em Node VM, com banco simulado que faz ROLLBACK REAL
// (commit só se o callback TERMINAR normalmente; erro restaura snapshot
// independente). Nenhum JSVM/rede/banco real — plataforma não roda Node:
// esta suíte roda na máquina do dono com:  node scripts/manus-ai-answer-fixtures.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../pocketbase/hooks/manus-ai.pb.js', import.meta.url), 'utf8')
const clone = (value) => JSON.parse(JSON.stringify(value))
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

function setup({
  initial = {},
  http,
  authAs = 'usuario-ficticio',
  failSaveFromTransaction = Infinity,
} = {}) {
  let db = {
    id: 'pedido-ficticio',
    user_id: 'usuario-ficticio',
    state: 'aguardando_pergunta',
    context: 'vida',
    remote_task_id: 'tarefa-ficticia',
    question: {
      type: 'messageAskUser',
      text: 'Pergunta exibida',
      message_id: 'q1',
      task_id: 'tarefa-ficticia',
    },
    ...clone(initial),
  }
  let revision = 0
  let transactionCount = 0
  const calls = []
  const claimsSeen = []
  const routes = new Map()
  const app = {
    findRecordById(collection) {
      assert.equal(collection, 'ai_requests')
      return new Rec(db) // snapshot independente a cada leitura
    },
    save(rec) {
      db = { ...clone(rec.f), updated: 'revisao-' + ++revision }
      rec.set('updated', db.updated)
    },
    runInTransaction(cb) {
      transactionCount++
      const before = clone(db)
      let committed = false
      const txApp = {
        findRecordById: app.findRecordById,
        save(rec) {
          if (transactionCount >= failSaveFromTransaction) {
            throw new Error('falha fictícia de persistência')
          }
          app.save(rec)
        },
      }
      try {
        assert.equal(cb(txApp), undefined, 'callback de transação deve ser void')
      } catch (error) {
        db = before // rollback real: snapshot independente
        throw error
      }
      committed = true // commit só se o callback TERMINOU normalmente
      return committed
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
        // Toda chamada remota exige o claim 'enviando' JÁ gravado (durável).
        const delivery = db.question && db.question.answer_delivery
        claimsSeen.push(delivery ? clone(delivery) : null)
        return http ? http(config) : { statusCode: 200, json: { ok: true } }
      },
    },
  }
  vm.runInContext(source, vm.createContext(globals), { timeout: 1000 })
  const invokeAnswer = (body) => {
    const e = {
      auth: { id: authAs },
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
  }
  return { app, db, row: () => clone(db), calls, claimsSeen, invokeAnswer }
}

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass++
    console.log('OK: ' + name)
  } catch (error) {
    fail++
    console.log('FALHOU: ' + name + ' — ' + error.message)
  }
}
const okRemote = () => ({ statusCode: 200, json: { ok: true, request_id: 'r-remoto' } })
const submit = (s, extra = {}) =>
  s.invokeAnswer({
    text: 'Resposta fictícia',
    answer_request_id: 'a1',
    question_id: 'q1',
    ...extra,
  })

check('A1: sucesso único — claim enviando antes do POST; confirmada após', () => {
  const s = setup({ http: () => okRemote() })
  const r = submit(s)
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.duplicate, false)
  // O POST remoto só ocorre DEPOIS de o claim 'enviando' estar gravado.
  assert.equal(s.claimsSeen[0].state, 'enviando')
  assert.equal(s.claimsSeen[0].question_id, 'q1')
  assert.equal(s.claimsSeen[0].answer_request_id, 'a1')
  assert.equal(s.claimsSeen[0].remote_task_id, 'tarefa-ficticia')
  assert.equal(s.claimsSeen[0].text, 'Resposta fictícia')
  const q = s.row().question
  assert.equal(q.answered, true)
  assert.equal(q.answer_delivery.state, 'confirmada')
  assert.equal(s.row().state, 'em_execucao')
  assert.equal(s.row().remote_request_id, 'r-remoto')
  assert.equal(s.calls.length, 1)
})
check('A2: duplicate confirmado — mesmo ID/texto → 200 duplicate:true sem HTTP', () => {
  const s = setup({
    initial: {
      state: 'em_execucao',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
        answered: true,
        answer_request_id: 'a1',
        answer_delivery: {
          state: 'confirmada',
          question_id: 'q1',
          answer_request_id: 'a1',
          remote_task_id: 'tarefa-ficticia',
          text: 'Resposta fictícia',
        },
      },
    },
    http() {
      throw new Error('HTTP não deveria ocorrer em duplicate')
    },
  })
  const r = submit(s)
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.duplicate, true)
  assert.equal(s.calls.length, 0)
})
check('A3: confirmado + mesmo ID + conteúdo diferente → 409; outro ID → 409', () => {
  const s = setup({
    initial: {
      state: 'em_execucao',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
        answered: true,
        answer_request_id: 'a1',
        answer_delivery: {
          state: 'confirmada',
          question_id: 'q1',
          answer_request_id: 'a1',
          remote_task_id: 'tarefa-ficticia',
          text: 'Resposta fictícia',
        },
      },
    },
    http() {
      throw new Error('HTTP não deveria ocorrer')
    },
  })
  assert.equal(submit(s, { text: 'Conteúdo diferente' }).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('A4: claim enviando/incerta bloqueia segundo POST, ID igual OU diferente', () => {
  for (const state of ['enviando', 'incerta']) {
    const s = setup({
      initial: {
        question: {
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
        },
      },
      http() {
        throw new Error('HTTP não deveria ocorrer com claim ' + state)
      },
    })
    assert.equal(submit(s).error.status, 409)
    assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
    assert.equal(submit(s, { text: 'Outro texto' }).error.status, 409)
    assert.equal(s.calls.length, 0)
  }
})
check('A5: crash — claim enviando remanescente bloqueia retry sem HTTP', () => {
  const s = setup({
    initial: {
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
        answer_delivery: {
          state: 'enviando',
          question_id: 'q1',
          answer_request_id: 'a-crash',
          remote_task_id: 'tarefa-ficticia',
          text: 'Resposta do crash',
        },
      },
    },
    http() {
      throw new Error('HTTP não deveria ocorrer')
    },
  })
  assert.equal(submit(s).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2', text: 'Outra' }).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('A6: remoto OK + save final falha → incerta; 502; retry bloqueado', () => {
  // save do FINAL (2ª transação em diante) falha; claim (1ª) grava normalmente.
  const s = setup({ http: () => okRemote(), failSaveFromTransaction: 2 })
  const r = submit(s)
  // Compensação 'incerta' grava via txApp.save — também falha com failSave 2+,
  // então o claim 'enviando' persiste (crash-safe). Nada fingido.
  assert.ok(r.error, 'esperava erro pós-HTTP')
  assert.ok([500, 502].includes(r.error.status), 'erro pós-HTTP com confirmação pendente')
  const d = s.row().question.answer_delivery
  assert.ok(d, 'claim deve persistir após falha de commit')
  assert.ok(['enviando', 'incerta'].includes(d.state), 'estado pendente preservado')
  assert.equal(s.row().question.answered, undefined)
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.calls.length, 1) // POST remoto ocorreu UMA vez
  assert.equal(s.claimsSeen[0].state, 'enviando') // POST após claim durável
  assert.equal(submit(s).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
})
check('A7: pergunta obsoleta (question_id errado) → 409 sem HTTP', () => {
  const s = setup({
    http() {
      throw new Error('não deveria')
    },
  })
  assert.equal(submit(s, { question_id: 'q-antiga' }).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('A8: não dono → 403 sem HTTP', () => {
  const s = setup({
    authAs: 'outro-usuario',
    http() {
      throw new Error('não deveria')
    },
  })
  assert.equal(submit(s).error.status, 403)
  assert.equal(s.calls.length, 0)
})
check('A9: timeout → incerta; erro sanitizado; espera preservada; retry bloqueado', () => {
  const s = setup({
    http() {
      throw new Error('timeout fictício')
    },
  })
  const r = submit(s)
  assert.equal(r.error.status, 502)
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.row().question.answered, undefined)
  const d = s.row().question.answer_delivery
  assert.equal(d.state, 'incerta')
  assert.equal(d.question_id, 'q1')
  assert.equal(d.remote_task_id, 'tarefa-ficticia')
  assert.ok(s.row().error.length > 0)
  assert.equal(submit(s).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(s.calls.length, 1)
})
check('A10: campos ausentes — text/answer_request_id/question_id → 400 sem HTTP', () => {
  const s = setup({
    http() {
      throw new Error('não deveria')
    },
  })
  assert.equal(submit(s, { text: '' }).error.status, 400)
  assert.equal(submit(s, { answer_request_id: '' }).error.status, 400)
  assert.equal(submit(s, { question_id: '' }).error.status, 400)
  assert.equal(s.calls.length, 0)
})
check('A11: estado geral usa somente valores existentes; sem pergunta → 409', () => {
  const s = setup({
    initial: { state: 'pronta', question: null },
    http() {
      throw new Error('não deveria')
    },
  })
  assert.equal(submit(s).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check('A12: transação void e rollback real — erro no callback não altera o banco', () => {
  const s = setup({ http: () => okRemote() })
  // Simula erro de validação dentro da transação do claim: question_id errado
  // na 2ª leitura? Mais direto: forçar falha de save do CLAIM (transação 1).
  const s2 = setup({ http: () => okRemote(), failSaveFromTransaction: 1 })
  const r = submit(s2)
  // Se o claim não grava, NADA é enviado (persistir é a autorização).
  assert.equal(r.error.status, 500)
  assert.equal(s2.calls.length, 0)
  assert.ok(!s2.row().question.answer_delivery, 'nenhum claim residual')
  assert.equal(s2.row().question.answered, undefined)
  void s
})

console.log('')
console.log('Resumo M1A2a: ' + pass + ' aprovados; ' + fail + ' falhas. Sem JSVM/rede/banco reais.')
if (fail) process.exitCode = 1
