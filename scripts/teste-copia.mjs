#!/usr/bin/env node
// Confere a cópia de segurança: a agenda semanal está ligada e o servidor
// consegue gerar uma cópia completa que dá para baixar. Apaga a cópia de teste.
const BASE = (process.argv[2] || '').replace(/\/$/, '')
const { PEGADA_DONO_EMAIL: email } = process.env
// O painel pode ter senha própria; sem ela, vale a do dono.
const senha = process.env.PEGADA_PAINEL_SENHA || process.env.PEGADA_DONO_SENHA
const pede = (method, path, body, token) =>
  fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
const su = await pede('POST', '/api/collections/_superusers/auth-with-password', { identity: email, password: senha })
if (!su.ok) {
  console.error('Não consegui entrar como superusuário (' + su.status + ').')
  process.exit(1)
}
const { token } = await su.json()
let falhas = 0
const confere = (nome, ok, detalhe = '') => {
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome}${ok ? '' : ' → ' + detalhe}`)
}
const ajustes = await (await pede('GET', '/api/settings', null, token)).json()
confere('cópia semanal agendada', ajustes.backups?.cron === '0 6 * * 0' && ajustes.backups?.cronMaxKeep === 8, JSON.stringify(ajustes.backups))
const nome = `teste_${Date.now()}.zip`
const cria = await pede('POST', '/api/backups', { name: nome }, token)
confere('servidor gera uma cópia completa', cria.ok, String(cria.status))
const ft = await (await pede('POST', '/api/files/token', null, token)).json()
const baixa = await fetch(`${BASE}/api/backups/${nome}?token=${ft.token}`)
const bytes = new Uint8Array(await baixa.arrayBuffer())
confere('a cópia pode ser baixada e é um arquivo zip', baixa.ok && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 10000, `${baixa.status}, ${bytes.length} bytes`)
await pede('DELETE', `/api/backups/${nome}`, null, token)
console.log(`\nCópia de segurança: ${3 - falhas} de 3 verificações passaram (${Math.round(bytes.length / 1024)} KB).`)
process.exit(falhas ? 1 : 0)
