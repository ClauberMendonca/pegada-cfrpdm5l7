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

// Contas por convite, Minha conta e registro de acesso.
async function contas({ t, suToken, donoId, login2 }) {
  const U = '/api/collections/users'
  const C = '/backend/v1/pegada/conta'
  const cfg = await http('GET', C + '/config')
  confere('conta: config pública diz se há e-mail', cfg.status === 200 && typeof cfg.json?.email === 'boolean', cfg)
  const cadastroAberto = await http('POST', U + '/records', {
    body: { email: 'aberto-' + Date.now() + '@pegada.teste', password: 'uma-senha-bem-longa', passwordConfirm: 'uma-senha-bem-longa' },
  })
  confere('conta: cadastro público continua fechado', cadastroAberto.status >= 400, cadastroAberto)
  const semAdmin = await http('POST', C + '/convites', { token: t, body: { email: 'x@pegada.teste' } })
  confere('conta: quem não administra não convida', semAdmin.status === 403, semAdmin)
  // O superusuário do servidor de teste promove o dono de teste a administrador.
  const promove = await http('PATCH', U + '/records/' + donoId, { token: suToken, body: { role: 'admin' } })
  confere('conta: superusuário define quem administra', promove.status === 200 && promove.json?.role === 'admin', promove)
  const autoPromove = await http('PATCH', U + '/records/' + login2.json?.record?.id, {
    token: login2.json?.token,
    body: { role: 'admin' },
  })
  confere('conta: ninguém se promove a administrador', autoPromove.status >= 400, autoPromove)

  const emailConv = 'convidada-' + Date.now() + '@pegada.teste'
  const conv = await http('POST', C + '/convites', { token: t, body: { email: emailConv } })
  const linkConv = conv.json?.link || ''
  const tokenConv = linkConv.split('/convite/')[1] || ''
  confere('conta: admin cria convite e recebe o link uma vez', conv.status === 200 && tokenConv.length === 40, conv)
  const lista = await http('GET', C + '/convites', { token: t })
  const naLista = (lista.json?.convites || []).find((c) => c.email === emailConv)
  confere('conta: lista de convites não expõe o token', lista.status === 200 && naLista?.situacao === 'pendente' && !JSON.stringify(lista.json).includes(tokenConv), lista)
  const verConv = await http('GET', C + '/convite/' + tokenConv)
  confere('conta: convite válido mostra o e-mail convidado', verConv.status === 200 && verConv.json?.valido === true && verConv.json?.email === emailConv, verConv)
  const convFalso = await http('GET', C + '/convite/' + 'A'.repeat(40))
  confere('conta: token inventado não vale', convFalso.status === 200 && convFalso.json?.valido === false, convFalso)
  const senhaCurta = await http('POST', C + '/convite/' + tokenConv + '/aceitar', { body: { nome: 'Convidada', senha: 'curta', aceito_aviso: true } })
  confere('conta: senha curta é recusada', senhaCurta.status === 400, senhaCurta)
  const senhaComum = await http('POST', C + '/convite/' + tokenConv + '/aceitar', { body: { nome: 'Convidada', senha: '1234567890', aceito_aviso: true } })
  confere('conta: senha comum é recusada', senhaComum.status === 400, senhaComum)
  const semAviso = await http('POST', C + '/convite/' + tokenConv + '/aceitar', { body: { nome: 'Convidada', senha: 'cavalo-bateria-grampo' } })
  confere('conta: sem aceitar o aviso de privacidade não cria', semAviso.status === 400, semAviso)
  const senhaConv = 'cavalo-bateria-grampo'
  const aceita = await http('POST', C + '/convite/' + tokenConv + '/aceitar', {
    body: { nome: 'Convidada de Teste', senha: senhaConv, fuso: 'America/Sao_Paulo', aceito_aviso: true },
  })
  confere('conta: convite aceito cria a conta', aceita.status === 200 && aceita.json?.ok === true, aceita)
  const reuso = await http('POST', C + '/convite/' + tokenConv + '/aceitar', { body: { nome: 'Outra', senha: 'cavalo-bateria-grampo', aceito_aviso: true } })
  confere('conta: convite só vale uma vez', reuso.status === 400, reuso)
  const entra = await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: senhaConv } })
  const tc = entra.json?.token
  const idConv = entra.json?.record?.id
  confere('conta: a pessoa convidada entra com a senha que escolheu', entra.status === 200 && !!tc && entra.json?.record?.verified === true, entra)
  const vazio = await http('GET', '/api/collections/projects/records', { token: tc })
  confere('conta: conta nova começa vazia', vazio.status === 200 && (vazio.json?.items || []).length === 0, vazio)
  const capNova = await http('POST', '/backend/v1/pegada/op/capturar', { token: tc, body: { texto: 'Primeira captura da convidada' } })
  confere('conta: conta nova já usa o método', capNova.status === 200, capNova)

  // Minha conta
  const novoNome = await http('PATCH', U + '/records/' + idConv, { token: tc, body: { name: 'Convidada Renomeada' } })
  confere('minha conta: a pessoa troca o próprio nome', novoNome.status === 200 && novoNome.json?.name === 'Convidada Renomeada', novoNome)
  const trocaEmail = await http('PATCH', U + '/records/' + idConv, { token: tc, body: { email: 'trocado@pegada.teste' } })
  confere('minha conta: e-mail não muda sem confirmação', trocaEmail.status >= 400, trocaEmail)
  const semAtual = await http('PATCH', U + '/records/' + idConv, { token: tc, body: { password: 'outra-senha-bem-longa', passwordConfirm: 'outra-senha-bem-longa' } })
  confere('minha conta: trocar senha exige a senha atual', semAtual.status >= 400, semAtual)
  const fracaNova = await http('PATCH', U + '/records/' + idConv, { token: tc, body: { oldPassword: senhaConv, password: 'qwertyuiop', passwordConfirm: 'qwertyuiop' } })
  confere('minha conta: senha nova comum é recusada', fracaNova.status === 400, fracaNova)
  const senhaNova = 'girassol-martelo-vento'
  const troca = await http('PATCH', U + '/records/' + idConv, { token: tc, body: { oldPassword: senhaConv, password: senhaNova, passwordConfirm: senhaNova } })
  confere('minha conta: a pessoa troca a própria senha', troca.status === 200, troca)
  const tokenVelho = await http('GET', U + '/records/' + idConv, { token: tc })
  confere('minha conta: trocar a senha encerra a sessão antiga', tokenVelho.status >= 400, tokenVelho)
  const entra2 = await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: senhaNova } })
  const tc2 = entra2.json?.token
  confere('minha conta: a senha nova entra', entra2.status === 200 && !!tc2, entra2)
  const sair = await http('POST', C + '/sair-de-todos', { token: tc2 })
  const tc3 = sair.json?.token
  confere('minha conta: sair de todos devolve uma sessão nova', sair.status === 200 && !!tc3 && tc3 !== tc2, sair)
  const velho2 = await http('GET', U + '/records/' + idConv, { token: tc2 })
  const novo3 = await http('GET', U + '/records/' + idConv, { token: tc3 })
  confere('minha conta: as outras sessões caem e a atual continua', velho2.status >= 400 && novo3.status === 200, { velho: velho2.status, novo: novo3.status })

  // Registro de acesso
  await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: 'senha-errada-de-teste' } })
  const meus = await http('GET', '/api/collections/access_events/records?sort=-created&perPage=50', { token: tc3 })
  const tipos = (meus.json?.items || []).map((x) => x.kind)
  confere(
    'acesso: a pessoa vê as próprias entradas, falhas e trocas',
    ['conta_criada', 'entrada', 'senha_trocada', 'sessoes_encerradas', 'falha_entrada'].every((k) => tipos.includes(k)),
    tipos,
  )
  confere('acesso: o registro não guarda senha nem token', !JSON.stringify(meus.json).includes(senhaNova) && !JSON.stringify(meus.json).includes(tc3), null)
  const alheios = await http('GET', '/api/collections/access_events/records?perPage=200', { token: login2.json?.token })
  confere('acesso: ninguém lê o registro de outra pessoa', alheios.status === 200 && (alheios.json?.items || []).every((x) => x.user_id === login2.json?.record?.id), alheios)
  const todosNegado = await http('GET', C + '/acessos', { token: tc3 })
  const todos = await http('GET', C + '/acessos', { token: t })
  confere('acesso: só quem administra vê o registro de todos', todosNegado.status === 403 && todos.status === 200 && (todos.json?.acessos || []).length > 0, { negado: todosNegado.status, todos: todos.status })

  // Exportar, uso agregado e excluir conta
  const exp = await http('GET', C + '/exportar', { token: tc3 })
  const expTexto = JSON.stringify(exp.json || {})
  confere('conta: a pessoa exporta os próprios dados', exp.status === 200 && expTexto.includes('Primeira captura da convidada') && exp.json?.conta?.email === emailConv, { status: exp.status })
  confere('conta: a exportação não traz senha, token nem dados de outra pessoa', !expTexto.includes('tokenKey') && !expTexto.includes('token_hash') && !expTexto.includes('password') && !expTexto.includes(donoId), null)
  const usoNegado = await http('GET', C + '/uso', { token: tc3 })
  const uso = await http('GET', C + '/uso', { token: t })
  const usoDono = (uso.json?.uso || []).find((x) => x.id === donoId)
  const usoConv = (uso.json?.uso || []).find((x) => x.id === idConv)
  confere('uso: só quem administra vê as contagens', usoNegado.status === 403 && uso.status === 200, { negado: usoNegado.status, uso: uso.status })
  confere('uso: conta dias e operações por pessoa, sem conteúdo', usoDono?.operacoes_28 > 5 && usoDono?.dias_com_uso_7 === 1 && usoConv?.operacoes_28 >= 1 && !JSON.stringify(uso.json).includes('Primeira captura'), { dono: usoDono, conv: usoConv })
  {
    const emailSai = 'vai-sair-' + Date.now() + '@pegada.teste'
    const cv = await http('POST', C + '/convites', { token: t, body: { email: emailSai } })
    const tk = (cv.json?.link || '').split('/convite/')[1]
    const senhaSai = 'tijolo-nuvem-cadeira'
    await http('POST', C + '/convite/' + tk + '/aceitar', { body: { nome: 'Vai Sair', senha: senhaSai, aceito_aviso: true } })
    const ls = await http('POST', U + '/auth-with-password', { body: { identity: emailSai, password: senhaSai } })
    const ts = ls.json?.token
    await http('POST', '/backend/v1/pegada/op/capturar', { token: ts, body: { texto: 'Captura que vai embora' } })
    const semSenha = await http('POST', C + '/excluir', { token: ts, body: { senha: 'errada-errada', confirmo: 'EXCLUIR' } })
    const semPalavra = await http('POST', C + '/excluir', { token: ts, body: { senha: senhaSai } })
    confere('conta: excluir exige a senha e a confirmação', semSenha.status === 400 && semPalavra.status === 400, { senha: semSenha.status, palavra: semPalavra.status })
    const exclui = await http('POST', C + '/excluir', { token: ts, body: { senha: senhaSai, confirmo: 'EXCLUIR' } })
    const naoEntra = await http('POST', U + '/auth-with-password', { body: { identity: emailSai, password: senhaSai } })
    const sobras = await http('GET', '/api/collections/captures/records?filter=' + encodeURIComponent(`user_id="${ls.json?.record?.id}"`), { token: suToken })
    confere('conta: excluir apaga a conta e tudo o que era dela', exclui.status === 200 && naoEntra.status >= 400 && (sobras.json?.items || []).length === 0, { exclui: exclui.status, entra: naoEntra.status, sobras: sobras.json?.items?.length })
    const adminSai = await http('POST', C + '/excluir', { token: t, body: { senha: 'qualquer', confirmo: 'EXCLUIR' } })
    confere('conta: quem administra não se exclui por engano', adminSai.status === 400, adminSai)
  }

  // Desativar e reativar
  const pessoas = await http('GET', C + '/pessoas', { token: t })
  confere('conta: admin lista as pessoas sem conteúdo do método', pessoas.status === 200 && (pessoas.json?.pessoas || []).some((x) => x.id === idConv), pessoas)
  const desliga = await http('POST', C + '/pessoas/' + idConv + '/desativar', { token: t })
  const barrada = await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: senhaNova } })
  const sessaoCaiu = await http('GET', U + '/records/' + idConv, { token: tc3 })
  confere('conta: conta desativada não entra e perde a sessão', desliga.status === 200 && barrada.status >= 400 && sessaoCaiu.status >= 400, { desliga: desliga.status, barrada: barrada.status, sessao: sessaoCaiu.status })
  const religa = await http('POST', C + '/pessoas/' + idConv + '/reativar', { token: t })
  const volta = await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: senhaNova } })
  confere('conta: conta reativada volta a entrar com os dados guardados', religa.status === 200 && volta.status === 200, { religa: religa.status, volta: volta.status })
  const propria = await http('POST', C + '/pessoas/' + donoId + '/desativar', { token: t })
  confere('conta: admin não desativa a própria conta', propria.status === 400, propria)

  // E-mail: convite, recuperação de senha e troca de e-mail (só com a caixa de teste ligada)
  if (cfg.json?.email === true && process.env.PEGADA_TESTE_CAIXA) {
    const caixa = async (para, trecho) => {
      for (let i = 0; i < 20; i++) {
        const r = await fetch(process.env.PEGADA_TESTE_CAIXA).then((x) => x.json())
        const m = r.filter((x) => x.para.includes(para) && x.corpo.includes(trecho)).pop()
        if (m) return m.corpo
        await new Promise((ok) => setTimeout(ok, 250))
      }
      return ''
    }
    const emailC2 = 'por-email-' + Date.now() + '@pegada.teste'
    const conv2 = await http('POST', C + '/convites', { token: t, body: { email: emailC2 } })
    const cartaConv = await caixa(emailC2, '/convite/')
    confere('e-mail: o convite chega com o link', conv2.json?.email_enviado === true && cartaConv.includes(conv2.json?.link), { enviado: conv2.json?.email_enviado })

    const pede = await http('POST', U + '/request-password-reset', { body: { email: emailConv } })
    const inexistente = await http('POST', U + '/request-password-reset', { body: { email: 'ninguem-' + Date.now() + '@pegada.teste' } })
    confere('senha: o pedido responde igual exista ou não a conta', pede.status === 204 && inexistente.status === 204, { existe: pede.status, nao: inexistente.status })
    const carta = await caixa(emailConv, '/nova-senha/')
    const tokenReset = (carta.match(/\/nova-senha\/([A-Za-z0-9._-]+)/) || [])[1] || ''
    confere('senha: o link de nova senha chega por e-mail, em português', !!tokenReset && carta.includes('30 minutos'), carta.slice(0, 200))
    const resetFraco = await http('POST', U + '/confirm-password-reset', { body: { token: tokenReset, password: '1234567890', passwordConfirm: '1234567890' } })
    confere('senha: a senha nova pelo link também não pode ser comum', resetFraco.status === 400, resetFraco)
    const senhaReset = 'janela-tambor-abacate'
    const reset = await http('POST', U + '/confirm-password-reset', { body: { token: tokenReset, password: senhaReset, passwordConfirm: senhaReset } })
    const entraReset = await http('POST', U + '/auth-with-password', { body: { identity: emailConv, password: senhaReset } })
    confere('senha: a pessoa redefine pelo link e entra', reset.status === 204 && entraReset.status === 200, { reset: reset.status, entra: entraReset.status })
    const reusoReset = await http('POST', U + '/confirm-password-reset', { body: { token: tokenReset, password: 'outra-senha-bem-longa', passwordConfirm: 'outra-senha-bem-longa' } })
    confere('senha: o link só vale uma vez', reusoReset.status >= 400, reusoReset)

    const emailNovo = 'novo-' + Date.now() + '@pegada.teste'
    const pedeTroca = await http('POST', U + '/request-email-change', { token: entraReset.json?.token, body: { newEmail: emailNovo } })
    const cartaTroca = await caixa(emailNovo, '/confirmar-email/')
    const tokenTroca = (cartaTroca.match(/\/confirmar-email\/([A-Za-z0-9._-]+)/) || [])[1] || ''
    const confirma = await http('POST', U + '/confirm-email-change', { body: { token: tokenTroca, password: senhaReset } })
    const entraNovo = await http('POST', U + '/auth-with-password', { body: { identity: emailNovo, password: senhaReset } })
    confere('e-mail: a troca só vale depois de confirmar no endereço novo', pedeTroca.status === 204 && confirma.status === 204 && entraNovo.status === 200, { pede: pedeTroca.status, confirma: confirma.status, entra: entraNovo.status })
  }

  // Cabeçalhos de segurança
  const cab = await fetch(BASE + '/')
  confere(
    'servidor: telas saem com cabeçalhos de segurança',
    (cab.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'") && cab.headers.get('x-content-type-options') === 'nosniff',
    { csp: cab.headers.get('content-security-policy') },
  )
}

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
  confere(
    'mapa traz avanços livres e os que sustentam cada responsabilidade',
    Array.isArray(mapa.json?.resultado?.avancos_livres) &&
      (mapa.json?.resultado?.responsabilidades || []).every((r) => Array.isArray(r.avancos)),
    mapa,
  )
  // --- Vontades: no mesmo nível da responsabilidade, logo abaixo do Propósito ---
  const vont = await op('criar_vontade', { titulo: 'Voltar a tocar violão', contexto: 'vida' })
  const vontId = vont.json?.resultado?.vontade_id
  confere('criar vontade', vont.status === 200 && vontId, vont)
  const vontSem = await op('criar_vontade', { titulo: 'Sem contexto' })
  confere('vontade exige contexto', vontSem.status >= 400, vontSem)
  const rv = await op('criar_resultado', { titulo: 'Tocar duas músicas inteiras até julho', prazo: '2027-07-01', vontade_id: vontId })
  const rvId = rv.json?.resultado?.resultado_id
  confere('resultado nasce de uma vontade', rv.status === 200 && rvId, rv)
  const dupla = await op('criar_resultado', { titulo: 'Origem dupla', prazo: '2027-07-01', vontade_id: vontId, responsabilidade_id: respId })
  confere('resultado não nasce de vontade e responsabilidade ao mesmo tempo', dupla.status >= 400, dupla)
  const livre = await op('criar_resultado', { titulo: 'Resultado livre até agosto', prazo: '2027-08-01' })
  const livreId = livre.json?.resultado?.resultado_id
  confere('resultado livre continua permitido', livre.status === 200 && livreId, livre)
  const avV = await op('criar_avanco', { titulo: 'Afinar o violão', tipo: 'acao', resultado_id: rvId, para_hoje: true })
  confere('avanço de resultado de vontade tem o fio com a vontade', avV.json?.resultado?.fio?.apoio === 'vontade' && /realizando a vontade/.test(avV.json?.resultado?.fio?.frase || ''), avV)
  const mapa2 = await op('ver_mapa')
  const vontades = mapa2.json?.resultado?.vontades || []
  confere('mapa traz as vontades', vontades.some((v) => v.titulo === 'Voltar a tocar violão'), mapa2)
  confere(
    'mapa traz vontade_id em cada resultado',
    (mapa2.json?.resultado?.resultados || []).find((r) => r.id === rvId)?.vontade_id === vontId,
    mapa2,
  )
  const religa = await op('editar_resultado', { resultado_id: rvId, responsabilidade_id: respId })
  confere('ligar o resultado a uma responsabilidade desliga a vontade', religa.status === 200, religa)
  const mapa3 = await op('ver_mapa')
  confere('resultado fica com uma origem só', (mapa3.json?.resultado?.resultados || []).find((r) => r.id === rvId)?.vontade_id === null, mapa3)
  const volta = await op('editar_resultado', { resultado_id: rvId, vontade_id: vontId })
  confere('religar a uma vontade', volta.status === 200, volta)
  // Excluir manda para a Lixeira, com o que está embaixo. De lá, restaura ou apaga de vez.
  const vx = await op('criar_vontade', { titulo: 'Vontade para excluir', contexto: 'vida' })
  const vxId = vx.json?.resultado?.vontade_id
  const rx = await op('criar_resultado', { titulo: 'Resultado para excluir até julho', prazo: '2027-07-01', vontade_id: vxId, situacao: 'futuro' })
  const rxId = rx.json?.resultado?.resultado_id
  const ex = await op('criar_estrategia', { resultado_id: rxId, titulo: 'Estratégia para excluir' })
  const exId = ex.json?.resultado?.estrategia_id
  const ax = await op('criar_avanco', { titulo: 'Avanço para excluir', tipo: 'acao', estrategia_id: exId })
  const axId = ax.json?.resultado?.avanco_id
  const ax2 = await op('criar_avanco', { titulo: 'Outro avanço para excluir', tipo: 'acao', resultado_id: rxId })
  const ax2Id = ax2.json?.resultado?.avanco_id
  const noMapa = async () => JSON.stringify((await op('ver_mapa', {})).json?.resultado || {})
  const conta = await op('ver_o_que_sai', { elemento: 'vontade', id: vxId })
  const ab = conta.json?.resultado?.abaixo || {}
  confere('contar o que sai junto com a vontade', ab.resultados === 1 && ab.estrategias === 1 && ab.avancos === 2, conta)
  const exA = await op('excluir', { elemento: 'avanco', id: ax2Id })
  confere('excluir um avanço manda para a Lixeira', exA.status === 200 && exA.json?.resultado?.lixeira_id, exA)
  const desf = await http('POST', '/backend/v1/pegada/desfazer/' + exA.json?.evento_id, { token: t })
  confere('exclusão não se desfaz pelo histórico', desf.status === 409, desf)
  const volta1 = await op('restaurar', { lixeira_id: exA.json?.resultado?.lixeira_id })
  const lido = await op('listar_avancos', { resultado_id: rxId })
  confere('restaurar devolve o avanço ao lugar dele', volta1.status === 200 && JSON.stringify(lido.json).includes(ax2Id), volta1)
  const exV = await op('excluir', { elemento: 'vontade', id: vxId })
  confere('excluir a vontade leva tudo abaixo', exV.status === 200 && exV.json?.resultado?.abaixo?.avancos === 2, exV)
  let txt = await noMapa()
  confere('o que foi excluído some do mapa', !txt.includes(vxId) && !txt.includes(rxId) && !txt.includes(exId) && !txt.includes(axId), null)
  confere('o que não estava embaixo continua', txt.includes(vontId) && txt.includes(rvId), null)
  const lix = await op('ver_lixeira', {})
  const item = (lix.json?.resultado?.itens || []).find((i) => i.id === exV.json?.resultado?.lixeira_id)
  confere('a Lixeira lista a vontade e o que foi junto', item?.elemento === 'vontade' && item?.abaixo?.resultados === 1, lix)
  const volta2 = await op('restaurar', { lixeira_id: item?.id })
  txt = await noMapa()
  confere('restaurar devolve a vontade com tudo abaixo', volta2.status === 200 && txt.includes(vxId) && txt.includes(rxId) && txt.includes(exId) && txt.includes(axId), volta2)
  const exR = await op('excluir', { elemento: 'resultado', id: rxId })
  const exV2 = await op('excluir', { elemento: 'vontade', id: vxId })
  const voltaR = await op('restaurar', { lixeira_id: exR.json?.resultado?.lixeira_id })
  txt = await noMapa()
  confere('resultado restaurado sem a vontade volta solto', voltaR.status === 200 && txt.includes(rxId) && !txt.includes(vxId), voltaR)
  await op('excluir', { elemento: 'resultado', id: rxId })
  const some = await op('esvaziar_lixeira', { ids: [exV2.json?.resultado?.lixeira_id] })
  confere('excluir de vez só o escolhido', some.status === 200 && some.json?.resultado?.excluidos === 1, some)
  const tudo = await op('esvaziar_lixeira', {})
  const vazia = await op('ver_lixeira', {})
  confere('esvaziar a Lixeira inteira', tudo.status === 200 && (vazia.json?.resultado?.itens || []).length === 0, tudo)
  const exDeNovo = await op('excluir', { elemento: 'vontade', id: vxId })
  confere('excluir o que já não existe responde não encontrado', exDeNovo.status === 404, exDeNovo)
  const edV = await op('editar_vontade', { vontade_id: vontId, titulo: 'Voltar a tocar violão, sem pressa' })
  confere('editar vontade', edV.status === 200, edV)
  const capV = await op('capturar', { texto: 'Quero aprender a velejar' })
  const procV = await op('processar_captura', { captura_id: acharId(capV.json?.resultado), destino: 'vontade', dados: { contexto: 'vida' } })
  confere('captura vira vontade', procV.status === 200 && JSON.stringify(procV.json).includes('vontade_id'), procV)
  const arqV = await op('arquivar_vontade', { vontade_id: vontId })
  confere('arquivar vontade', arqV.status === 200, arqV)
  const mapa4 = await op('ver_mapa')
  confere('vontade arquivada sai do mapa', !(mapa4.json?.resultado?.vontades || []).some((v) => v.id === vontId), mapa4)
  const volV = await op('arquivar_vontade', { vontade_id: vontId, reativar: true })
  confere('reativar vontade', volV.status === 200, volV)
  const semana = await op('ver_resumo_semana', { dias: 7 })
  confere('ver resumo da semana', semana.status === 200, semana)
  const bal = semana.json?.resultado?.balanco || {}
  confere(
    'o balanço divide o tempo entre vontades, responsabilidades e livres',
    ['vontades', 'responsabilidades', 'livres'].every((k) => typeof bal[k] === 'number'),
    bal,
  )
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
  // Privacidade da IA: sem ler o aviso nada é enviado; desligada, também não.
  const pedido = { token: t, body: { tipo: 'resultado', texto: 'quero correr melhor' } }
  const semAviso = await http('POST', '/backend/v1/pegada/ia/sugerir', pedido)
  if (IA_ESPERADA === 'simulada') confere('IA não envia nada antes do aviso de privacidade', semAviso.status === 428, semAviso)
  await http('POST', '/backend/v1/pegada/ia/preferencia', { token: t, body: { aviso_visto: true, desligada: true } })
  const desligada = await http('POST', '/backend/v1/pegada/ia/sugerir', pedido)
  if (IA_ESPERADA === 'simulada') confere('IA desligada em Configurações recusa o pedido', desligada.status === 403, desligada)
  const pref = await http('POST', '/backend/v1/pegada/ia/preferencia', { token: t, body: { desligada: false } })
  confere('preferência da IA volta a ligada', pref.status === 200 && pref.json.desligada === false && pref.json.aviso_visto === true, pref)
  const ia = await http('POST', '/backend/v1/pegada/ia/sugerir', pedido)
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

  await contas({ t, suToken, donoId: login.json?.record?.id, login2 })

  console.log(`\n${total - falhas} de ${total} verificações passaram.`)
  process.exit(falhas ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
