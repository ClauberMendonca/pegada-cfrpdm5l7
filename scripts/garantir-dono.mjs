#!/usr/bin/env node
// Cria o dono do app (coleção users) se ainda não existir, usando o superusuário.
// Lê PEGADA_DONO_EMAIL e PEGADA_DONO_SENHA do ambiente (e PEGADA_PAINEL_SENHA, se o
// painel tiver senha própria); nunca imprime a senha. O dono administra as contas.
const BASE = (process.argv[2] || '').replace(/\/$/, '')
const email = process.env.PEGADA_DONO_EMAIL
const senha = process.env.PEGADA_DONO_SENHA
if (!BASE || !email || !senha) {
  console.error('Uso: PEGADA_DONO_EMAIL=... PEGADA_DONO_SENHA=... node scripts/garantir-dono.mjs https://app')
  process.exit(2)
}
const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    body: JSON.stringify(body),
  })
// O painel pode ter senha própria (PEGADA_PAINEL_SENHA); sem ela, vale a do dono.
const suSenha = process.env.PEGADA_PAINEL_SENHA || senha
const su = await post('/api/collections/_superusers/auth-with-password', { identity: email, password: suSenha })
if (!su.ok) {
  console.error('Não consegui entrar como superusuário (' + su.status + ').')
  process.exit(1)
}
const { token } = await su.json()
// Confere pela existência, não pela senha: o dono pode ter trocado a senha no app.
const filtro = encodeURIComponent(`email="${email.replace(/"/g, '')}"`)
const achou = await fetch(BASE + `/api/collections/users/records?filter=${filtro}&perPage=1`, {
  headers: { authorization: token },
}).then((r) => r.json())
const dono = achou.items?.[0]
if (dono) {
  if (dono.role !== 'admin') {
    const r = await fetch(BASE + '/api/collections/users/records/' + dono.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ role: 'admin' }),
    })
    console.log(r.ok ? 'O dono já existe e agora administra as contas.' : 'O dono já existe (não consegui marcar como administrador: ' + r.status + ').')
  } else console.log('O dono já existe.')
  process.exit(0)
}
const cria = await post(
  '/api/collections/users/records',
  { email, password: senha, passwordConfirm: senha, verified: true, timezone: 'America/Sao_Paulo', role: 'admin' },
  token,
)
if (!cria.ok) {
  console.error('Não consegui criar o dono (' + cria.status + '): ' + (await cria.text()).slice(0, 300))
  process.exit(1)
}
console.log('Dono criado.')
