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
// ============================== M1A2a: answer ==============================
// Período base comum dos casos answer: espera de pergunta comum com ID.
const answerBase = {
  state: 'aguardando_pergunta',
  question: {
    type: 'messageAskUser',
    text: 'Pergunta exibida',
    message_id: 'q1',
    task_id: 'tarefa-ficticia',
  },
}
const submit = (s, extra = {}) =>
  s.answerSubmit({
    text: 'Resposta fictícia',
    answer_request_id: 'a1',
    question_id: 'q1',
    ...extra,
  })
const okRemote = () => ({ statusCode: 200, json: { ok: true, request_id: 'r-remoto' } })

check('M1A2a: sucesso único — claim enviando antes do POST; confirmada + answered após', () => {
  const claimsSeen = []
  const s = setup({
    initial: answerBase,
    http(config) {
      // O POST remoto SÓ acontece depois de o claim 'enviando' estar gravado.
      claimsSeen.push(clone(s.row().question.answer_delivery))
      return config.url.includes('task.sendMessage') ? okRemote() : page([])
    },
  })
  const r = submit(s)
  assert.equal(r.response.status, 200)
  assert.equal(r.response.value.duplicate, false)
  assert.ok(claimsSeen[0], 'sem claim gravado não pode haver POST')
  assert.equal(claimsSeen[0].state, 'enviando')
  const q = s.row().question
  assert.equal(q.answered, true)
  assert.equal(q.answer_delivery.state, 'confirmada')
  assert.equal(s.row().state, 'em_execucao')
  assert.equal(s.row().remote_request_id, 'r-remoto')
  assert.equal(s.calls.length, 1) // só task.sendMessage
})
check('M1A2a: duplicate confirmado (mesmo ID, mesmo texto) devolve 200 sem HTTP', () => {
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
check('M1A2a: mesmo ID com conteúdo diferente → 409; outro ID → 409', () => {
  const confirmed = {
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
  }
  const s = setup({
    initial: confirmed,
    http() {
      throw new Error('HTTP não deveria ocorrer')
    },
  })
  assert.equal(submit(s, { text: 'Outra resposta' }).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  // answered:true SEM answer_delivery (marcador antigo) também bloqueia.
  const legacy = setup({
    initial: {
      state: 'em_execucao',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
        answered: true,
        answer_request_id: 'a0',
      },
    },
    http() {
      throw new Error('HTTP não deveria ocorrer')
    },
  })
  assert.equal(submit(legacy).error.status, 409)
  assert.equal(s.calls.length, 0)
  assert.equal(legacy.calls.length, 0)
})
check('M1A2a: dois submits concorrentes (mesmo ID) — um envia, outro 409', () => {
  let sent = 0
  const s = setup({
    initial: answerBase,
    http(config) {
      if (config.url.includes('task.sendMessage')) {
        sent++
        // Simula o submit B confirmando dentro da transação de A? Não: A está
        // com o claim. B só chega ao HTTP se tomou a reserva — não deve.
      }
      return okRemote()
    },
  })
  // A envia normalmente.
  assert.equal(submit(s).response.status, 200)
  const afterA = s.row()
  // B chega com o MESMO ID: claim confirmado → duplicate; sem segundo POST.
  const before = s.calls.length
  const rb = submit(s)
  assert.equal(rb.response.value.duplicate, true)
  assert.equal(s.calls.length, before)
  // C chega com OUTRO ID: 409 — pergunta já respondida.
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(sent, 1)
  assert.equal(afterA.question.answer_delivery.state, 'confirmada')
})
check('M1A2a: dois submits com IDs diferentes — só o primeiro envia; segundo 409', () => {
  let sent = 0
  const s = setup({
    initial: answerBase,
    http(config) {
      if (config.url.includes('task.sendMessage')) sent++
      return okRemote()
    },
  })
  assert.equal(submit(s).response.status, 200)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(sent, 1)
})
check('M1A2a: timeout → claim incerta; duas tentativas bloqueadas; espera preservada', () => {
  const s = setup({
    initial: answerBase,
    http(config) {
      if (config.url.includes('task.sendMessage')) throw new Error('timeout fictício')
      return page([])
    },
  })
  assert.equal(submit(s).error.status, 502)
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.row().question.answered, undefined)
  assert.equal(s.row().question.answer_delivery.state, 'incerta')
  // Segunda tentativa (mesmo ou outro ID): bloqueada — sem TTL, sem reenvio.
  assert.equal(submit(s).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(s.calls.length, 1) // só o primeiro POST
})
check('M1A2a: claim enviando remanescente de crash bloqueia retry (sem HTTP)', () => {
  const s = setup({
    initial: {
      state: 'aguardando_pergunta',
      question: {
        type: 'messageAskUser',
        text: 'Pergunta exibida',
        message_id: 'q1',
        task_id: 'tarefa-ficticia',
        answer_delivery: {
          state: 'enviando',
          question_id: 'q1',
          answer_request_id: 'a1',
          remote_task_id: 'tarefa-ficticia',
          text: 'Resposta fictícia',
        },
      },
    },
    http() {
      throw new Error('HTTP não deveria ocorrer com claim enviando remanescente')
    },
  })
  assert.equal(submit(s).error.status, 409)
  assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
  assert.equal(s.calls.length, 0)
})
check(
  'M1A2a: remoto OK + save final falha → incerta; compensação falha → enviando persiste',
  () => {
    // Harness de falha de commit com snapshots independentes: save do FINAL sempre
    // lança; rollback real restaura o valor de abertura da transação.
    const s = setup({
      initial: answerBase,
      http(config) {
        if (config.url.includes('task.sendMessage')) return okRemote()
        return page([])
      },
    })
    // Sobrescreve save do app para falhar APENAS na finalização (2ª transação em
    // diante): o claim (1ª transação) grava normalmente.
    let transactions = 0
    const originalRunInTransaction = s.app.runInTransaction
    s.app.runInTransaction = (cb) => {
      transactions++
      if (transactions >= 2) {
        // Finalização: save lança; sem commit — banco volta ao valor de abertura.
        const failing = {
          ...s.app,
          save: () => {
            throw new Error('falha fictícia de persistência')
          },
        }
        return originalRunInTransaction.call(s.app, (txApp) => cb(failing))
      }
      return originalRunInTransaction.call(s.app, cb)
    }
    const r = submit(s)
    // Compensação também grava via txApp.save → também lança → claim 'enviando'
    // permanece (o estado em disco é o do commit do claim).
    assert.ok(r.error, 'esperava erro pós-HTTP')
    assert.equal([502, 500].includes(r.error.status), true)
    // Rollback real: o banco mantém o claim 'enviando' gravado pelo claim commitado.
    const q = s.row().question
    assert.ok(q && q.answer_delivery, 'claim deve persistir após falha de commit')
    assert.equal(q.answer_delivery.state, 'enviando')
    assert.equal(q.answered, undefined)
    assert.equal(s.row().state, 'aguardando_pergunta')
    // Retry: bloqueado pela reserva durável.
    assert.equal(submit(s).error.status, 409)
    assert.equal(submit(s, { answer_request_id: 'a2' }).error.status, 409)
    assert.equal(s.calls.length, 1) // o POST remoto ocorreu UMA vez
  },
)
check('M1A2a: pergunta obsoleta (question_id errado) → 409 sem HTTP; não dono → 403', () => {
  const s = setup({
    initial: answerBase,
    http() {
      throw new Error('não deveria')
    },
  })
  assert.equal(submit(s, { question_id: 'q-antiga' }).error.status, 409)
  assert.equal(s.calls.length, 0)
  // Não dono: outro usuário tentando responder pedido alheio → 403.
  const other = setup({
    initial: answerBase,
    http() {
      throw new Error('não deveria')
    },
    authAs: 'outro-usuario',
  })
  assert.equal(submit(other).error.status, 403)
})
check('M1A2a: GET preserva claim da mesma pergunta e não reabre pergunta confirmada', () => {
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
    http(config) {
      // Manus AINDA reporta waiting para a MESMA pergunta (espera antiga).
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([waiting('q1'), message('q1', 'Pergunta exibida', 500)])
    },
  })
  s.invoke()
  // Espera antiga NÃO reabre a pergunta confirmada.
  assert.equal(s.row().state, 'em_execucao')
  assert.equal(s.row().question.answered, true)
  assert.equal(s.row().question.answer_delivery.state, 'confirmada')
})
check('M1A2a: GET antes do claim mantém claim gravado por submit posterior', () => {
  const s = setup({
    initial: answerBase,
    http(config) {
      if (config.url.includes('task.sendMessage')) return okRemote()
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([waiting('q1'), message('q1', 'Pergunta exibida', 500)])
    },
  })
  s.invoke() // GET regravando a mesma pergunta (sem claim ainda)
  assert.equal(s.row().question.message_id, 'q1')
  const r = submit(s)
  assert.equal(r.response.status, 200)
  assert.equal(s.row().question.answer_delivery.state, 'confirmada')
  // GET depois do claim: preserva answer_delivery e answered da mesma message_id.
  s.invoke()
  assert.equal(s.row().question.answer_delivery.state, 'confirmada')
  assert.equal(s.row().question.answered, true)
  assert.equal(s.row().state, 'em_execucao')
})
check('M1A2a: pergunta NOVA com ID comprovado avança; answer atrasado vira 409', () => {
  const s = setup({
    initial: answerBase,
    http(config) {
      if (config.url.includes('task.sendMessage')) return okRemote()
      return config.url.includes('task.detail')
        ? detail('waiting')
        : page([waiting('q2'), message('q2', 'Pergunta nova de verdade', 900)])
    },
  })
  submit(s) // responde q1
  assert.equal(s.row().question.answered, true)
  // Chega pergunta nova (id q2): estado volta a aguardando_pergunta.
  s.invoke()
  assert.equal(s.row().state, 'aguardando_pergunta')
  assert.equal(s.row().question.message_id, 'q2')
  assert.equal(s.row().question.answered, undefined)
  // Answer atrasado para q1 NUNCA sobrescreve a pergunta nova.
  const r = s.answerSubmit({
    text: 'Resposta atrasada',
    answer_request_id: 'a-atrasada',
    question_id: 'q1',
  })
  assert.equal(r.error.status, 409)
  assert.equal(s.row().question.message_id, 'q2')
  assert.equal(s.row().question.answered, undefined)
})

console.log(
  'Resumo dirigido: ' + pass + ' aprovados; ' + fail + ' falhas. Sem JSVM/rede/banco reais.',
)
if (fail) process.exitCode = 1
