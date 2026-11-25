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
  resultado: T('Corrida de 10 km concluída'),
  estrategia: T('Treinar 3 vezes por semana'),
  acao: T('Correr 3 km no parque'),
  estudo: T('Estudar planilhas de treino'),
  captura: T('Comprar tênis de corrida'),
  captura2: T('Ideia solta para descartar'),
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
  await ir('/configuracoes')
  await page.fill('#life-purpose', nomes.proposito)
  await botao('Salvar propósito').click()
  await page.waitForTimeout(1200)
  await ir('/mapa')
  confere('propósito salvo aparece no Mapa', (await texto()).includes(nomes.proposito))
})

// 3. Responsabilidades
await passo('responsabilidades', async () => {
  for (const [nome, contexto] of [
    [nomes.resp, 'Vida'],
    [nomes.resp2, 'Vida'],
  ]) {
    await ir('/responsabilidades')
    await botao('Nova responsabilidade').click()
    await dialogo().locator('input').first().fill(nome)
    await dialogo().locator('button', { hasText: new RegExp(`^\\s*${contexto}\\s*$`) }).first().click()
    await botao('Criar responsabilidade', dialogo()).click()
    await esperaSumir()
  }
  const t = await texto('main')
  confere('criar duas responsabilidades', t.includes(nomes.resp) && t.includes(nomes.resp2))
  await foto('responsabilidades')
})

// 4. Resultado
await passo('resultado', async () => {
  await ir('/resultados')
  await botao('Novo resultado').click()
  const d = dialogo()
  await d.locator('input[id$=project-title]').fill(nomes.resultado)
  await escolher(d.locator('[id$=project-status]'), 'Ativo')
  await escolher(d.locator('[id$=project-responsibility]'), nomes.resp)
  await d.locator('input[id$=project-deadline]').fill('2027-03-31')
  await d.locator('input[id$=completion-condition]').fill('Termino a prova oficial')
  await botao('Criar Resultado', d).click()
  await esperaSumir()
  confere('criar resultado ativo com prazo e responsabilidade', (await texto('main')).includes(nomes.resultado))
})

const abrirResultado = async () => {
  await ir('/resultados')
  await page.getByText(nomes.resultado).first().click()
  await botao('Nova estratégia').waitFor()
}

// 5. Ficha do resultado: editar, estratégia, avanço, registro de progresso
await passo('editar resultado', async () => {
  await abrirResultado()
  await botao('Editar Ficha').click()
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
  await botao('Nova estratégia').click()
  const comeco = await dialogo().locator('input').first().inputValue()
  confere('o campo da estratégia já começa a frase', comeco.startsWith('Por meio de'), comeco)
  await dialogo().locator('input').first().fill(nomes.estrategia)
  await botao('Salvar', dialogo()).click()
  await esperaSumir()
  confere('criar estratégia na ficha do resultado', (await texto('main')).includes(nomes.estrategia))
})

await passo('avanço na ficha', async () => {
  await abrirResultado()
  await botao('Adicionar Avanço').click()
  const d = dialogo()
  await d.locator('input[id$=action-title]').fill(nomes.estudo)
  await d.getByRole('group', { name: 'Tipo de avanço' }).getByRole('button', { name: 'Estudo', exact: true }).click()
  await paraHoje(d)
  await maisDetalhes(d)
  await escolher(d.locator('[id$=action-strategy]'), nomes.estrategia)
  await botao('Salvar avanço', d).click()
  await esperaSumir()
  confere('criar Estudo ligado à estratégia, para hoje', (await texto('main')).includes(nomes.estudo))
})

await passo('registro de progresso', async () => {
  await abrirResultado()
  await botao('Novo Registro de Progresso').click()
  const d = dialogo()
  await d.locator('label', { hasText: 'Executei' }).first().click()
  await d.locator('#logText').fill(T('Corri 5 km sem parar'))
  await botao('Salvar registro', d).click()
  await esperaSumir()
  confere('registrar progresso no resultado', (await texto('main')).includes(T('Corri 5 km sem parar')))
  await foto('ficha-resultado')
})

// 6. Hoje: novo avanço, principal, concluir
await passo('novo avanço para hoje', async () => {
  await ir('/avancos')
  await botao('Novo avanço').click()
  const d = dialogo()
  await d.locator('input[id$=action-title]').fill(nomes.acao)
  await escolher(d.locator('[id$=action-project]'), new RegExp(nomes.resultado))
  const fio = await d.locator('[data-fio]').innerText()
  confere('Novo avanço mostra o fio enquanto a pessoa preenche', fio.toLowerCase().includes(nomes.resultado.toLowerCase()), fio)
  await paraHoje(d)
  await botao('Salvar avanço', d).click()
  await esperaSumir()
  await ir('/')
  const t = await texto('main')
  confere('avanço criado aparece em Hoje', t.includes(nomes.acao), t.slice(0, 200))
  confere('o Estudo escolhido para hoje também aparece', t.includes(nomes.estudo))
  confere('Hoje mostra o porquê (o resultado) do avanço', t.includes(nomes.resultado))
  await foto('hoje')
})

// 7. Capturas: capturar, transformar em avanço, descartar
await passo('capturar pelo botão do topo', async () => {
  await ir('/')
  await botao(/^Capturar/).click()
  await dialogo().locator('textarea').fill(nomes.captura)
  await dialogo().getByRole('button', { name: 'Capturar', exact: true }).click()
  await esperaSumir()
  await ir('/capturas')
  confere('captura do topo aparece em Capturas', (await texto('main')).includes(nomes.captura))
})

await passo('capturar na tela de Capturas', async () => {
  await ir('/capturas')
  await page.locator('textarea').first().fill(nomes.captura2)
  await botao('Capturar Ideia').click()
  await page.waitForTimeout(1200)
  confere('captura da caixa de entrada aparece', (await texto('main')).includes(nomes.captura2))
  await foto('capturas')
})

const cartao = (titulo) => page.locator('div.group.relative').filter({ hasText: titulo }).first()
// Avanços: lista por estado; a linha abre os comandos completos ao tocar no título.
const verGrupo = async (nome) => {
  await ir('/avancos')
  await page.getByRole('group', { name: 'Estado dos avanços' }).getByRole('button', { name: new RegExp('^' + nome) }).click()
  await page.waitForTimeout(400)
}
const linhaAvanco = (titulo) => page.locator('li[data-avanco]').filter({ hasText: titulo }).first()
const abrirLinha = async (titulo) => {
  const b = linhaAvanco(titulo).locator('button[aria-expanded]').first()
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click()
  await page.waitForTimeout(300)
}
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
  await ir('/capturas')
  const linha = page.locator('div.rounded-xl').filter({ hasText: nomes.captura }).first()
  await botao('Processar', linha).click()
  await item(/^Ação$/).click()
  await page.waitForTimeout(1500)
  await verGrupo('Prontos')
  confere('captura processada vira avanço em Avanços', (await texto('main')).includes(nomes.captura))
})

await passo('descartar captura', async () => {
  await ir('/capturas')
  const linha = page.locator('div.rounded-xl').filter({ hasText: nomes.captura2 }).first()
  await botao('Processar', linha).click()
  await item('Descartar').click()
  await page.waitForTimeout(1500)
  await ir('/capturas')
  const pendente = await page.locator('div.rounded-xl').filter({ hasText: nomes.captura2 }).filter({ has: page.getByRole('button', { name: 'Processar' }) }).count()
  confere('captura descartada sai das pendentes', pendente === 0)
})

// 9. Atividade: o histórico mostra o que foi feito e desfaz o último passo
await passo('atividade e desfazer', async () => {
  await ir('/atividade')
  const t = await texto('main')
  confere('Atividade registra o que foi feito', /captura/i.test(t), t.slice(0, 200))
  await botao('Desfazer', page.locator('main')).click()
  await page.waitForTimeout(1500)
  await ir('/capturas')
  const pendente = await page.locator('div.rounded-xl').filter({ hasText: nomes.captura2 }).filter({ has: page.getByRole('button', { name: 'Processar' }) }).count()
  confere('Desfazer devolve a captura descartada', pendente === 1)
})

// 10. Concluir avanços: a Ação direto, o Estudo deixando rastro
await passo('concluir a Ação em Hoje', async () => {
  await concluirEmHoje(nomes.acao)
  if (await page.locator('[role=dialog]').count()) {
    await dialogo().locator('textarea').fill(T('Corri no parque'))
    await botao('Concluir', dialogo()).click()
    await esperaSumir()
  }
  await verGrupo('Feitos')
  const feito = await page.getByRole('button', { name: `Reabrir: ${nomes.acao}` }).count()
  confere('Ação concluída fica marcada como feita', feito === 1)
})

await passo('concluir o Estudo com rastro', async () => {
  await concluirEmHoje(nomes.estudo)
  await dialogo().locator('textarea').fill(T('Aprendi a montar a planilha'))
  await botao('Concluir', dialogo()).click()
  await esperaSumir()
  await verGrupo('Feitos')
  const feito = await page.getByRole('button', { name: `Reabrir: ${nomes.estudo}` }).count()
  confere('Estudo só conclui deixando rastro, e fica feito', feito === 1)
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
  await page.locator('[data-escada]').first().getByRole('link', { name: 'Para quê?' }).click()
  await page.waitForTimeout(1200)
  confere('"Para quê?" sobe do resultado para a responsabilidade', page.url().includes('/responsabilidades?id=') && (await texto('main')).includes(nomes.resp))
})

// 10c. Método: guia do propósito
await passo('guia do propósito', async () => {
  await ir('/configuracoes')
  const guia = page.locator('[data-guia-proposito]')
  await guia.getByRole('button', { name: /Guia do propósito/ }).click()
  confere('guia do propósito traz as quatro perguntas', (await guia.locator('textarea').count()) === 5)
  await guia.locator('#guia-frase').fill(nomes.proposito)
  await botao('Usar esta frase', guia).click()
  confere('a frase do guia vai para o campo do propósito', (await page.locator('#life-purpose').inputValue()) === nomes.proposito)
})

// 11. Avanços: editar e cancelar o avanço que veio da captura
await passo('editar e cancelar avanço', async () => {
  await verGrupo('Prontos')
  await abrirLinha(nomes.captura)
  await linhaAvanco(nomes.captura).getByRole('button', { name: 'Mais comandos do avanço' }).click()
  await item(/Editar/).click()
  const d = dialogo()
  await d.locator('input[id$=action-title]').fill(nomes.captura + ' (editado)')
  await botao(/Atualizar|Salvar/, d).click()
  await esperaSumir()
  confere('editar o título de um avanço', (await texto('main')).includes(nomes.captura + ' (editado)'))
  await abrirLinha(nomes.captura)
  await linhaAvanco(nomes.captura).getByRole('button', { name: 'Mais comandos do avanço' }).click()
  await item('Cancelar avanço').click()
  await page.waitForTimeout(1500)
  await verGrupo('Feitos')
  await abrirLinha(nomes.captura)
  confere('cancelar um avanço', /Cancelad/i.test(await linhaAvanco(nomes.captura).innerText()))
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
  await ir('/responsabilidades')
  await page.getByText(nomes.resp2).first().click()
  await botao('Arquivar').click()
  await botao('Arquivar', dialogo()).click()
  await botao('Reativar').waitFor()
  confere('arquivar a responsabilidade', true)
  await botao('Reativar').click()
  await botao('Arquivar').waitFor()
  confere('reativar a responsabilidade', true)
})

// 14. Mapa e Revisão
await passo('mapa e revisão', async () => {
  await ir('/mapa')
  const m = await texto('main')
  confere('Mapa mostra o resultado e quantos avanços já andaram', m.includes(nomes.resultado) && /\d+ de \d+ avanços/.test(m), m.slice(0, 200))
  const no = page.locator('[data-resultado]').filter({ hasText: nomes.resultado }).first()
  const abre = no.locator('button[aria-expanded]').last()
  if ((await abre.getAttribute('aria-expanded')) !== 'true') await abre.click()
  await page.waitForTimeout(400)
  const aberto = await no.innerText()
  confere('Mapa abre a estratégia dentro do resultado', aberto.includes(nomes.estrategia), aberto.slice(0, 200))
  await page.getByRole('group', { name: 'Visão do mapa' }).getByRole('button', { name: 'Sustentar' }).click()
  await page.waitForTimeout(400)
  confere('Mapa em Sustentar mostra as responsabilidades', (await texto('main')).includes(nomes.resp))
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
  await passo('privacidade da IA', async () => {
    await ir('/configuracoes')
    const chave = page.locator('#ia-ligada')
    await chave.waitFor()
    if ((await chave.getAttribute('aria-checked')) === 'true') await chave.click()
    await page.waitForTimeout(800)
    await ir('/avancos')
    await botao('Novo avanço').click()
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
    await ir('/capturas')
    await page.locator('textarea').first().fill(ideia)
    await botao('Capturar Ideia').click()
    await page.waitForTimeout(1200)
    const linha = page.locator('div.rounded-xl').filter({ hasText: ideia }).first()
    await botao('Sugerir com IA', linha).click()
    await aceitarAviso()
    await botao('Dispensar', linha).waitFor({ timeout: 45000 })
    confere('IA sugere o destino de uma captura', true)
    if (await botao('Usar sugestão', linha).count()) {
      await botao('Usar sugestão', linha).click()
      await page.waitForTimeout(2000)
      const pendente = await page.locator('div.rounded-xl').filter({ hasText: ideia }).filter({ has: page.getByRole('button', { name: 'Processar' }) }).count()
      confere('usar a sugestão processa a captura', pendente === 0)
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
    await ir('/resultados')
    await botao('Novo resultado').click()
    const d = dialogo()
    await d.locator('input[id$=project-title]').fill('Ser um bom pai para as minhas filhas')
    await d.locator('input[id$=completion-condition]').click()
    await d.locator('[data-correcao]').waitFor({ timeout: 45000 }).catch(() => {})
    const n = await d.locator('[data-correcao]').count()
    confere('correção gentil: o Pegada avisa quando o resultado não tem linha de chegada', n === 1)
    if (n) await botao('Dispensar', d).click()
    await page.keyboard.press('Escape')
    await esperaSumir()
  })
  await passo('IA no Novo Avanço', async () => {
    await ir('/avancos')
    await botao('Novo avanço').click()
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

// 15. Nenhuma tela pode ficar mais larga que o aparelho
await passo('largura das telas', async () => {
  const largas = []
  for (const rota of ['/', '/avancos', '/capturas', '/resultados', '/responsabilidades', '/mapa', '/atividade', '/revisao', '/configuracoes']) {
    await ir(rota)
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (sw > cw + 1) largas.push(`${rota} (${sw} em ${cw})`)
  }
  confere('nenhuma tela passa da largura do aparelho', largas.length === 0, largas.join(', '))
})

console.log(`\n${total - falhas} de ${total} verificações passaram.`)
if (erros.length) {
  console.log('\nErros de JavaScript nas telas:')
  for (const e of [...new Set(erros)].slice(0, 20)) console.log('  ' + e.slice(0, 300))
}
await browser.close()
process.exit(falhas || erros.length ? 1 : 0)
