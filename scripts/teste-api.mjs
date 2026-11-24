#!/usr/bin/env node
// Teste de ponta a ponta da API do Pegada contra um servidor PocketBase rodando.
// Uso:
//   PEGADA_URL=http://127.0.0.1:8090 PB_ADMIN_EMAIL=... PB_ADMIN_SENHA=... node scripts/teste-api.mjs
// Cria um dono de teste (via superusuário), percorre o método inteiro pela API
// (níveis 0, 1 e 2) e sai com código 1 se qualquer verificação falhar.
// Nunca rode contra o app publicado: ele cria e apaga registros.

const BASE = (process.env.PEGADA_URL || 'http://127.0.0.1:8090').replace(/\/$/, '')
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const ADMIN_SENHA = process.env.PB_ADMIN_SENHA
const IA_ESPERADA = process.env.PEGADA_TESTE_IA || 'desligada' // 'desligada' | 'simulada'

if (!ADMIN_EMAIL || !ADMIN_SENHA) {
  console.error('Defina PB_ADMIN_EMAIL e PB_ADMIN_SENHA (superusuário do servidor de teste).')
  process.exit(2)
}

let falhas = 0
let total = 0
function confere(nome, cond, detalhe) {
  total++
  if (cond) {
    console.log('  ok   ' + nome)
  } else {
    falhas++
    console.log('  FALHA ' + nome + (detalhe ? ' → ' + JSON.stringify(detalhe).slice(0, 400) : ''))
  }
}

async function http(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = token
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null
  const txt = await res.text()
  try {
    json = txt ? JSON.parse(txt) : null
  } catch {
    json = { _texto: txt.slice(0, 200) }
  }
  return { status: res.status, json }
}

// Acha o id do registro criado: a API responde { resultado: { <tipo>_id: "..." } }.
function acharId(resultado) {
  if (!resultado || typeof resultado !== 'object') return null
  for (const [k, v] of Object.entries(resultado)) {
    if (k.endsWith('_id') && typeof v === 'string' && v) return v
  }
  return null
}

const emDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function main() {
  console.log('Pegada: teste da API em ' + BASE)

  // --- Servidor e catálogo ---
  const saude = await http('GET', '/api/health')
  confere('servidor responde /api/health', saude.status === 200, saude)
  const cat = await http('GET', '/backend/v1/pegada/operacoes')
  const nomes = (cat.json?.operacoes || []).map((o) => o.nome)
  confere('catálogo publica as operações do método', cat.status === 200 && nomes.length >= 30, { status: cat.status, n: nomes.length })
  const semLogin = await http('POST', '/backend/v1/pegada/op/capturar', { body: { texto: 'x' } })
  confere('escrita sem login é recusada', semLogin.status === 401 || semLogin.status === 403, semLogin)
  const site = await fetch(BASE + '/')
  confere('telas são servidas pelo mesmo servidor', site.status === 200 && (await site.text()).includes('<div id="root">'))
  const manifesto = await http('GET', '/manifest.webmanifest')
  confere('app instalável: manifesto publicado', manifesto.status === 200 && manifesto.json?.name === 'Pegada', manifesto)

  // --- Dono de teste ---
  const su = await http('POST', '/api/collections/_superusers/auth-with-password', {
    body: { identity: ADMIN_EMAIL, password: ADMIN_SENHA },
  })
  confere('login do superusuário', su.status === 200, su)
  const suToken = su.json?.token
  const email = 'dono-teste-' + Date.now() + '@pegada.teste'
  const senha = 'Teste-' + Math.random().toString(36).slice(2) + '-9Z'
  const cadastroPublico = await http('POST', '/api/collections/users/records', {
    body: { email, password: senha, passwordConfirm: senha },
  })
  confere('cadastro público está fechado', cadastroPublico.status >= 400, cadastroPublico)
  const criado = await http('POST', '/api/collections/users/records', {
    token: suToken,
    body: { email, password: senha, passwordConfirm: senha, verified: true, timezone: 'America/Sao_Paulo' },
  })
  confere('superusuário cria o dono', criado.status === 200, criado)
  const login = await http('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: senha } })
  confere('dono entra com e-mail e senha', login.status === 200, login)
  const t = login.json?.token
  const op = (nome, entrada = {}) => http('POST', '/backend/v1/pegada/op/' + nome, { token: t, body: entrada })

  // --- Propósito, Responsabilidade, Resultado, Estratégia ---
  const prop = await op('definir_proposito', { texto: 'Eu existo para cuidar de quem amo, para que todos cresçam com calma.' })
  confere('definir propósito', prop.status === 200 && prop.json?.ok, prop)
  const resp = await op('criar_responsabilidade', { titulo: 'Saúde da família', contexto: 'vida', escolhida_por: 'mim' })
  const respId = acharId(resp.json?.resultado)
  confere('criar responsabilidade', resp.status === 200 && respId, resp)
  const semPrazo = await op('criar_resultado', { titulo: 'Corrida de 10 km concluída' })
  confere('resultado sem prazo é recusado', semPrazo.status >= 400, semPrazo)
  const res = await op('criar_resultado', {
    titulo: 'Corrida de 10 km concluída',
    prazo: emDias(60),
    contexto: 'vida',
    responsabilidade_id: respId,
    como_sei: 'Termino a prova oficial',
  })
  const resId = acharId(res.json?.resultado)
  confere('criar resultado com prazo', res.status === 200 && resId, res)
  const est = await op('criar_estrategia', { resultado_id: resId, titulo: 'Treinar 3 vezes por semana', sinal_de_teste: 'Se em 4 semanas não correr 5 km, rever' })
  const estId = acharId(est.json?.resultado)
  confere('criar estratégia', est.status === 200 && estId, est)
  const edEst = await op('editar_estrategia', { estrategia_id: estId, titulo: 'Treinar 3 vezes por semana, cedo' })
  confere('editar estratégia', edEst.status === 200, edEst)

  // --- Avanços ---
  const av = await op('criar_avanco', { titulo: 'Correr 3 km no parque', tipo: 'acao', estrategia_id: estId, para_hoje: true })
  const avId = acharId(av.json?.resultado)
  confere('criar avanço ligado a estratégia', av.status === 200 && avId, av)
  const est2 = await op('criar_avanco', { titulo: 'Estudar planilhas de treino', tipo: 'estudo', resultado_id: resId })
  const estudoId = acharId(est2.json?.resultado)
  confere('criar avanço do tipo estudo', est2.status === 200 && estudoId, est2)
  const esperaSem = await op('criar_avanco', { titulo: 'Resposta do médico', tipo: 'espera' })
  confere('espera sem "aguardando" é recusada', esperaSem.status >= 400, esperaSem)
  const espera = await op('criar_avanco', { titulo: 'Resposta do médico', tipo: 'espera', aguardando: 'Dra. Ana' })
  confere('criar espera com "aguardando"', espera.status === 200, espera)
  const principal = await op('definir_avanco_principal', { avanco_id: avId })
  confere('definir avanço principal', principal.status === 200, principal)
  const paraHoje = await op('escolher_para_hoje', { avanco_id: estudoId, hoje: true })
  confere('escolher avanço para hoje', paraHoje.status === 200, paraHoje)
  const edAv = await op('editar_avanco', { avanco_id: avId, titulo: 'Correr 3 km no parque da cidade' })
  confere('editar avanço', edAv.status === 200, edAv)
  const situacao = await op('mudar_situacao_avanco', { avanco_id: avId, situacao: 'em_andamento' })
  confere('mudar situação do avanço', situacao.status === 200, situacao)

  const fio = await op('ver_fio_de_hoje')
  const fioTxt = JSON.stringify(fio.json || {})
  confere('fio de hoje mostra o porquê do avanço', fio.status === 200 && fioTxt.includes('Corrida de 10 km'), fio)

  const estudoSemRastro = await op('concluir_avanco', { avanco_id: estudoId })
  confere('estudo sem conclusão anotada não conclui (regra do rastro)', estudoSemRastro.status >= 400, estudoSemRastro)
  const estudoOk = await op('concluir_avanco', { avanco_id: estudoId, rastro: 'Planilha de 8 semanas escolhida.' })
  confere('estudo conclui com o rastro', estudoOk.status === 200, estudoOk)
  const concl = await op('concluir_avanco', { avanco_id: avId })
  confere('concluir ação', concl.status === 200, concl)
  const reab = await op('reabrir_avanco', { avanco_id: avId })
  confere('reabrir avanço', reab.status === 200, reab)
  const canc = await op('cancelar_avanco', { avanco_id: avId, motivo: 'Chuva forte' })
  confere('cancelar avanço', canc.status === 200, canc)

  // --- Capturas ---
  const cap = await op('capturar', { texto: 'Comprar tênis novo' })
  const capId = acharId(cap.json?.resultado)
  confere('capturar', cap.status === 200 && capId, cap)
  const edCap = await op('editar_captura', { captura_id: capId, texto: 'Comprar tênis de corrida' })
  confere('editar captura', edCap.status === 200, edCap)
  const proc = await op('processar_captura', { captura_id: capId, destino: 'avanco', dados: { tipo: 'acao', resultado_id: resId } })
  confere('processar captura em avanço', proc.status === 200, proc)
  const cap2 = await op('capturar', { texto: 'Ideia solta' })
  const desc = await op('descartar_captura', { captura_id: acharId(cap2.json?.resultado) })
  confere('descartar captura', desc.status === 200, desc)
  const listCap = await op('listar_capturas', { status: 'todas' })
  confere('listar capturas', listCap.status === 200, listCap)

  // --- Leituras ---
  const mapa = await op('ver_mapa')
  confere('ver mapa', mapa.status === 200 && JSON.stringify(mapa.json).includes('Saúde da família'), mapa)
  const semana = await op('ver_resumo_semana', { dias: 7 })
  confere('ver resumo da semana', semana.status === 200, semana)
  const listAv = await op('listar_avancos', { resultado_id: resId })
  confere('listar avanços do resultado', listAv.status === 200, listAv)

  // --- Histórico e desfazer ---
  const hist = await op('ver_historico', { limite: 50 })
  const eventos = hist.json?.resultado?.eventos || hist.json?.resultado || []
  confere('histórico registra as mudanças', hist.status === 200 && JSON.stringify(eventos).length > 50, hist)
  const lista = Array.isArray(eventos) ? eventos : Object.values(eventos).find(Array.isArray) || []
  const desfazivel = lista.find((ev) => ev && (ev.pode_desfazer === true || ev.desfazivel === true)) || lista[0]
  if (desfazivel?.id) {
    const des = await http('POST', '/backend/v1/pegada/desfazer/' + desfazivel.id, { token: t })
    confere('desfazer o último evento', des.status === 200, des)
  } else {
    confere('desfazer o último evento (evento encontrado)', false, hist.json)
  }

  // --- Resultado: decisões ---
  const dec = await op('decidir_resultado', { resultado_id: resId, decisao: 'pausar', nota: 'Lesão leve' })
  confere('decidir resultado (pausar)', dec.status === 200, dec)
  const lote = await http('POST', '/backend/v1/pegada/lote', {
    token: t,
    body: { atomico: true, operacoes: [{ op: 'capturar', entrada: { texto: 'A' } }, { op: 'capturar', entrada: { texto: 'B' } }] },
  })
  confere('lote atômico de operações', lote.status === 200, lote)

  // --- Nível 1: IA embutida ---
  const ia = await http('POST', '/backend/v1/pegada/ia/sugerir', { token: t, body: { tipo: 'resultado', texto: 'quero correr melhor' } })
  if (IA_ESPERADA === 'simulada') {
    confere('IA embutida devolve sugestão (servidor simulado)', ia.status === 200 && ia.json?.sugestao?.titulo, ia)
  } else {
    confere('IA embutida sem chave responde 503 honesto', ia.status === 503, ia)
  }

  // --- Nível 2: agentes por MCP ---
  const ag = await http('POST', '/backend/v1/pegada/agentes', { token: t, body: { nome: 'Agente de teste' } })
  const agToken = ag.json?.token
  confere('dono cria agente e recebe token', ag.status === 200 && /^pgd_/.test(agToken || ''), ag)
  const mcpInit = await fetch(BASE + '/backend/v1/pegada/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + agToken },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } }),
  })
  confere('MCP: initialize', mcpInit.status === 200)
  const mcpList = await fetch(BASE + '/backend/v1/pegada/mcp/' + agToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  })
  const tools = (await mcpList.json())?.result?.tools || []
  confere('MCP: lista as ferramentas (token na URL)', mcpList.status === 200 && tools.length >= 10, { n: tools.length })
  const mcpCall = await fetch(BASE + '/backend/v1/pegada/mcp/' + agToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capturar', arguments: { texto: 'Vinda do agente' } } }),
  })
  const callJson = await mcpCall.json()
  confere('MCP: agente captura', mcpCall.status === 200 && !callJson.error && !callJson.result?.isError, callJson)
  const revog = await http('POST', '/backend/v1/pegada/agentes/' + ag.json?.agente?.id + '/revogar', { token: t })
  confere('dono revoga o agente', revog.status === 200, revog)
  const aposRevog = await fetch(BASE + '/backend/v1/pegada/mcp/' + agToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
  })
  confere('token revogado deixa de funcionar', aposRevog.status === 401)

  // --- Isolamento entre donos ---
  const email2 = 'outro-' + Date.now() + '@pegada.teste'
  await http('POST', '/api/collections/users/records', {
    token: suToken,
    body: { email: email2, password: senha, passwordConfirm: senha, verified: true },
  })
  const login2 = await http('POST', '/api/collections/users/auth-with-password', { body: { identity: email2, password: senha } })
  const alheio = await http('POST', '/backend/v1/pegada/op/editar_resultado', {
    token: login2.json?.token,
    body: { resultado_id: resId, titulo: 'invadido' },
  })
  confere('outra pessoa não edita o resultado do dono', alheio.status >= 400, alheio)
  const leituraAlheia = await http('GET', '/api/collections/projects/records', { token: login2.json?.token })
  confere('outra pessoa não lê os registros do dono', leituraAlheia.status === 200 && (leituraAlheia.json?.items || []).length === 0, leituraAlheia)

  console.log(`\n${total - falhas} de ${total} verificações passaram.`)
  process.exit(falhas ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
