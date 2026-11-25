#!/usr/bin/env node
// Confere as sugestões da IA embutida (/ia/sugerir) com uma conta de teste.
const BASE = (process.argv[2] || '').replace(/\/$/, '')
const { PEGADA_TESTE_EMAIL: email, PEGADA_TESTE_SENHA: senha } = process.env
const entra = await fetch(BASE + '/api/collections/users/auth-with-password', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: senha }),
})
if (!entra.ok) {
  console.error('Não consegui entrar com a conta de teste (' + entra.status + ').')
  process.exit(1)
}
const { token } = await entra.json()
// Privacidade: a conta precisa ter lido o aviso e estar com a IA ligada.
await fetch(BASE + '/backend/v1/pegada/ia/preferencia', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: token },
  body: JSON.stringify({ aviso_visto: true, desligada: false }),
})
const casos = [
  ['avanco', 'ver uns tênis de corrida qualquer dia', ['titulo', 'tipo']],
  ['resultado', 'quero correr 10 km até março do ano que vem', ['titulo']],
  ['proposito', 'gosto de cuidar da minha família e ensinar', ['texto']],
  ['captura', 'ideia de organizar a garagem no fim de semana', ['destino', 'titulo']],
]
let falhas = 0
for (const [tipo, texto, campos] of casos) {
  const r = await fetch(BASE + '/backend/v1/pegada/ia/sugerir', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ tipo, texto }),
  })
  const j = await r.json().catch(() => ({}))
  const ok = r.ok && campos.every((c) => String(j.sugestao?.[c] || '').trim())
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${tipo}: ${r.status} ${JSON.stringify(j.sugestao || j).slice(0, 220)}`)
}
console.log(`\n${casos.length - falhas} de ${casos.length} sugestões da IA vieram certas.`)
process.exit(falhas ? 1 : 0)
