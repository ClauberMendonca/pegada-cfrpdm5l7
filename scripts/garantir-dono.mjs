#!/usr/bin/env node
// Cria o dono do app (coleção users) se ainda não existir, usando o superusuário.
// Lê PEGADA_DONO_EMAIL e PEGADA_DONO_SENHA do ambiente; nunca imprime a senha.
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
const su = await post('/api/collections/_superusers/auth-with-password', { identity: email, password: senha })
if (!su.ok) {
  console.error('Não consegui entrar como superusuário (' + su.status + ').')
  process.exit(1)
}
const { token } = await su.json()
const entra = await post('/api/collections/users/auth-with-password', { identity: email, password: senha })
if (entra.ok) {
  console.log('O dono já existe e entra com a senha informada.')
  process.exit(0)
}
const cria = await post(
  '/api/collections/users/records',
  { email, password: senha, passwordConfirm: senha, verified: true, timezone: 'America/Sao_Paulo' },
  token,
)
if (!cria.ok) {
  console.error('Não consegui criar o dono (' + cria.status + '): ' + (await cria.text()).slice(0, 300))
  process.exit(1)
}
console.log('Dono criado.')
