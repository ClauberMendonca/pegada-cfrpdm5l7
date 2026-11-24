#!/usr/bin/env node
// Cria (ou renova a senha de) uma conta só de teste no app, usando o superusuário.
// Assim os testes pelas telas não gravam nada na conta do dono.
// Lê PEGADA_DONO_EMAIL/PEGADA_DONO_SENHA (superusuário) e PEGADA_TESTE_EMAIL/PEGADA_TESTE_SENHA.
const BASE = (process.argv[2] || '').replace(/\/$/, '')
const { PEGADA_DONO_EMAIL: suEmail, PEGADA_DONO_SENHA: suSenha, PEGADA_TESTE_EMAIL: email, PEGADA_TESTE_SENHA: senha } =
  process.env
if (!BASE || !suEmail || !suSenha || !email || !senha) {
  console.error('Uso: PEGADA_DONO_EMAIL=... PEGADA_DONO_SENHA=... PEGADA_TESTE_EMAIL=... PEGADA_TESTE_SENHA=... node scripts/conta-teste.mjs https://app')
  process.exit(2)
}
const pede = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }
}
// A prévia desliga quando parada: a primeira chamada a acorda.
for (let i = 0; i < 20; i++) {
  if ((await fetch(BASE + '/api/health').catch(() => ({ ok: false }))).ok) break
  await new Promise((r) => setTimeout(r, 3000))
}
const su = await pede('POST', '/api/collections/_superusers/auth-with-password', { identity: suEmail, password: suSenha })
if (!su.ok) {
  console.error('Não consegui entrar como superusuário (' + su.status + ').')
  process.exit(1)
}
const token = su.json.token
const filtro = encodeURIComponent(`email="${email.replace(/"/g, '')}"`)
const achou = await pede('GET', `/api/collections/users/records?filter=${filtro}&perPage=1`, null, token)
const dados = { password: senha, passwordConfirm: senha, verified: true }
const r = achou.json.items?.length
  ? await pede('PATCH', `/api/collections/users/records/${achou.json.items[0].id}`, dados, token)
  : await pede('POST', '/api/collections/users/records', { email, ...dados, timezone: 'America/Sao_Paulo' }, token)
if (!r.ok) {
  console.error('Não consegui preparar a conta de teste (' + r.status + '): ' + JSON.stringify(r.json).slice(0, 300))
  process.exit(1)
}
// Rodadas anteriores deixam resultados ativos; o método limita quantos podem
// estar ativos, então os antigos da conta de teste são pausados aqui.
const id = achou.json.items?.[0]?.id
if (id) {
  const f = encodeURIComponent(`user_id="${id}" && status="ativo"`)
  const ativos = await pede('GET', `/api/collections/projects/records?filter=${f}&perPage=200`, null, token)
  for (const p of ativos.json.items || [])
    await pede('PATCH', `/api/collections/projects/records/${p.id}`, { status: 'pausado' }, token)
  if (ativos.json.items?.length) console.log(`Pausados ${ativos.json.items.length} resultados de rodadas anteriores.`)
}
console.log(achou.json.items?.length ? 'Conta de teste renovada.' : 'Conta de teste criada.')
