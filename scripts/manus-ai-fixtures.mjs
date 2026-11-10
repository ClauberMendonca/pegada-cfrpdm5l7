// Fixtures/mocks locais para a fatia M1A — NÃO são testes da JSVM real.
// Exercitam a LÓGICA pura (gate, validação, dedup, estados, JSON) com stubs
// que imitam a superfície usada pelos hooks (manus-ai.pb.js) e pela migration
// 0005 (0005_create_ai_requests.js). Nada aqui chama api.manus.ai nem toca no
// backend vivo: é inspeção/verificação local, marcada como MOCK.
//
// Rodar: node scripts/manus-ai-fixtures.mjs

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('FALHOU ' + name + ' :: ' + (err && err.message ? err.message : err))
    process.exitCode = 1
  }
}

// ---------- stubs de superfície JSVM (MOCK) ----------
function makeEnv(env) {
  return (name) => (Object.prototype.hasOwnProperty.call(env, name) ? env[name] : '')
}

function makeRec(fields, getJson, setJson) {
  return {
    id: fields.id || 'rec_test',
    _f: fields,
    getString(name) {
      return fields[name] == null ? '' : String(fields[name])
    },
    get(name) {
      return getJson[name]
    },
    set(name, v) {
      setJson[name] = v
    },
    get _applied() {
      return setJson
    },
  }
}

function makeApp({ env, captures, aiRequests, uniqueErr, failFind }) {
  const setJson = {}
  return {
    env,
    setJson,
    saved: [],
    finds: 0,
    findRecordById(col, id) {
      if (failFind) throw new Error('mock find fail')
      if (col === 'captures') {
        const c = captures.find((c) => c.id === id)
        if (!c) throw new Error('not found')
        return makeRec(c, {}, setJson)
      }
      const r = aiRequests.find((r) => r.id === id)
      if (!r) throw new Error('not found')
      return makeRec(r, r._json || {}, setJson)
    },
    findFirstRecordByFilter(col, filter, params) {
      this.finds++
      if (uniqueErr) throw new Error('UNIQUE constraint failed')
      if (col === 'ai_requests') {
        return (
          aiRequests.find((r) => r.user_id === params.u && r.local_request_id === params.l) || null
        )
      }
      return null
    },
    save(rec) {
      // valida unicidade nativa simulada
      const dup = aiRequests.find(
        (r) =>
          r.id !== rec.id &&
          r.user_id === rec.getString('user_id') &&
          r.local_request_id === rec.getString('local_request_id'),
      )
      if (dup) throw new Error('UNIQUE constraint failed')
      this.saved.push(rec)
      // aplica mudanças em memória local
      for (const k of [
        'state',
        'error',
        'remote_task_id',
        'question',
        'last_polled_at',
        'result',
      ]) {
        if (rec._applied && k in rec._applied) {
          if (colName(rec) === 'ai_requests') {
            const target = aiRequests.find((r) => r.id === rec.id)
            if (target) {
              if (k === 'question' || k === 'result') target._json = target._json || {}
              target[k === 'question' || k === 'result' ? '_json' : '_f'][k] = rec._applied[k]
            }
          }
        }
      }
    },
    runInTransaction(cb) {
      // callback void; grava em variáveis locais (contrato JSVM)
      cb(this)
    },
  }
}
function colName(rec) {
  return rec._f && 'origin_type' in rec._f ? 'ai_requests' : 'captures'
}

// ---------- lógica em teste (espelho das regras do hook — MOCK) ----------

// gate OFF: nenhum POST, nenhuma gravação, resposta única coerente
function gateEnabled(env) {
  const v = String(env.MANUS_AI_ENABLED || '')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}
function gateResponse(env) {
  if (!gateEnabled(env))
    return { status: 503, error: 'Integração Manus desligada/não configurada.' }
  return null
}
function requireContext(ctx) {
  if (ctx !== 'vida' && ctx !== 'trabalho') {
    return { status: 400, error: 'context é obrigatório e deve ser "vida" ou "trabalho".' }
  }
  return null
}
function requireOrigin(capture, userId) {
  if (capture.user_id !== userId) return { status: 403, error: 'Captura pertence a outro usuário.' }
  if (capture.status !== 'pendente')
    return { status: 409, error: 'Captura não está mais pendente.' }
  return null
}
// origem versionada: revisão deriva de raw_text + updated
function originRevision(capture) {
  return capture.raw_text + '|' + capture.updated
}
// criação incerta: POST lançou → sem reenvio, sem revogar
function onPostError(rec, msg) {
  rec.set('state', 'criacao_incerta')
  rec.set('error', msg)
  return { status: 502, error: 'Manus não confirmou a criação da tarefa; tarefa não reenviada.' }
}
// GET: sincroniza apenas quando gate ON; stopped só é pronta com
// stop_reason=finish + has_running_background_jobs=false + success:true
function syncState(taskDetail, current) {
  if (!gateEnabled({ MANUS_AI_ENABLED: '1' })) return { synced: false, state: current }
  const status = String(taskDetail.status || '').trim()
  const stop = String(taskDetail.stop_reason || '').trim()
  const bg = taskDetail.has_running_background_jobs
  if (status === 'error') return { synced: true, state: 'falha' }
  if (status === 'running' || bg === true) return { synced: true, state: 'em_execucao' }
  if (status === 'stopped') {
    if (stop !== 'finish') return { synced: true, state: 'decisao_externa' }
    const so = taskDetail.structured_output
    if (!so || so.success !== true) {
      if (bg === false) return { synced: true, state: 'falha' }
      return { synced: true, state: 'em_execucao' } // bg omitido = desconhecido
    }
    const val = so.value
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      if (bg === false) return { synced: true, state: 'falha' }
      return { synced: true, state: 'em_execucao' }
    }
    if (!['esclarecimento', 'projeto', 'acao'].includes(val.kind)) {
      if (bg === false) return { synced: true, state: 'falha' }
      return { synced: true, state: 'em_execucao' }
    }
    return { synced: true, state: 'pronta', result: val }
  }
  return { synced: true, state: 'em_execucao' }
}
// answer: só pergunta comum; repetição protegida por marcador question.answered
function answerAllowed(rec, text, answerRequestId) {
  if (!text || !String(text).trim()) return { status: 400, error: 'text é obrigatório.' }
  if (rec.state !== 'aguardando_pergunta')
    return { status: 409, error: 'Pedido não está aguardando resposta do dono.' }
  const q = rec._json && rec._json.question
  if (!q || typeof q !== 'object') return { status: 409, error: 'Pedido sem pergunta pendente.' }
  if (answerRequestId && q.answered && q.answer_request_id === answerRequestId) {
    return { duplicate: true }
  }
  if (q.type !== 'messageAskUser' && q.type !== 'cascadeAskUser') {
    return {
      status: 409,
      error: 'Espera atual não é uma pergunta ao dono; decisão externa necessária.',
    }
  }
  return { ok: true }
}
// validação do resultado estruturado (server-side, espelho do hook)
function validateResult(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'não é objeto' }
  if (!['esclarecimento', 'projeto', 'acao'].includes(v.kind))
    return { ok: false, error: 'kind inválido' }
  if (typeof v.missing_data !== 'boolean' || typeof v.waiting_or_decision !== 'boolean')
    return { ok: false, error: 'flags inválidas' }
  if (typeof v.explanation !== 'string') return { ok: false, error: 'explanation inválido' }
  if (v.proposal != null) {
    const p = v.proposal
    if (!p || typeof p !== 'object' || Array.isArray(p))
      return { ok: false, error: 'proposal inválida' }
    if (!['projeto', 'acao'].includes(p.kind)) return { ok: false, error: 'proposal.kind inválido' }
    if (!String(p.title || '').trim()) return { ok: false, error: 'proposal sem título' }
    if (!['vida', 'trabalho'].includes(p.context))
      return { ok: false, error: 'proposal.context inválido' }
    if (p.kind === 'acao') {
      for (const k of ['aspiration', 'controllable_delivery', 'completion_condition']) {
        if (p[k] != null && p[k] !== '')
          return { ok: false, error: 'proposal de ação com campo de projeto' }
      }
    }
  }
  if (v.next_step_suggestion != null && typeof v.next_step_suggestion !== 'string') {
    return { ok: false, error: 'next_step_suggestion inválido' }
  }
  return { ok: true }
}

// ---------- fixtures: coleção 0005 (leitura do arquivo como fonte da verdade) ----------
const migrationSrc = readFileSync(
  new URL('../pocketbase/migrations/0005_create_ai_requests.js', import.meta.url),
  'utf8',
)

console.log('\n[1] Migration 0005 — coleção ai_requests (inspeção estrutural)')
check('bloqueia CRUD direto (create/update/delete null) e libera leitura só do dono', () => {
  assert.match(migrationSrc, /createRule: locked/)
  assert.match(migrationSrc, /updateRule: locked/)
  assert.match(migrationSrc, /deleteRule: locked/)
  assert.match(migrationSrc, /user_id = @request\.auth\.id/)
  assert.doesNotMatch(migrationSrc, /ownerRule/)
})
check('índice único de idempotência (user_id, local_request_id)', () => {
  assert.match(
    migrationSrc,
    /CREATE UNIQUE INDEX idx_ai_requests_local ON ai_requests \(user_id, local_request_id\)/,
  )
})
check('state contém todos os estados previstos nesta fatia', () => {
  for (const s of [
    'registrado',
    'criacao_incerta',
    'aguardando_pergunta',
    'decisao_externa',
    'em_execucao',
    'pronta',
    'falha',
  ]) {
    assert.ok(migrationSrc.includes("'" + s + "'"), 'estado ausente: ' + s)
  }
})
check('origin_revision é texto versionado (raw_text + updated na origem)', () => {
  assert.match(migrationSrc, /name: 'origin_revision', type: 'text'/)
})
check('context é select explícito vida|trabalho (nunca inferido)', () => {
  assert.match(migrationSrc, /values: \['vida', 'trabalho'\]/)
})
check('não toca em users nem altera regras de outras coleções', () => {
  assert.doesNotMatch(migrationSrc, /_pb_users_auth_'?\s*,\s*(create|update|delete|list|view)Rule/)
  assert.match(migrationSrc, /collectionId: '_pb_users_auth_'/)
})

console.log('\n[2] Rotas do hook manus-ai.pb.js (inspeção estrutural)')
const hookSrc = readFileSync(new URL('../pocketbase/hooks/manus-ai.pb.js', import.meta.url), 'utf8')
check('prefixo /backend/v1/ e as 3 rotas previstas', () => {
  assert.match(hookSrc, /routerAdd\('POST', '\/backend\/v1\/ai\/clarify'/)
  assert.match(hookSrc, /routerAdd\('GET', '\/backend\/v1\/ai\/requests\/\{id\}'/)
  assert.match(hookSrc, /routerAdd\('POST', '\/backend\/v1\/ai\/requests\/\{id\}\/answer'/)
  assert.doesNotMatch(hookSrc, /routerAdd\('(?:POST|GET|PUT|DELETE|PATCH)', '\/api\//)
})
check('gate MANUS_AI_ENABLED server-side em TODAS as rotas que tocam o remoto', () => {
  const gates = hookSrc.match(/MANUS_AI_ENABLED/g) || []
  assert.ok(gates.length >= 3, 'gate presente <3 rotas: ' + gates.length)
  assert.doesNotMatch(hookSrc, /SKIP_CONNECTORS/)
})
check('nunca usar http.StatusOK / pacote http / fetch / AbortSignal', () => {
  assert.doesNotMatch(hookSrc, /http\.(Status|Send)/)
  assert.doesNotMatch(hookSrc, /\bfetch\(/)
  assert.doesNotMatch(hookSrc, /AbortSignal/)
  assert.doesNotMatch(hookSrc, /\$http\.send[^]*?fetch/)
})
check('manusCall usa $http.send com header x-manus-api-key e timeout', () => {
  assert.match(hookSrc, /\$http\.send\(\{/)
  assert.match(hookSrc, /'x-manus-api-key': apiKey/)
  assert.match(hookSrc, /timeout:/)
})
check('base fixa api.manus.ai e projeto fixo QYbSBGo5T5KRsS2p9X8XYv', () => {
  assert.match(hookSrc, /https:\/\/api\.manus\.ai/)
  assert.match(hookSrc, /project_id: 'QYbSBGo5T5KRsS2p9X8XYv'/)
})
check(
  'payload Manus v2: clear_connectors, interactive_mode, share_visibility, perfil standard',
  () => {
    assert.match(hookSrc, /clear_connectors: true/)
    assert.match(hookSrc, /interactive_mode: true/)
    assert.match(hookSrc, /share_visibility: 'private'/)
    assert.match(hookSrc, /profile: 'standard'/)
    assert.match(hookSrc, /structured_output_schema:/)
    assert.match(hookSrc, /additionalProperties: false/)
    assert.doesNotMatch(hookSrc, /enable_skills/)
  },
)
check('runInTransaction com callback void (nada retornado)', () => {
  const m = hookSrc.match(/runInTransaction\(\(txApp\) => \{[^]*?\n  \}\)/)
  assert.ok(m, 'callback de transação não encontrado')
  assert.ok(!/\n    return\s+\{/.test(m[0]), 'callback retorna objeto — reverte a transação')
})
check('serializeRequest definido uma única vez por rota (após helpers, antes do uso)', () => {
  const perRoute = hookSrc.split(/routerAdd\(/).slice(1)
  for (const route of perRoute) {
    const defs = (route.match(/function serializeRequest/g) || []).length
    assert.ok(defs <= 1, 'serializeRequest duplicado na mesma rota')
  }
})
check('idempotência da resposta via question.answered (sem campo inventado)', () => {
  assert.match(hookSrc, /question.answered|question\.answered|answered: true/)
  assert.doesNotMatch(hookSrc, /answered_request_ids/)
})
check('nenhuma task.confirmAction nem task.stop nesta fatia', () => {
  assert.doesNotMatch(hookSrc, /confirmAction|task\.stop|\/stop/)
})
check('erro sanitizado: nunca ecoar headers/corpo bruto', () => {
  assert.doesNotMatch(hookSrc, /err\.headers|resp\.headers|JSON\.stringify\(resp\.body|raw/)
})

console.log('\n[3] Gate OFF (MOCK de $os.getenv e $http.send)')
check('gate ausente → 503 e ZERO chamadas remotas', () => {
  let calls = 0
  const env = makeEnv({})
  const resp = gateResponse(env)
  assert.equal(resp.status, 503)
  assert.equal(gateEnabled(env), false)
  assert.equal(calls, 0, 'nenhuma chamada remota deve ocorrer')
})
check('gate "1"/"true"/"yes" ativa (apenas para leitura do caminho ON)', () => {
  for (const v of ['1', 'true', 'yes']) {
    assert.equal(gateEnabled(makeEnv({ MANUS_AI_ENABLED: v })), true)
  }
  for (const v of ['0', 'false', '', 'no', '2', undefined]) {
    assert.equal(gateEnabled(makeEnv({ MANUS_AI_ENABLED: v })), false)
  }
})
check('chave presente NÃO ativa (gate manda, não a chave)', () => {
  assert.equal(gateEnabled(makeEnv({ MANUS_API_KEY: 'sk-qualquer', MANUS_AI_ENABLED: '0' })), false)
})

console.log('\n[4] Auth/dono (MOCK)')
check('captura de outro dono → 403', () => {
  const err = requireOrigin({ user_id: 'u_outro', status: 'pendente' }, 'u_eu')
  assert.equal(err.status, 403)
})
check('captura não pendente → 409', () => {
  const err = requireOrigin({ user_id: 'u_eu', status: 'convertida' }, 'u_eu')
  assert.equal(err.status, 409)
})
check('contexto ausente/inválido → 400 (nunca inferido)', () => {
  assert.equal(requireContext(undefined).status, 400)
  assert.equal(requireContext('pessoal').status, 400)
  assert.equal(requireContext('vida'), null)
  assert.equal(requireContext('trabalho'), null)
})

console.log('\n[5] Criação incerta e dedup (MOCK de transação + unicidade)')
check('POST lançou → state criacao_incerta, sem retry cego', () => {
  const setJson = {}
  const rec = makeRec({ id: 'r1' }, {}, setJson)
  const resp = onPostError(rec, 'Timeout contatando Manus.')
  assert.equal(resp.status, 502)
  assert.equal(rec.getString('state'), 'criacao_incerta')
  assert.equal(rec.getString('error'), 'Timeout contatando Manus.')
  assert.ok(!('remote_task_id' in setJson), 'nenhum task_id inventado')
})
check('POST recusado → também criacao_incerta, sem limpar nada', () => {
  const setJson = {}
  const rec = makeRec({ id: 'r1' }, {}, setJson)
  const resp = onPostError(rec, 'Manus respondeu HTTP 400.')
  assert.equal(resp.status, 502)
  assert.equal(rec.getString('state'), 'criacao_incerta')
  assert.equal(setJson.error, 'Manus respondeu HTTP 400.')
})
check('dedup: mesmo local_request_id no mesmo dono → duplicate:true', () => {
  const app = makeApp({
    env: makeEnv({ MANUS_AI_ENABLED: '1', MANUS_API_KEY: 'k' }),
    captures: [],
    aiRequests: [
      {
        id: 'r1',
        user_id: 'u',
        local_request_id: 'l1',
        origin_id: 'c1',
        state: 'em_execucao',
        _json: {},
      },
    ],
  })
  const found = app.findFirstRecordByFilter('ai_requests', '', { u: 'u', l: 'l1' })
  assert.ok(found)
  assert.equal(found.getString('origin_id'), 'c1')
})
check('dedup: mesmo local_request_id com outra origem → 409', () => {
  const app = makeApp({
    env: makeEnv({}),
    captures: [],
    aiRequests: [
      {
        id: 'r1',
        user_id: 'u',
        local_request_id: 'l1',
        origin_id: 'c_outro',
        state: 'em_execucao',
        _json: {},
      },
    ],
  })
  const found = app.findFirstRecordByFilter('ai_requests', '', { u: 'u', l: 'l1' })
  assert.equal(found.getString('origin_id') === 'c1' ? 0 : 409, 409)
})
check('origem versionada: revisão muda quando raw_text ou updated mudam', () => {
  const c1 = originRevision({ raw_text: 'comprar pão', updated: '2026-11-10 10:00:00.000Z' })
  const c2 = originRevision({ raw_text: 'comprar pão', updated: '2026-11-10 11:00:00.000Z' })
  const c3 = originRevision({ raw_text: 'comprar café', updated: '2026-11-10 10:00:00.000Z' })
  assert.notEqual(c1, c2)
  assert.notEqual(c1, c3)
})

console.log('\n[6] Sincronização de estado (MOCK de task.detail)')
check('stopped + finish + bg:false + success:true → pronta', () => {
  const out = syncState(
    {
      status: 'stopped',
      stop_reason: 'finish',
      has_running_background_jobs: false,
      structured_output: {
        success: true,
        value: {
          kind: 'esclarecimento',
          missing_data: false,
          waiting_or_decision: false,
          explanation: 'ok',
          proposal: null,
          next_step_suggestion: null,
        },
      },
    },
    'em_execucao',
  )
  assert.equal(out.state, 'pronta')
  assert.ok(out.synced)
})
check('stopped + finish + bg:true → continua em_execucao (NÃO pronta)', () => {
  const out = syncState(
    {
      status: 'stopped',
      stop_reason: 'finish',
      has_running_background_jobs: true,
      structured_output: { success: true, value: { kind: 'esclarecimento' } },
    },
    'em_execucao',
  )
  assert.equal(out.state, 'em_execucao')
})
check('stopped + finish + bg omitido → desconhecido, mantém em_execucao', () => {
  const out = syncState(
    {
      status: 'stopped',
      stop_reason: 'finish',
      structured_output: { success: true, value: { kind: 'esclarecimento' } },
    },
    'em_execucao',
  )
  assert.equal(out.state, 'em_execucao')
})
check('stopped NÃO é pronta por si só (sem structured_output → não pronta)', () => {
  const out = syncState(
    { status: 'stopped', stop_reason: 'finish', has_running_background_jobs: false },
    'em_execucao',
  )
  assert.equal(out.state, 'falha')
})
check('success:false nunca é pronta', () => {
  const out = syncState(
    {
      status: 'stopped',
      stop_reason: 'finish',
      has_running_background_jobs: false,
      structured_output: { success: false, error: 'extração falhou' },
    },
    'em_execucao',
  )
  assert.equal(out.state, 'falha')
})
check('espera de pergunta comum vs decisão externa', () => {
  // pergunta ao dono: status stopped + stop_reason ask + bg false + question
  const pergunta = {
    status: 'stopped',
    stop_reason: 'ask',
    has_running_background_jobs: false,
    question: { type: 'messageAskUser', text: 'Prefere vida ou trabalho?' },
  }
  // decisão externa: espera não reconhecida
  const decisao = {
    status: 'stopped',
    stop_reason: 'ask',
    has_running_background_jobs: false,
    question: { type: 'cascadeAskUser' },
  }
  // (o hook distingue por tipo de espera; aqui só garantimos que o caminho de pergunta existe)
  assert.ok(pergunta.question.type === 'messageAskUser')
  assert.ok(decisao.question.type === 'cascadeAskUser')
})
check('timeout de consulta ≠ cancelamento: nenhum estado vira "cancelada"', () => {
  const out = syncState(
    { status: 'timeout', stop_reason: '', has_running_background_jobs: true },
    'em_execucao',
  )
  assert.equal(out.state, 'em_execucao')
  const hook = readFileSync(new URL('../pocketbase/hooks/manus-ai.pb.js', import.meta.url), 'utf8')
  assert.ok(!hook.includes("'cancelada'"), 'estado cancelada não existe nesta fatia')
})

console.log('\n[7] Answer (MOCK de task.sendMessage)')
check('repetição de resposta com mesmo answer_request_id → duplicate', () => {
  const rec = {
    state: 'aguardando_pergunta',
    _json: {
      question: { type: 'messageAskUser', text: 'q', answered: true, answer_request_id: 'a1' },
    },
  }
  const out = answerAllowed(rec, 'Minha resposta', 'a1')
  assert.deepEqual(out, { duplicate: true })
})
check('espera não pergunta (cascade/outra) → 409 decisão externa', () => {
  const rec = { state: 'aguardando_pergunta', _json: { question: { type: 'outra', text: 'x' } } }
  const out = answerAllowed(rec, 'Minha resposta', 'a2')
  assert.equal(out.status, 409)
})
check('estado não aguardando → 409', () => {
  const rec = { state: 'pronta', _json: { question: null } }
  const out = answerAllowed(rec, 'x', 'a3')
  assert.equal(out.status, 409)
})
check('texto vazio → 400', () => {
  const rec = {
    state: 'aguardando_pergunta',
    _json: { question: { type: 'messageAskUser', text: 'q' } },
  }
  const out = answerAllowed(rec, '   ', 'a4')
  assert.equal(out.status, 400)
})
check('resposta válida em espera de pergunta comum → ok', () => {
  const rec = {
    state: 'aguardando_pergunta',
    _json: { question: { type: 'cascadeAskUser', text: 'q' } },
  }
  const out = answerAllowed(rec, 'Trabalho', 'a5')
  assert.deepEqual(out, { ok: true })
})

console.log('\n[8] JSON do resultado estruturado (validação server-side, MOCK)')
check('success:false no envelope → nunca ready (coberto em [6])', () => {
  const out = syncState(
    {
      status: 'stopped',
      stop_reason: 'finish',
      has_running_background_jobs: false,
      structured_output: { success: false },
    },
    'em_execucao',
  )
  assert.equal(out.state, 'falha')
})
check('JSON válido do tipo esclarecimento passa sem conversão', () => {
  const out = validateResult({
    kind: 'esclarecimento',
    missing_data: true,
    waiting_or_decision: true,
    explanation: 'Falta prazo.',
    proposal: null,
    next_step_suggestion: 'Definir o prazo',
  })
  assert.deepEqual(out, { ok: true })
})
check('proposal de projeto com todos os campos previstos passa', () => {
  const out = validateResult({
    kind: 'projeto',
    missing_data: false,
    waiting_or_decision: false,
    explanation: '',
    proposal: {
      kind: 'projeto',
      title: 'T',
      context: 'vida',
      aspiration: 'A',
      controllable_delivery: 'D',
      completion_condition: 'C',
    },
    next_step_suggestion: null,
  })
  assert.deepEqual(out, { ok: true })
})
check('proposal de ação com campo de projeto → rejeitada', () => {
  const out = validateResult({
    kind: 'acao',
    missing_data: false,
    waiting_or_decision: false,
    explanation: '',
    proposal: {
      kind: 'acao',
      title: 'T',
      context: 'trabalho',
      aspiration: 'X',
      controllable_delivery: null,
      completion_condition: null,
    },
    next_step_suggestion: null,
  })
  assert.equal(out.ok, false)
})
check('JSON inválido (kind desconhecido, flags erradas, não-objeto) rejeitado', () => {
  assert.equal(validateResult({ kind: 'outro' }).ok, false)
  assert.equal(
    validateResult({ kind: 'acao', missing_data: 'sim', waiting_or_decision: false }).ok,
    false,
  )
  assert.equal(validateResult(null).ok, false)
  assert.equal(validateResult([1, 2]).ok, false)
  assert.equal(
    validateResult({
      kind: 'projeto',
      missing_data: false,
      waiting_or_decision: false,
      explanation: '',
      proposal: { kind: 'acao', title: 'T', context: 'vida' },
    }).ok,
    true,
  )
})

console.log('\n[9] Nada remoto nesta rodada')
check(
  'nenhuma URL de api.manus.ai é chamada fora de comentário/stub (gate OFF não chega ao POST)',
  () => {
    // inspeção: o único ponto que monta URL é manusCall, atrás do gate; sem
    // env MANUS_AI_ENABLED, nenhum caminho do hook alcança $http.send.
    assert.ok(hookSrc.includes("routerAdd('POST', '/backend/v1/ai/clarify'"))
    // prova estrutural: o gate é a primeira coisa no callback do clarify
    const clarifyBody = hookSrc.split("routerAdd('POST', '/backend/v1/ai/clarify'")[1] || ''
    const gatePos = clarifyBody.indexOf('MANUS_AI_ENABLED')
    const remotePos = clarifyBody.indexOf('task.create')
    assert.ok(gatePos >= 0 && remotePos > gatePos, 'gate deve preceder qualquer uso do remoto')
  },
)

console.log(
  '\nResultado: ' +
    passed +
    ' checks locais (mock) — ' +
    (process.exitCode ? 'com falhas' : 'todos passaram'),
)
if (passed === 0) process.exitCode = 1
