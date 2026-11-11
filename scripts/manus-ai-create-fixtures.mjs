// NÃO EXECUTADO pela plataforma (sem Node). Execução externa pelo dono:
//   node scripts/manus-ai-create-fixtures.mjs
// Executa o callback REAL POST /backend/v1/ai/clarify de pocketbase/hooks/manus-ai.pb.js
// em Node VM, com stubs de $app (transação simulada com snapshot/rollback),
// $http, $os, e-requests. Não mede concorrência real da JSVM.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'pocketbase', 'hooks', 'manus-ai.pb.js'), 'utf8')

// Extrai o corpo do callback do clarify (primeiro routerAdd POST clarify).
const startTok = "routerAdd('POST', '/backend/v1/ai/clarify'"
const s0 = src.indexOf(startTok)
if (s0 < 0) throw new Error('callback clarify não encontrado')
const bodyStart = src.indexOf('{', src.indexOf('=>', s0)) + 1
const endTok = "\n})\n\nrouterAdd('GET', '/backend/v1/ai/requests/{id}'"
const bodyEnd = src.indexOf(endTok, s0)
if (bodyEnd < 0) throw new Error('fim do callback clarify não encontrado')
const callbackBody = src.slice(bodyStart, bodyEnd)

let failures = 0
let passes = 0
function check(name, cond, extra) {
  if (cond) passes++
  else {
    failures++
    console.log('FALHA:', name, extra !== undefined ? JSON.stringify(extra) : '')
  }
}

class ApiError extends Error {
  constructor(status, msg) {
    super(msg)
    this.status = status
  }
}
class NotFoundError extends ApiError {
  constructor(m) {
    super(404, m)
  }
}
class ForbiddenError extends ApiError {
  constructor(m) {
    super(403, m)
  }
}
class UnauthorizedError extends ApiError {
  constructor(m) {
    super(401, m)
  }
}
class BadRequestError extends ApiError {
  constructor(m) {
    super(400, m)
  }
}

// Banco simulado: coleções com registros independentes (clonados a cada leitura).
function makeDb(seed) {
  let tables = JSON.parse(JSON.stringify(seed))
  let id = 1000
  const wrap = (row, table) => ({
    id: row.id,
    _row: row,
    getString: (k) => (row[k] === undefined || row[k] === null ? '' : String(row[k])),
    get: (k) => row[k],
    set: (k, v) => {
      row[k] = v
    },
    _table: table,
  })
  const api = {
    _tables: () => tables,
    snapshot: () => JSON.stringify(tables),
    restore: (s) => {
      tables = JSON.parse(s)
    },
  }
  api.findRecordById = (table, rid) => {
    const r = (tables[table] || []).find((x) => x.id === rid)
    if (!r) throw new Error('not found')
    return wrap(JSON.parse(JSON.stringify(r)), table)
  }
  api.findRecordsByFilter = (table, _expr, _sort, limit, _off, params) => {
    // Filtro interpretado pelo harness: user_id/local_request_id/origin_id/state.
    return (tables[table] || [])
      .filter((r) => {
        if (params.u !== undefined && r.user_id !== params.u) return false
        if (params.l !== undefined && r.local_request_id !== params.l) return false
        if (params.o !== undefined && r.origin_id !== params.o) return false
        if (_expr.includes("'registrado'") && !['registrado', 'criacao_incerta'].includes(r.state))
          return false
        return true
      })
      .slice(0, limit || undefined)
      .map((r) => wrap(JSON.parse(JSON.stringify(r)), table))
  }
  api.findCollectionByNameOrId = () => ({ name: 'ai_requests' })
  api.save = (rec, table = 'ai_requests') => {
    const row = rec._row
    const list = tables[table]
    const i = list.findIndex((x) => x.id === row.id)
    const stored = { ...row }
    if (!stored.id) stored.id = 'r' + ++id
    if (i >= 0) list[i] = stored
    else list.push(stored)
    rec.id = stored.id
    rec._row = stored
  }
  api.runInTransaction = (fn, opts = {}) => {
    const snap = api.snapshot()
    const txApp = {
      findRecordById: api.findRecordById,
      findRecordsByFilter: api.findRecordsByFilter,
      findCollectionByNameOrId: api.findCollectionByNameOrId,
      save: (rec) => api.save(rec, rec._table || 'ai_requests'),
    }
    try {
      fn(txApp)
      if (opts.failCommit) throw new Error('commit simulado falhou')
    } catch (err) {
      api.restore(snap)
      throw err
    }
  }
  api.app = api
  return api
}

function runClarify({ db, auth, body, apiKey, http, newRecord }) {
  const e = {
    auth,
    app: db,
    requestInfo: () => ({ body }),
    json: (status, payload) => ({ status, payload }),
  }
  const calls = []
  const ctx = {
    e,
    str: (v) => (typeof v === 'string' ? v.trim() : ''),
    ApiError,
    NotFoundError,
    ForbiddenError,
    UnauthorizedError,
    BadRequestError,
    Record: function (col) {
      return newRecord(col)
    },
    // Gate ON apenas no ambiente fictício da VM; nenhuma variável real é alterada.
    $os: { getenv: (k) => (k === 'MANUS_AI_ENABLED' ? '1' : k === 'MANUS_API_KEY' ? apiKey : '') },
    $http: {
      send: (opts) => {
        calls.push(opts)
        return http(opts, calls.length)
      },
    },
    Date,
    JSON,
    String,
    Number,
    Array,
    Object,
    Error,
    console: { log() {}, warn() {}, error() {} },
    routerAdd: () => {},
    __result: null,
  }
  // helpers inline do próprio callback; sanitizeErr/str/etc. estão dentro do corpo.
  const code = `(function(e){ ${callbackBody} })(e)`
  let out
  try {
    out = vm.runInNewContext(code, ctx)
    return { res: { status: 200, payload: out }, calls }
  } catch (err) {
    return { res: { status: err.status || 500, error: err.message }, calls }
  }
}

function newRecordFactory(db) {
  return (col) => {
    const row = { id: '', user_id: '', created: '', updated: '', state: '' }
    const rec = {
      id: '',
      _row: row,
      _table: 'ai_requests',
      set: (k, v) => {
        row[k] = v
      },
      get: (k) => row[k],
      getString: (k) => (row[k] === undefined || row[k] === null ? '' : String(row[k])),
    }
    return rec
  }
}

const seedCap = (over = {}) => ({
  id: 'cap1',
  user_id: 'u1',
  status: 'pendente',
  raw_text: 'comprar pão',
  updated: '2026-11-11 10:00:00.000Z',
  ...over,
})
const okHttp =
  (taskId = 't-1', extra = {}) =>
  () => ({ statusCode: 200, json: { ok: true, task_id: taskId, ...extra } })

function freshDb(extra = {}) {
  return makeDb({ captures: [seedCap()], ai_requests: [], ...extra })
}

function call(db, body, http, apiKey = 'k-sec') {
  return runClarify({
    db,
    auth: { id: 'u1' },
    body,
    apiKey,
    http,
    newRecord: newRecordFactory(db),
  })
}

const base = { capture_id: 'cap1', context: 'vida', local_request_id: 'L1' }

// 1. criação normal: intenção gravada antes do HTTP; um POST; em_execucao
{
  const db = freshDb()
  const r = call(db, base, okHttp('t-1'))
  check('criação normal responde 200', r.res.status === 200, r.res)
  check('criação normal: um único POST', r.calls.length === 1, r.calls.length)
  const rows = db._tables().ai_requests
  check('criação normal: estado em_execucao', rows[0] && rows[0].state === 'em_execucao', rows)
  check('criação normal: vínculo gravado', rows[0] && rows[0].remote_task_id === 't-1')
}

// 2. falha no claim (consulta da captura falha) => zero HTTP
{
  const db = freshDb({ captures: [] })
  const r = call(db, base, okHttp())
  check('claim sem captura => erro', r.res.status !== 200, r.res)
  check('claim sem captura => zero HTTP', r.calls.length === 0, r.calls.length)
}

// 3. timeout + retry mesmo ID => duplicate/409 sem novo HTTP
{
  const db = freshDb()
  const timeout = () => {
    throw new Error('timeout')
  }
  const r1 = call(db, base, timeout)
  check('timeout => 502', r1.res.status === 502, r1.res)
  check('timeout => criacao_incerta', db._tables().ai_requests[0].state === 'criacao_incerta')
  const r2 = call(db, base, okHttp())
  check('retry mesmo ID => sem HTTP', r2.calls.length === 0, r2.calls.length)
}

// 4. timeout + outro ID => bloqueado sem HTTP
{
  const db = freshDb()
  call(db, base, () => {
    throw new Error('timeout')
  })
  const r2 = call(db, { ...base, local_request_id: 'L2' }, okHttp())
  check(
    'outro ID após incerta => bloqueado',
    r2.calls.length === 0 && r2.res.status === 409,
    r2.res,
  )
}

// 5. crash com 'registrado' residual bloqueia novo ID
{
  const db = freshDb({
    ai_requests: [
      {
        id: 'r-old',
        user_id: 'u1',
        origin_id: 'cap1',
        origin_type: 'captura',
        origin_revision: 'x|y',
        context: 'vida',
        local_request_id: 'OLD',
        state: 'registrado',
      },
    ],
  })
  const r = call(db, { ...base, local_request_id: 'L9' }, okHttp())
  check('registrado residual bloqueia', r.calls.length === 0 && r.res.status === 409, r.res)
}

// 6. dois submits intercalados com IDs diferentes: apenas o primeiro passa
{
  const db = freshDb()
  const first = call(db, base, () => {
    // o segundo chega durante o HTTP do primeiro
    const second = call(db, { ...base, local_request_id: 'L2' }, okHttp('t-2'))
    check('intercalado: segundo bloqueado sem HTTP', second.calls.length === 0, second.calls.length)
    return { statusCode: 200, json: { ok: true, task_id: 't-1' } }
  })
  check('intercalado: primeiro concluído', first.res.status === 200, first.res)
}

// 7. origem/dono/estado revalidados na transação
{
  const db = freshDb({ captures: [seedCap({ user_id: 'outro' })] })
  const r = call(db, base, okHttp())
  check('dono divergente => sem HTTP', r.calls.length === 0 && r.res.status === 403, r.res)
  const db2 = freshDb({ captures: [seedCap({ status: 'convertida' })] })
  const r2 = call(db2, base, okHttp())
  check(
    'captura não pendente => 409 sem HTTP',
    r2.calls.length === 0 && r2.res.status === 409,
    r2.res,
  )
}

// 8. 2xx ok:true sem task_id e status <200 não confirmam
{
  const db = freshDb()
  const r = call(db, base, () => ({ statusCode: 200, json: { ok: true } }))
  check(
    '2xx sem task_id => não confirma',
    r.res.status === 502 && db._tables().ai_requests[0].state === 'criacao_incerta',
    r.res,
  )
  const db2 = freshDb()
  const r2 = call(db2, base, () => ({ statusCode: 199, json: { ok: true, task_id: 'x' } }))
  check('status <200 => não confirma', r2.res.status === 502, r2.res)
}

// 9. remoto OK + save final falho + compensação sucesso/falha
{
  const db = freshDb()
  const orig = db.runInTransaction
  let n = 0
  db.runInTransaction = (fn, opts) => {
    n++
    if (n === 2) return orig(fn, { failCommit: true })
    return orig(fn, opts)
  }
  const r = call(db, base, okHttp('t-9', { request_id: 'q-9' }))
  check('save final falho => 502 pendente, nunca 200', r.res.status === 502, r.res)
  const rec = db._tables().ai_requests[0]
  check(
    'compensação preserva taskID recebido',
    rec && rec.remote_task_id === 't-9' && rec.state === 'criacao_incerta',
    rec,
  )
}
{
  const db = freshDb()
  const orig = db.runInTransaction
  let n = 0
  db.runInTransaction = (fn, opts) => {
    n++
    if (n >= 2) return orig(fn, { failCommit: true })
    return orig(fn, opts)
  }
  const r = call(db, base, okHttp('t-10'))
  check(
    'compensação falha => registrado bloqueia',
    r.res.status === 502 && db._tables().ai_requests[0].state === 'registrado',
    db._tables().ai_requests[0],
  )
  const r2 = call(db, { ...base, local_request_id: 'L3' }, okHttp())
  check('compensação falha => novo ID sem HTTP', r2.calls.length === 0, r2.calls.length)
}

// 10. atualização concorrente não perde vínculo/status novo
{
  const db = freshDb()
  call(db, base, () => {
    // outro fluxo finaliza o mesmo registro antes do commit final
    const t = db._tables().ai_requests
    t[0].state = 'em_execucao'
    t[0].remote_task_id = 't-11'
    return { statusCode: 200, json: { ok: true, task_id: 't-11' } }
  })
  const rec = db._tables().ai_requests[0]
  check(
    'concorrente mesmo vínculo => não regride',
    rec.state === 'em_execucao' && rec.remote_task_id === 't-11',
    rec,
  )
}
{
  const db = freshDb()
  call(db, base, () => {
    const t = db._tables().ai_requests
    t[0].remote_task_id = 'outro-vinculo'
    return { statusCode: 200, json: { ok: true, task_id: 't-12' } }
  })
  const rec = db._tables().ai_requests[0]
  check('vínculo existente nunca substituído', rec.remote_task_id === 'outro-vinculo', rec)
}

// 11. ID reutilizado com contexto/revisão/origem divergente => 409
{
  const db = freshDb({
    ai_requests: [
      {
        id: 'r-x',
        user_id: 'u1',
        origin_id: 'cap1',
        origin_type: 'captura',
        origin_revision: 'velha',
        context: 'vida',
        local_request_id: 'L1',
        state: 'em_execucao',
      },
    ],
  })
  const r = call(db, base, okHttp())
  check(
    'ID reutilizado com revisão divergente => 409 sem HTTP',
    r.res.status === 409 && r.calls.length === 0,
    r.res,
  )
}

// 12. Novo cliente: comparação EXATA da revisão aprovada antes de claim/HTTP.
// Campo opcional mantém compatibilidade dos 24 checks anteriores.
{
  const db = freshDb()
  const expected = seedCap().raw_text + '|' + seedCap().updated
  const r = call(db, { ...base, expected_origin_revision: expected }, okHttp())
  check(
    'revisão aprovada correta => 200 e um POST',
    r.res.status === 200 && r.calls.length === 1,
    r.res,
  )
}
{
  const db = freshDb()
  const r = call(db, { ...base, expected_origin_revision: 'texto antigo|data antiga' }, okHttp())
  check('revisão aprovada antiga => 409', r.res.status === 409, r.res)
  check(
    'revisão antiga => zero HTTP e zero intenção nova',
    r.calls.length === 0 && db._tables().ai_requests.length === 0,
  )
}
{
  for (const value of [null, 123, '', {}]) {
    const db = freshDb()
    const r = call(db, { ...base, expected_origin_revision: value }, okHttp())
    check(
      'revisão presente inválida => 400 sem HTTP/claim (' + JSON.stringify(value) + ')',
      r.res.status === 400 && r.calls.length === 0 && db._tables().ai_requests.length === 0,
      r.res,
    )
  }
}
{
  const db = freshDb({ captures: [seedCap({ raw_text: '  intenção com espaços  ' })] })
  const expected = '  intenção com espaços  |' + seedCap().updated
  const r = call(db, { ...base, expected_origin_revision: expected }, okHttp())
  check(
    'revisão com espaços preserva comparação exata',
    r.res.status === 200 && r.calls.length === 1,
    r.res,
  )
  const db2 = freshDb({ captures: [seedCap({ raw_text: '  intenção com espaços  ' })] })
  const r2 = call(db2, { ...base, expected_origin_revision: expected.trim() }, okHttp())
  check(
    'trim divergente => 409 e zero HTTP',
    r2.res.status === 409 && r2.calls.length === 0,
    r2.res,
  )
}
{
  const db = freshDb()
  const expected = seedCap().raw_text + '|' + seedCap().updated
  const orig = db.runInTransaction
  let first = true
  db.runInTransaction = (fn, opts) => {
    if (first) {
      first = false
      db._tables().captures[0].updated = '2026-11-11 10:00:01.000Z'
    }
    return orig(fn, opts)
  }
  const r = call(db, { ...base, expected_origin_revision: expected }, okHttp())
  check(
    'mudança antes do claim => bloqueada na transação sem HTTP',
    r.res.status === 409 && r.calls.length === 0 && db._tables().ai_requests.length === 0,
    r.res,
  )
}

console.log(`passes=${passes} failures=${failures}`)
if (failures > 0) process.exitCode = 1
