#!/usr/bin/env node
// Teste de uso pelas telas, como uma pessoa usaria o Pegada num navegador.
// Percorre todas as telas: cria, edita, conclui, desfaz, descarta e confere que
// cada coisa aparece onde deve. Usa Playwright com o Chrome.
//
// Uso:
//   PEGADA_URL=https://... PEGADA_TESTE_EMAIL=... PEGADA_TESTE_SENHA=... node scripts/teste-telas.mjs
// Opcional: PEGADA_TESTE_TELA=celular (padrão) ou computador; PEGADA_TESTE_FOTOS=pasta
// Use sempre uma conta só de teste: o roteiro grava registros nela.
import { mkdirSync } from 'node:fs'

const BASE = (process.env.PEGADA_URL || 'http://127.0.0.1:8090').replace(/\/$/, '')
const EMAIL = process.env.PEGADA_TESTE_EMAIL
const SENHA = process.env.PEGADA_TESTE_SENHA
const TELA = process.env.PEGADA_TESTE_TELA || 'celular'
const FOTOS = process.env.PEGADA_TESTE_FOTOS || ''
const CHROME = process.env.PEGADA_TESTE_CHROME || undefined
if (!EMAIL || !SENHA) {
  console.error('Defina PEGADA_TESTE_EMAIL e PEGADA_TESTE_SENHA (conta só de teste).')
  process.exit(2)
}

let playwright
try {
  playwright = await import('playwright')
} catch {
  playwright = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright/index.mjs')
}
const { chromium } = playwright

const marca = Date.now().toString(36).slice(-5)
const T = (s) => `${s} ${marca}`
const nomes = {
  proposito: T('Eu existo para cuidar de quem amo, para que todos cresçam com calma.'),
  resp: T('Saúde da família'),
  resp2: T('Casa em ordem'),
  vontade: T('Voltar a tocar violão'),
  resultadoDaVontade: T('Tocar uma música inteira de cor'),
  resultado: T('Corrida de 10 km concluída'),
  estrategia: T('Treinar 3 vezes por semana'),
  acao: T('Correr 3 km no parque'),
  estudo: T('Estudar planilhas de treino'),
  captura: T('Comprar tênis de corrida'),
  captura2: T('Ideia solta para descartar'),
  direto: T('Comprar meias de corrida'),
}

let falhas = 0
let total = 0
const erros = []
function confere(nome, cond, detalhe) {
  total++
  if (cond) console.log('  ok    ' + nome)
  else {
    falhas++
    console.log('  FALHA ' + nome + (detalhe ? ' → ' + String(detalhe).slice(0, 300) : ''))
  }
}
async function passo(nome, fn) {
  try {
    await fn()
  } catch (err) {
    total++
    falhas++
    console.log('  FALHA ' + nome + ' → ' + String(err.message || err).split('\n')[0].slice(0, 300))
    if (FOTOS) await page.screenshot({ path: `${FOTOS}/falha-${total}.png`, fullPage: true }).catch(() => {})
  }
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const viewport = TELA === 'computador' ? { width: 1280, height: 900 } : { width: 390, height: 844 }
const page = await browser.newPage({ viewport, isMobile: TELA !== 'computador', hasTouch: TELA !== 'computador' })
page.setDefaultTimeout(15000)
page.on('pageerror', (e) => erros.push('erro na página: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()))
    erros.push('console: ' + m.text())
})
if (FOTOS) mkdirSync(FOTOS, { recursive: true })

const dialogo = () => page.locator('[role=dialog]').last()
const texto = async (sel = 'body') => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')
const ir = async (rota) => {
  await page.goto(BASE + rota)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(600)
}
const foto = async (nome) => {
  if (FOTOS) await page.screenshot({ path: `${FOTOS}/${nome}.png`, fullPage: true })
}
// Select do Radix: clica no gatilho e escolhe a opção pelo texto.
async function escolher(gatilho, opcao) {
  await gatilho.click()
  await page.getByRole('option', { name: opcao }).first().click()
  await page.waitForTimeout(200)
}
// Liga um interruptor (Switch) sem desligá-lo se já vier ligado.
async function ligar(sw) {
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
  await page.waitForTimeout(150)
}
// Novo avanço: o que não é uma das quatro decisões fica em "Mais detalhes".
async function maisDetalhes(d) {
  const b = d.getByRole('button', { name: /Mais detalhes/ }).first()
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click()
  await page.waitForTimeout(200)
}
// Novo avanço: marca "Hoje" sem desmarcar se já vier marcado.
async function paraHoje(d) {
  const b = d.getByRole('group', { name: 'Quando' }).getByRole('button', { name: 'Hoje', exact: true })
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
  await page.waitForTimeout(150)
}
const botao = (nome, raiz = page) => raiz.getByRole('button', { name: nome }).first()
const esperaSumir = async () => {
  await page.locator('[role=dialog]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
}

console.log(`Pegada: teste de uso pelas telas em ${BASE} (${TELA}), marca ${marca}`)

// 1. Entrar
await passo('entrar', async () => {
  await ir('/')
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', SENHA)
  await page.click('button[type=submit]')
  await page.getByRole('link', { name: 'Hoje' }).first().waitFor()
  confere('entrar com e-mail e senha', true)
})

// 2. Propósito
await passo('propósito', async () => {
  await ir('/mapa/proposito')
  await page.fill('#proposito', nomes.proposito)
  await botao('Salvar').click()
  await page.waitForTimeout(1200)
  await ir('/mapa')
  confere('propósito salvo aparece no Mapa', (await texto()).includes(nomes.proposito))
})

// Mapa: o campo "Adicionar" embaixo de cada item cria o filho do tipo certo.
const adicionarEm = async (raiz, em, { tipo, especie, prazo, texto: titulo, contexto }) => {
  const aberto = raiz.locator('form[data-adicionar-aberto]').filter({ has: page.getByLabel(new RegExp(` em ${em}$`)) })
  if (!(await aberto.count())) await raiz.getByRole('button', { name: `Adicionar em ${em}`, exact: true }).last().click()
  const form = raiz.locator('form[data-adicionar-aberto]').last()
  if (tipo) await form.getByRole('group', { name: 'O que adicionar' }).getByRole('button', { name: tipo, exact: true }).click()
  if (especie) await form.getByLabel('Tipo de avanço').selectOption({ label: especie })
  if (prazo) await form.getByLabel('Prazo do resultado').fill(prazo)
  if (contexto && (await form.getByRole('group', { name: 'Vida ou Trabalho' }).count()))
    await form.getByRole('group', { name: 'Vida ou Trabalho' }).getByRole('button', { name: contexto, exact: true }).click()
  await form.locator('input[type=text]').fill(titulo)
  await form.locator('input[type=text]').press('Enter')
  await raiz.getByText(titulo).first().waitFor()
  await page.waitForTimeout(400)
  return form
}
const arvore = () => page.locator('[data-mapa]')
const noDoMapa = (tipo, titulo) => arvore().locator(`[data-${tipo}]`).filter({ hasText: titulo }).last()
const ficha = () => page.locator('[data-ficha]')

// 3. Responsabilidades: nascem no ramo Responsabilidades do Mapa
await passo('responsabilidades', async () => {
  await ir('/mapa')
  const ramo = arvore().locator('[data-ramo="responsabilidades"]')
  for (const nome of [nomes.resp, nomes.resp2]) await adicionarEm(ramo, 'Responsabilidades', { texto: nome, contexto: 'vida' })
  const t = await texto('main')
  confere('criar duas responsabilidades sem sair do Mapa', t.includes(nomes.resp) && t.includes(nomes.resp2))
  await foto('mapa-responsabilidades')
})

// 3b. Vontade: nasce no ramo Vontades, ganha um resultado e pode ser arquivada
await passo('vontade', async () => {
  await ir('/mapa')
  await adicionarEm(arvore().locator('[data-ramo="vontades"]'), 'Vontades', { texto: nomes.vontade, contexto: 'vida' })
  confere('criar uma vontade sem sair do Mapa', (await noDoMapa('vontade', nomes.vontade).count()) === 1)
  await adicionarEm(noDoMapa('vontade', nomes.vontade), nomes.vontade, { prazo: '2027-06-30', texto: nomes.resultadoDaVontade })
  confere('criar resultado embaixo da vontade', (await noDoMapa('vontade', nomes.vontade).innerText()).includes(nomes.resultadoDaVontade))
  await noDoMapa('vontade', nomes.vontade).getByRole('link', { name: new RegExp(nomes.resultadoDaVontade) }).first().click()
  // O nome da vontade chega um instante depois da ficha: espera por ele.
  await ficha().locator('[data-zona="para-que"]').getByText(nomes.vontade).waitFor().catch(() => {})
  confere('ficha do resultado diz a vontade que ele realiza', (await ficha().locator('[data-zona="para-que"]').innerText()).includes(nomes.vontade))
  await botao('Concluir resultado', ficha()).click()
  await botao('Reativar', ficha()).waitFor()
  await ficha().locator('[data-zona="para-que"]').getByRole('link').first().click()
  await ficha().getByRole('heading', { name: nomes.vontade }).waitFor()
  confere('ficha da vontade lista o resultado dela', (await ficha().locator('[data-zona="como"]').innerText()).includes(nomes.resultadoDaVontade))
  await botao('Editar', ficha()).click()
  await dialogo().locator('#vontade-descricao').fill('Porque me faz bem.')
  await botao('Salvar', dialogo()).click()
  await esperaSumir()
  confere('editar a vontade', (await ficha().innerText()).includes('Porque me faz bem.'))
  await botao('Arquivar', ficha()).click()
  await botao('Reativar', ficha()).waitFor()
  confere('arquivar a vontade', true)
  await foto('ficha-vontade')
})

// 4. Resultado: nasce embaixo da responsabilidade que ele sustenta
await passo('resultado', async () => {
  await ir('/mapa')
  const form = await adicionarEm(noDoMapa('responsabilidade', nomes.resp), nomes.resp, { prazo: '2027-03-31', texto: nomes.resultado })
  confere('o campo do resultado já começa a frase', (await form.innerText()).includes('Até'))
  confere('criar resultado com prazo, embaixo da responsabilidade', (await noDoMapa('responsabilidade', nomes.resp).innerText()).includes(nomes.resultado))
})

let enderecoDoResultado = ''
const abrirResultado = async () => {
  if (enderecoDoResultado) await ir(enderecoDoResultado)
  else {
    await ir('/mapa')
    await arvore().getByRole('link', { name: new RegExp(nomes.resultado) }).first().click()
    await page.waitForURL(/\/mapa\/resultado\//)
    enderecoDoResultado = new URL(page.url()).pathname
  }
  await ficha().locator('[data-zona="item"]').waitFor()
  await page.waitForTimeout(500)
}

// 5. Ficha do resultado: três zonas, editar, estratégia, avanço, nota
await passo('editar resultado', async () => {
  await abrirResultado()
  const zonas = await ficha().locator('[data-zona]').evaluateAll((els) => els.map((e) => e.getAttribute('data-zona')).join(','))
  confere('a ficha tem três zonas: para quê, item e como', zonas === 'para-que,item,como', zonas)
  confere('a zona de cima diz a que o resultado serve', (await ficha().locator('[data-zona="para-que"]').innerText()).includes(nomes.resp))
  confere('a aba do navegador mostra o nome do item', (await page.title()) === `${nomes.resultado} · Pegada`, await page.title())
  await ficha().getByRole('button', { name: 'Editar', exact: true }).first().click()
  const d = dialogo()
  const prazo = await d.locator('input[id$=project-deadline]').inputValue()
  confere('ficha abre com o prazo gravado', prazo === '2027-03-31', prazo)
  await d.locator('input[id$=completion-condition]').fill('Termino a prova oficial em menos de 1 hora')
  await botao('Atualizar Resultado', d).click()
  await esperaSumir()
  confere('editar a ficha do resultado', (await texto('main')).includes('menos de 1 hora'))
})

await passo('estratégia', async () => {
  await abrirResultado()
  const form = await adicionarEm(ficha(), nomes.resultado, { tipo: 'Estratégia', texto: nomes.estrategia })
  confere('o campo da estratégia já começa a frase', (await form.innerText()).includes('Por meio de'))
  confere('criar estratégia na ficha do resultado', (await ficha().innerText()).includes(nomes.estrategia))
})

await passo('avanço embaixo da estratégia', async () => {
  await ir('/mapa')
  await adicionarEm(noDoMapa('estrategia', nomes.estrategia), nomes.estrategia, { especie: 'Estudo', texto: nomes.estudo })
  confere('criar Estudo embaixo da estratégia, no Mapa', (await noDoMapa('estrategia', nomes.estrategia).innerText()).includes(nomes.estudo))
  await arvore().getByRole('button', { name: `Fazer hoje: ${nomes.estudo}` }).click()
  await arvore().getByRole('button', { name: `Tirar de Hoje: ${nomes.estudo}` }).waitFor()
  confere('o ponto ao lado do avanço escolhe para hoje', true)
})

await passo('nota no resultado', async () => {
  await abrirResultado()
  await ficha().locator('summary', { hasText: 'Notas' }).click()
  await botao('Nova nota', ficha()).click()
  const d = dialogo()
  await d.locator('label', { hasText: 'Executei' }).first().click()
  await d.locator('#logText').fill(T('Corri 5 km sem parar'))
  await botao('Salvar registro', d).click()
  await esperaSumir()
  confere('guardar uma nota no resultado', (await texto('main')).includes(T('Corri 5 km sem parar')))
  await foto('ficha-resultado')
})

// 6. Hoje: o avanço nasce no Mapa, embaixo do resultado, e vai para hoje com um toque
await passo('novo avanço para hoje', async () => {
  await ir('/mapa')
  await adicionarEm(noDoMapa('resultado', nomes.resultado), nomes.resultado, { texto: nomes.acao })
  await arvore().getByRole('button', { name: `Fazer hoje: ${nomes.acao}` }).click()
  await arvore().getByRole('button', { name: `Tirar de Hoje: ${nomes.acao}` }).waitFor()
  await arvore().getByRole('link', { name: new RegExp(nomes.acao) }).first().click()
  await page.waitForURL(/\/mapa\/avanco\//)
  const fio = await ficha().locator('[data-zona="para-que"]').innerText()
  confere('a ficha do avanço mostra o fio em cima', fio.toLowerCase().includes(nomes.resultado.toLowerCase()), fio)
  const trilha = await ficha().locator('[data-trilha] a').count()
  confere('a trilha do avanço leva de volta ao degrau de cima', trilha >= 1)
  await ir('/')
  const t = await texto('main')
  confere('avanço criado aparece em Hoje', t.includes(nomes.acao), t.slice(0, 200))
  confere('o Estudo escolhido para hoje também aparece', t.includes(nomes.estudo))
  confere('Hoje mostra o porquê (o resultado) do avanço', t.includes(nomes.resultado))
  await foto('hoje')
})

// 6a. Mapa em árvore horizontal: só no computador, com os mesmos dados da lista
await passo('Mapa em árvore horizontal', async () => {
  await ir('/mapa')
  const troca = page.locator('[data-vista-do-mapa]')
  if (TELA !== 'computador') {
    confere('no celular o Mapa não oferece a árvore horizontal', (await troca.count()) === 0)
    return
  }
  await troca.getByRole('button', { name: 'Árvore' }).click()
  const arvoreH = page.locator('[data-arvore-horizontal]')
  await arvoreH.locator('[data-no="raiz"]').waitFor()
  confere('a árvore horizontal sai do Propósito e chega ao resultado', (await arvoreH.innerText()).includes(nomes.resultado))
  await troca.getByRole('button', { name: 'Lista' }).click()
  await arvore().locator('[data-ramo="vontades"]').waitFor()
  confere('a vista em lista volta com um toque', (await arvoreH.count()) === 0)
})

// 6b. Hoje em três passos: folha de escolha, três ações por linha e fechar o dia
await passo('Hoje: escolher, linha e fechar o dia', async () => {
  await ir('/')
  const tambem = page.locator('section[aria-label="Também hoje"]')
  await botao('Adicionar', tambem).click()
  const folha = page.locator('[data-folha-de-escolha]')
  await folha.getByRole('button', { name: `Tirar de Hoje: ${nomes.acao}` }).or(folha.getByText('Nenhum avanço aberto')).first().waitFor()
  const naFolha = await folha.locator('ul button').count()
  confere('a folha de escolha lista os avanços abertos, por resultado', naFolha >= 1 && (await folha.innerText()).toLowerCase().includes(nomes.resultado.toLowerCase()), await folha.innerText())
  confere('a folha de escolha conta os escolhidos', /escolhido/.test(await folha.locator('[data-escolhidos]').innerText()))
  await botao('Pronto', folha).click()
  await esperaSumir()
  const linha = tambem.locator('[data-linha-de-hoje]').first()
  await linha.getByRole('button', { name: /^Opções: / }).click()
  const acoes = await linha.locator('[data-acoes-da-linha]').innerText()
  confere('a linha aberta mostra três ações', /Deixar para depois/.test(acoes) && /Estou esperando alguém/.test(acoes) && /Abrir/.test(acoes), acoes)
  await linha.getByRole('button', { name: /^Opções: / }).click()
  await botao('Fechar o dia').click()
  const fechar = page.locator('[data-fechar-o-dia]')
  await fechar.locator('[data-sobra]').first().waitFor()
  const sobra = await fechar.locator('[data-sobra]').first().innerText()
  confere('fechar o dia pergunta: amanhã ou devolver ao Mapa', /Amanhã/.test(sobra) && /Devolver ao Mapa/.test(sobra), sobra)
  await foto('fechar-o-dia')
  await botao('Deixar como está', fechar).click()
  await esperaSumir()
  confere('Hoje não tem mais a seção Reavaliar', (await page.locator('#reavaliar').count()) === 0)
  await ir('/revisao')
  await page.locator('[data-o-que-reavaliar]').waitFor()
  confere('"O que reavaliar" mora na Revisão', true)
})

// Caixa: um item por vez. Traz a captura para a frente e devolve o cartão da vez.
const daVez = () => page.locator('[data-captura-da-vez]')
async function trazerParaAVez(nome) {
  await page.locator('[data-caixa]').waitFor()
  await page.waitForTimeout(600)
  const todas = page.locator('[data-fila-da-caixa]').getByRole('button', { name: 'Mostrar todas' })
  if (await todas.count()) await todas.click()
  const naFila = page.locator('[data-fila-da-caixa] button').filter({ hasText: nome })
  if (await naFila.count()) await naFila.first().click()
  await daVez().locator('div').first().getByText(nome).first().waitFor()
  return daVez().locator('div').first()
}
async function pendenteNaCaixa(nome) {
  await page.locator('[data-caixa]').waitFor()
  await page.waitForTimeout(800)
  return (await daVez().count()) > 0 && (await daVez().innerText()).includes(nome)
}
async function capturarNaCaixa(textoDaCaptura) {
  const caixa = page.locator('section[aria-label="Capturar"]')
  await caixa.locator('textarea').fill(textoDaCaptura)
  await botao('Capturar', caixa).click()
  await page.waitForTimeout(1200)
}

// 7. Capturas: capturar, transformar em avanço, descartar
await passo('capturar pelo botão do topo', async () => {
  await ir('/')
  await botao(/^Capturar/).click()
  await dialogo().locator('textarea').fill(nomes.captura)
  await dialogo().getByRole('button', { name: 'Capturar', exact: true }).click()
  await esperaSumir()
  await ir('/caixa')
  confere('captura do topo aparece em Capturas', (await texto('main')).includes(nomes.captura))
})

// 7a. Avanço direto: quem já sabe o que é cria sem passar pela Caixa
await passo('avanço direto pelo botão de capturar', async () => {
  await ir('/')
  await botao(/^Capturar/).click()
  await dialogo().locator('[data-trocar-modo]').click()
  await dialogo().locator('textarea').fill(nomes.direto)
  const opcoes = dialogo().locator('[data-avanco-direto]')
  await opcoes.getByRole('radio', { name: new RegExp(nomes.estrategia) }).first().click()
  await dialogo().getByRole('button', { name: 'Criar avanço', exact: true }).click()
  await esperaSumir()
  await ir('/mapa')
  const est = arvore().locator('[data-estrategia]').filter({ hasText: nomes.estrategia }).first()
  confere('avanço direto nasce embaixo da estratégia escolhida, sem passar pela Caixa', (await est.innerText()).includes(nomes.direto), await est.innerText())
  await ir('/caixa')
  confere('avanço direto não deixa captura na Caixa', !(await texto('main')).includes(nomes.direto))
})

await passo('capturar na tela de Capturas', async () => {
  await ir('/caixa')
  await capturarNaCaixa(nomes.captura2)
  confere('a Caixa mostra uma captura por vez, com as outras em "Depois"', (await daVez().locator('[data-fila-da-caixa] button').count()) >= 1)
  confere('captura da caixa de entrada aparece', (await texto('main')).includes(nomes.captura2))
  await foto('capturas')
})

// Hoje: o avanço está no cartão principal ou na lista "Também hoje".
async function concluirEmHoje(titulo) {
  await ir('/')
  const naLista = page.getByRole('button', { name: `Concluir: ${titulo}` })
  if (await naLista.count()) await naLista.first().click()
  else {
    const principal = page.locator('section[aria-label="Avanço principal"]')
    if (!(await principal.innerText()).includes(titulo)) throw new Error('avanço não está em Hoje: ' + titulo)
    await principal.getByRole('button', { name: 'Concluir', exact: true }).click()
  }
  await page.waitForTimeout(1500)
}
const item = (nome) => page.getByRole('menuitem', { name: nome }).first()

// 8. Processar capturas: uma vira avanço, a outra é descartada e depois volta
await passo('processar captura em avanço', async () => {
  await ir('/caixa')
  const linha = await trazerParaAVez(nomes.captura)
  await botao('Decidir', linha).click()
  await item(/^Ação$/).click()
  await page.waitForTimeout(1500)
  await ir('/mapa')
  confere('captura processada vira avanço livre, no Mapa', (await arvore().locator('[data-ramo="livres"]').innerText()).includes(nomes.captura))
  await ir('/caixa')
  const decididas = page.locator('[data-ja-decididas]')
  await decididas.getByRole('button', { name: /Já decididas/ }).click()
  await page.waitForTimeout(800)
  const lista = await decididas.innerText()
  confere('"Já decididas" mostra o que virou avanço e segue aberto', lista.includes(nomes.captura), lista.slice(0, 200))
  confere('"Já decididas" não mostra descartadas nem concluídas', !/Descartada/.test(lista))
})

await passo('descartar captura', async () => {
  await ir('/caixa')
  const linha = await trazerParaAVez(nomes.captura2)
  await botao('Decidir', linha).click()
  await item('Descartar').click()
  await page.waitForTimeout(1500)
  await ir('/caixa')
  confere('captura descartada sai das pendentes', !(await pendenteNaCaixa(nomes.captura2)))
})

// 9. Atividade: o histórico mostra o que foi feito e desfaz o último passo
await passo('atividade e desfazer', async () => {
  await ir('/historico')
  const t = await texto('main')
  confere('Atividade registra o que foi feito', /captura/i.test(t), t.slice(0, 200))
  await botao('Desfazer', page.locator('main')).click()
  await page.waitForTimeout(1500)
  await ir('/caixa')
  confere('Desfazer devolve a captura descartada', await pendenteNaCaixa(nomes.captura2))
})

// 10. Concluir avanços: a Ação direto, o Estudo deixando rastro
await passo('concluir a Ação em Hoje', async () => {
  await concluirEmHoje(nomes.acao)
  if (await page.locator('[role=dialog]').count()) {
    await dialogo().locator('textarea').fill(T('Corri no parque'))
    await botao('Concluir', dialogo()).click()
    await esperaSumir()
  }
  await ir('/mapa')
  const aberta = await arvore().getByRole('button', { name: `Concluir: ${nomes.acao}` }).count()
  await abrirResultado()
  confere('Ação concluída sai dos abertos e fica guardada na ficha do resultado', aberta === 0 && (await ficha().innerText()).includes(nomes.acao))
})

await passo('concluir o Estudo com rastro', async () => {
  await concluirEmHoje(nomes.estudo)
  await dialogo().locator('textarea').fill(T('Aprendi a montar a planilha'))
  await botao('Concluir', dialogo()).click()
  await esperaSumir()
  await ir('/mapa')
  const aberto = await arvore().getByRole('button', { name: `Concluir: ${nomes.estudo}` }).count()
  confere('Estudo só conclui deixando rastro, e sai dos abertos', aberto === 0)
})

// 10b. Método: a conclusão do Estudo vira nota no resultado; anexos leves; a escada
await passo('material de referência e escada', async () => {
  await abrirResultado()
  const refs = page.locator('[data-referencias="resultado"]')
  await refs.getByText(/Conclusão do estudo/).first().waitFor()
  confere('a conclusão do Estudo vira nota presa ao resultado', (await refs.innerText()).includes(T('Aprendi a montar a planilha')))
  await botao('Anexar', refs).click()
  await refs.getByRole('button', { name: 'Link', exact: true }).click()
  await refs.getByLabel('Título do anexo').fill(T('Planilha de treino'))
  await refs.getByLabel('Endereço do anexo').fill('exemplo.com/planilha')
  await botao('Guardar anexo', refs).click()
  await refs.getByText(T('Planilha de treino')).waitFor()
  confere('anexar um link ao resultado', (await refs.innerText()).includes('https://exemplo.com/planilha'))
  await ficha().locator('[data-zona="para-que"] a').click()
  await page.waitForURL(/\/mapa\/responsabilidade\//)
  await ficha().locator('[data-zona="item"]').getByText(nomes.resp).first().waitFor()
  confere('o "para quê" sobe do resultado para a responsabilidade', (await ficha().locator('[data-zona="item"]').innerText()).includes(nomes.resp))
})

// 10c. Método: guia do propósito
await passo('guia do propósito', async () => {
  await ir('/mapa/proposito')
  const guia = page.locator('[data-guia-proposito]')
  await guia.getByRole('button', { name: /Guia do propósito/ }).click()
  confere('guia do propósito traz as quatro perguntas', (await guia.locator('textarea').count()) === 5)
  await guia.locator('#guia-frase').fill(nomes.proposito)
  await botao('Usar esta frase', guia).click()
  confere('a frase do guia vai para o campo do propósito', (await page.locator('#proposito').inputValue()) === nomes.proposito)
})

// 10d. Navegação: toda tela acende um destino do menu, a aba diz onde se está,
// os endereços antigos levam ao lugar novo e a busca acha itens de qualquer tela.
await passo('navegação: onde estou', async () => {
  const aceso = async () =>
    (await page.locator('nav[aria-label="Principal"] [aria-current="page"]').allInnerTexts())
      .map((t) => t.replace(/[\d\s,]+para decidir/, '').trim().split('\n')[0])
      .filter(Boolean)[0]
  for (const [rota, destino, titulo] of [
    ['/', 'Hoje', 'Hoje'],
    ['/mapa', 'Mapa', 'Mapa'],
    ['/mapa/proposito', 'Mapa', 'Propósito'],
    ['/caixa', 'Caixa', 'Caixa'],
    ['/revisao', 'Revisão', 'Revisão'],
  ]) {
    await ir(rota)
    confere(`${rota} acende ${destino} no menu`, String(await aceso()).startsWith(destino), String(await aceso()))
    confere(`${rota} põe "${titulo}" na aba`, (await page.title()) === `${titulo} · Pegada`, await page.title())
  }
  await abrirResultado()
  confere('a ficha de um item acende Mapa no menu', String(await aceso()).startsWith('Mapa'), String(await aceso()))
  for (const antigo of ['/resultados', '/responsabilidades', '/avancos']) {
    await ir(antigo)
    confere(`o catálogo antigo ${antigo} leva ao Mapa`, new URL(page.url()).pathname === '/mapa', page.url())
  }
  await ir('/resultados?id=' + enderecoDoResultado.split('/').pop())
  confere('um link antigo de resultado abre a ficha dele', new URL(page.url()).pathname === enderecoDoResultado, page.url())
  await ir('/capturas')
  confere('o endereço antigo /capturas leva à Caixa', new URL(page.url()).pathname === '/caixa', page.url())
  await ir('/atividade')
  confere('o endereço antigo /atividade leva ao Histórico', new URL(page.url()).pathname === '/historico', page.url())
})

await passo('busca global', async () => {
  await ir('/')
  await page.getByRole('button', { name: 'Buscar em tudo' }).first().click()
  const busca = dialogo()
  await busca.locator('input').fill(nomes.resultado)
  const achado = busca.getByRole('group', { name: 'Resultados' }).getByRole('option').filter({ hasText: nomes.resultado }).first()
  await achado.waitFor()
  confere('a busca acha o resultado pelo nome, a partir de Hoje', true)
  await achado.click()
  await page.waitForURL(/\/mapa\/resultado\//)
  confere('escolher na busca abre a ficha do resultado', true)
  const trilha = page.locator('[data-trilha]')
  await trilha.waitFor()
  confere('a ficha mostra a trilha do fio, com o Mapa acima', (await trilha.innerText()).includes('Mapa') || (await trilha.locator('a').count()) > 0)
})

// 11. Ficha do avanço: editar e cancelar o avanço livre que veio da captura
await passo('editar e cancelar avanço', async () => {
  await ir('/mapa')
  await arvore().locator('[data-ramo="livres"]').getByRole('link', { name: new RegExp(nomes.captura) }).first().click()
  await page.waitForURL(/\/mapa\/avanco\//)
  confere('avanço livre diz que é livre, sem tom de erro', /Avanço livre/.test(await ficha().locator('[data-zona="para-que"]').innerText()))
  await ficha().getByRole('button', { name: 'Mais comandos do avanço' }).click()
  await item(/Editar/).click()
  const d = dialogo()
  await d.locator('input[id$=action-title]').fill(nomes.captura + ' (editado)')
  await botao(/Atualizar|Salvar/, d).click()
  await esperaSumir()
  confere('editar o título de um avanço', (await ficha().innerText()).includes(nomes.captura + ' (editado)'))
  await ficha().getByRole('button', { name: 'Mais comandos do avanço' }).click()
  await item('Cancelar avanço').click()
  await page.waitForTimeout(1500)
  confere('cancelar um avanço', /Cancelad/i.test(await ficha().innerText()))
})

// 12. Resultado: pausar e reativar
await passo('pausar e reativar resultado', async () => {
  await abrirResultado()
  await botao('Pausar').click()
  await botao('Ativar').waitFor()
  confere('pausar o resultado', true)
  await botao('Ativar').click()
  await botao('Pausar').waitFor()
  confere('reativar o resultado', true)
})

// 13. Responsabilidade: arquivar e reativar
await passo('arquivar e reativar responsabilidade', async () => {
  await ir('/mapa')
  await arvore().getByRole('link', { name: new RegExp(nomes.resp2) }).first().click()
  await page.waitForURL(/\/mapa\/responsabilidade\//)
  await botao('Arquivar', ficha()).click()
  await botao('Arquivar', dialogo()).click()
  await botao('Reativar').waitFor()
  confere('arquivar a responsabilidade', true)
  await ir('/mapa')
  await arvore().getByRole('button', { name: 'Encerrados' }).click()
  await arvore().locator('[data-ramo="encerrados"]').getByText(nomes.resp2).waitFor()
  confere('o que foi arquivado fica guardado em Encerrados, no Mapa', true)
  await arvore().locator('[data-ramo="encerrados"]').getByRole('link', { name: new RegExp(nomes.resp2) }).click()
  await botao('Reativar', ficha()).click()
  await botao('Arquivar', ficha()).waitFor()
  confere('reativar a responsabilidade', true)
})

// 14. Mapa e Revisão
await passo('mapa e revisão', async () => {
  await ir('/mapa')
  const m = await arvore().innerText()
  confere('Mapa tem os três ramos sob o Propósito', /Vontades/i.test(m) && /Responsabilidades/i.test(m) && /Livres/i.test(m), m.slice(0, 200))
  const no = noDoMapa('responsabilidade', nomes.resp)
  const dentro = await no.innerText()
  confere('Mapa mostra a escada inteira: responsabilidade, resultado e estratégia', dentro.includes(nomes.resultado) && dentro.includes(nomes.estrategia), dentro.slice(0, 200))
  const fecha = no.getByRole('button', { name: `Recolher ${nomes.resp}`, exact: true })
  await fecha.click()
  confere('recolher um degrau esconde o que está embaixo dele', !(await no.innerText()).includes(nomes.resultado))
  await ir('/mapa')
  confere('o Mapa lembra o que ficou recolhido', !(await noDoMapa('responsabilidade', nomes.resp).innerText()).includes(nomes.resultado))
  await noDoMapa('responsabilidade', nomes.resp).getByRole('button', { name: `Abrir ${nomes.resp}`, exact: true }).click()
  if (TELA === 'computador') {
    await arvore().getByRole('link', { name: new RegExp(nomes.resultado) }).first().click()
    await ficha().locator('[data-zona="item"]').waitFor()
    confere('no computador, a ficha abre ao lado e o Mapa continua à vista', await arvore().isVisible())
  }
  await foto('mapa')
  await ir('/revisao')
  confere('Revisão abre', /Revis/i.test(await texto('main')))
  await foto('revisao')
})

// 14b. Revisão guiada: tela focada, um resultado por vez, decisão com Desfazer
await passo('revisão guiada', async () => {
  await ir('/revisao')
  await botao('Começar a revisão').click()
  const guia = page.locator('[data-revisao]')
  await guia.locator('[data-passo="O que andou"]').waitFor()
  const caixa = await guia.boundingBox()
  confere('Revisão guiada: tela focada, cobre o menu do aplicativo', caixa && caixa.width >= viewport.width - 1 && caixa.height >= viewport.height - 1, JSON.stringify(caixa))
  const espelho = await guia.innerText()
  confere('Revisão guiada: mostra o que foi concluído', espelho.includes(nomes.acao) && espelho.includes(nomes.resultado), espelho.slice(0, 200))
  await guia.getByRole('button', { name: 'Continuar', exact: true }).click()
  await guia.locator('[data-passo="Resultados"]').waitFor()
  let achou = false
  for (let n = 0; n < 10 && !achou; n++) {
    achou = (await guia.innerText()).includes(nomes.resultado)
    if (!achou) await guia.getByRole('button', { name: 'Próximo resultado', exact: true }).click()
    await page.waitForTimeout(300)
  }
  const cartaoResultado = await guia.innerText()
  confere('Revisão guiada: um resultado por vez, com a aposta atual', achou && cartaoResultado.includes(nomes.estrategia), cartaoResultado.slice(0, 200))
  await guia.getByRole('button', { name: 'Este resultado não vale mais' }).click()
  await guia.getByRole('button', { name: /^(Próximo resultado|Continuar)$/ }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Desfazer' }).first().click()
  await page.waitForTimeout(1500)
  for (let n = 0; n < 10; n++) {
    const b = guia.getByRole('button', { name: /^(Próximo resultado|Continuar)$/ })
    if (await guia.locator('[data-passo="Fechamento"]').count()) break
    await b.click()
    await page.waitForTimeout(300)
  }
  confere('Revisão guiada: fecha na caixa de entrada', /captura/i.test(await guia.innerText()))
  await foto('revisao-guiada')
  await guia.getByRole('button', { name: 'Concluir revisão', exact: true }).click()
  await page.waitForTimeout(600)
  confere('Revisão guiada: concluir volta para o aplicativo', (await page.locator('[data-revisao]').count()) === 0)
  await abrirResultado()
  confere('Revisão guiada: Desfazer mantém o resultado ativo', (await botao('Pausar').count()) === 1)
})

// 14b2. Revisões trimestral e anual têm roteiro próprio
await passo('revisões trimestral e anual', async () => {
  await ir('/revisao')
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Trimestral' }).click()
  await botao('Começar a revisão').click()
  const guia = page.locator('[data-revisao]')
  await guia.locator('[data-passo="Resultados"]').waitFor()
  const tri = await guia.innerText()
  confere('Revisão trimestral começa pelo destino de cada resultado', /Alcancei, sigo ou abandono\?/.test(tri) && tri.includes('Volta para a lista de futuros'), tri.slice(0, 200))
  await guia.getByRole('button', { name: 'Sair da revisão e continuar depois' }).click()
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Anual' }).click()
  await botao('Começar a revisão').click()
  await guia.locator('[data-passo="Propósito"]').waitFor()
  const ano = await guia.innerText()
  confere('Revisão anual começa relendo o propósito e os dois testes', ano.includes(nomes.proposito) && /Teste do único/.test(ano), ano.slice(0, 200))
  await guia.getByRole('button', { name: 'Continuar', exact: true }).click()
  await guia.locator('[data-passo="Responsabilidades"]').waitFor()
  confere('Revisão anual revisa as responsabilidades', (await guia.innerText()).includes(nomes.resp))
  await guia.getByRole('button', { name: 'Sair da revisão e continuar depois' }).click()
})

// 14c. IA embutida nas telas (só quando o servidor tem a chave): sugere, a pessoa decide
if (process.env.PEGADA_TESTE_IA) {
  // Privacidade: desligada, a IA não responde; ligada, pede o aviso na primeira vez.
  const aceitarAviso = async () => {
    const aviso = page.locator('[data-aviso-ia]')
    await aviso.waitFor({ timeout: 4000 }).catch(() => {})
    if (await aviso.count()) {
      await botao('Entendi, usar a IA', aviso).click()
      await page.waitForTimeout(500)
      return true
    }
    return false
  }
  // O formulário completo do avanço abre pela ficha dele.
  const avancoDaIA = T('Avanço para a IA reescrever')
  const abrirEdicaoDeUmAvanco = async () => {
    await ir('/mapa')
    const livres = arvore().locator('[data-ramo="livres"]')
    if (!(await livres.getByText(avancoDaIA).count())) await adicionarEm(livres, 'Livres', { texto: avancoDaIA, contexto: 'vida' })
    await livres.getByRole('link', { name: new RegExp(avancoDaIA) }).first().click()
    await page.waitForURL(/\/mapa\/avanco\//)
    await ficha().getByRole('button', { name: 'Mais comandos do avanço' }).click()
    await item(/Editar/).click()
    await dialogo().locator('input[id$=action-title]').waitFor()
  }
  await passo('privacidade da IA', async () => {
    await ir('/configuracoes')
    const chave = page.locator('#ia-ligada')
    await chave.waitFor()
    if ((await chave.getAttribute('aria-checked')) === 'true') await chave.click()
    await page.waitForTimeout(800)
    await abrirEdicaoDeUmAvanco()
    await dialogo().locator('input[id$=action-title]').fill('texto qualquer para a IA')
    await botao('Sugerir com IA', dialogo()).click()
    await dialogo().getByText('A IA está desligada em Configurações.').waitFor()
    confere('IA desligada em Configurações não envia nada', true)
    await page.keyboard.press('Escape')
    await esperaSumir()
    await ir('/configuracoes')
    await chave.click()
    await page.waitForTimeout(800)
    confere('a chave liga a IA de novo', (await chave.getAttribute('aria-checked')) === 'true')
  })
  await passo('IA em Capturas', async () => {
    const ideia = T('ver uns tênis de corrida qualquer dia')
    await ir('/caixa')
    await capturarNaCaixa(ideia)
    const linha = await trazerParaAVez(ideia)
    await botao('Sugerir com IA', linha).click()
    await aceitarAviso()
    await botao('Dispensar', linha).waitFor({ timeout: 45000 })
    confere('IA sugere o destino de uma captura', true)
    if (await botao('Usar sugestão', linha).count()) {
      await botao('Usar sugestão', linha).click()
      await page.waitForTimeout(2000)
      confere('usar a sugestão processa a captura', !(await pendenteNaCaixa(ideia)))
    }
  })
  await passo('IA na captura rápida', async () => {
    await ir('/')
    await botao(/^Capturar/).click()
    const d = dialogo()
    await d.locator('textarea').fill(T('ligar para a academia e perguntar o horário'))
    await d.locator('[data-sugestao]').waitFor({ timeout: 45000 })
    confere('captura rápida: o Pegada sugere o destino', /Sugestão do Pegada/i.test(await d.innerText()))
    await botao('Decidir depois', d).click()
    await page.waitForTimeout(400)
    confere('captura rápida: "Decidir depois" dispensa a sugestão', (await d.locator('[data-sugestao]').count()) === 0)
    await page.keyboard.press('Escape')
    await esperaSumir()
  })
  await passo('desdobrar com IA', async () => {
    await abrirResultado()
    await botao('Desdobrar em estratégias').click()
    const caixa = page.locator('div[data-desdobrar="resultado"]')
    await caixa.locator('li button').first().waitFor({ timeout: 45000 })
    const sugestao = (await caixa.locator('li button').first().innerText()).split('\n')[0].trim()
    confere('desdobrar: a IA sugere estratégias com o motivo', (await caixa.locator('li button').count()) >= 2, sugestao)
    await caixa.locator('li button').first().click()
    await botao('Criar a escolhida', caixa).click()
    await page.waitForTimeout(2000)
    confere('desdobrar: a sugestão escolhida vira estratégia', (await texto('main')).includes(sugestao), sugestao)
  })
  await passo('correção gentil', async () => {
    await ir('/mapa')
    const ramo = arvore().locator('[data-ramo="livres"]')
    if (!(await ramo.locator('form[data-adicionar-aberto]').count()))
      await ramo.getByRole('button', { name: 'Adicionar em Livres', exact: true }).click()
    const form = ramo.locator('form[data-adicionar-aberto]')
    await form.getByRole('group', { name: 'O que adicionar' }).getByRole('button', { name: 'Resultado', exact: true }).click()
    await form.locator('input[type=text]').fill('Ser um bom pai para as minhas filhas')
    await form.locator('[data-correcao]').waitFor({ timeout: 45000 }).catch(() => {})
    const n = await form.locator('[data-correcao]').count()
    confere('correção gentil: o Pegada avisa quando o resultado não tem linha de chegada', n === 1)
    if (n) await botao('Dispensar', form).click()
    await botao('Fechar', form).click()
  })
  await passo('IA no Novo Avanço', async () => {
    await abrirEdicaoDeUmAvanco()
    const d = dialogo()
    await d.locator('input[id$=action-title]').fill('planilha de treino, olhar')
    await botao('Sugerir com IA', d).click()
    await botao('Usar sugestão', d).click({ timeout: 45000 })
    const titulo = await d.locator('input[id$=action-title]').inputValue()
    confere('IA reescreve o título do avanço e a pessoa decide', titulo.length > 3 && titulo !== 'planilha de treino, olhar', titulo)
    await page.keyboard.press('Escape')
    await esperaSumir()
  })
}

// 14b. Excluir manda para a Lixeira; de lá, restaura ou apaga de vez
await passo('excluir e Lixeira', async () => {
  const vontadeX = T('Vontade para excluir')
  const resultadoX = T('Resultado que vai junto')
  await ir('/mapa')
  await adicionarEm(arvore().locator('[data-ramo="vontades"]'), 'Vontades', { texto: vontadeX, contexto: 'vida' })
  await adicionarEm(noDoMapa('vontade', vontadeX), vontadeX, { prazo: '2027-08-31', texto: resultadoX })
  await noDoMapa('vontade', vontadeX).getByRole('link', { name: new RegExp(vontadeX) }).first().click()
  await ficha().getByRole('heading', { name: vontadeX }).waitFor()
  const nomesDaTriade = await ficha().locator('[data-zona="item"] [data-triade] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
  confere('a ficha tem a tríade de ícones: editar, arquivar e excluir', nomesDaTriade.join(',') === 'Editar,Arquivar,Excluir', nomesDaTriade.join(','))
  await ficha().locator('[data-zona="item"]').getByRole('button', { name: 'Excluir', exact: true }).click()
  const aviso = page.locator('[data-confirmar-exclusao]')
  await aviso.locator('[data-vai-junto]').waitFor()
  confere('antes de excluir, o Pegada diz o que vai junto', /1 resultado/.test(await aviso.innerText()), await aviso.innerText())
  await botao('Mandar para a Lixeira', aviso).click()
  await page.waitForURL(/\/mapa$/)
  await page.waitForTimeout(800)
  confere('o excluído some do Mapa', !(await arvore().innerText()).includes(vontadeX))
  await ir('/lixeira')
  const lixeira = page.locator('[data-lixeira]')
  const item = lixeira.locator('[data-item-da-lixeira]').filter({ hasText: vontadeX })
  confere('a Lixeira guarda o excluído e diz o que foi junto', /com 1 resultado/.test(await item.innerText()), await lixeira.innerText())
  await item.getByRole('button', { name: new RegExp('^Restaurar') }).click()
  await item.waitFor({ state: 'detached' })
  await ir('/mapa')
  const voltou = await noDoMapa('vontade', vontadeX).innerText()
  confere('restaurar devolve o item com o que estava embaixo', voltou.includes(vontadeX) && voltou.includes(resultadoX), voltou.slice(0, 200))
  await noDoMapa('vontade', vontadeX).getByRole('link', { name: new RegExp(vontadeX) }).first().click()
  await ficha().locator('[data-zona="item"]').getByRole('button', { name: 'Excluir', exact: true }).click()
  await aviso.locator('[data-vai-junto]').waitFor()
  await botao('Mandar para a Lixeira', aviso).click()
  await page.waitForURL(/\/mapa$/)
  await ir('/lixeira')
  await item.getByRole('checkbox').check()
  await botao('Excluir de vez os marcados', lixeira).click()
  await botao('Excluir de vez', dialogo()).click()
  await item.waitFor({ state: 'detached' })
  confere('excluir de vez só o que foi marcado', true)
  await foto('lixeira')
})

// 15. Nenhuma tela pode ficar mais larga que o aparelho
await passo('largura das telas', async () => {
  const largas = []
  for (const rota of ['/', '/caixa', '/mapa', '/mapa/proposito', enderecoDoResultado || '/mapa', '/historico', '/lixeira', '/revisao', '/configuracoes']) {
    await ir(rota)
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (sw > cw + 1) largas.push(`${rota} (${sw} em ${cw})`)
  }
  confere('nenhuma tela passa da largura do aparelho', largas.length === 0, largas.join(', '))
})

// 16. Fechar o fio: concluir o resultado, para a conta de teste não acumular ativos
await passo('concluir o resultado', async () => {
  await abrirResultado()
  await botao('Concluir resultado', ficha()).click()
  await botao('Reativar', ficha()).waitFor()
  await ir('/mapa')
  await arvore().getByRole('button', { name: 'Encerrados' }).click().catch(() => {})
  const guardado = arvore().locator('[data-ramo="encerrados"]').getByText(nomes.resultado)
  if (!(await guardado.count())) await arvore().getByRole('button', { name: 'Encerrados' }).click()
  await guardado.first().waitFor()
  confere('resultado concluído sai da escada e fica em Encerrados', true)
})

console.log(`\n${total - falhas} de ${total} verificações passaram.`)
if (erros.length) {
  console.log('\nErros de JavaScript nas telas:')
  for (const e of [...new Set(erros)].slice(0, 20)) console.log('  ' + e.slice(0, 300))
}
await browser.close()
process.exit(falhas || erros.length ? 1 : 0)
