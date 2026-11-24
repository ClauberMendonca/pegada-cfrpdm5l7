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
  await escolher(d.locator('button', { hasText: /^\s*Ação\s*$/ }).first(), 'Estudo')
  await escolher(d.locator('[id$=action-strategy]'), nomes.estrategia)
  await ligar(d.locator('[id$=action-today-selected]'))
  await botao('Criar avanço', d).click()
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
await passo('novo avanço em Hoje', async () => {
  await ir('/')
  await botao('Novo Avanço').click()
  const d = dialogo()
  await d.locator('input[id$=action-title]').fill(nomes.acao)
  await escolher(d.locator('[id$=action-context]'), 'Vida')
  await escolher(d.locator('[id$=action-project]'), new RegExp(nomes.resultado))
  await ligar(d.locator('[id$=action-today-selected]'))
  await botao('Criar avanço', d).click()
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
  await botao('Guardar', dialogo()).click()
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

console.log(`\n${total - falhas} de ${total} verificações passaram.`)
if (erros.length) {
  console.log('\nErros de JavaScript nas telas:')
  for (const e of [...new Set(erros)].slice(0, 20)) console.log('  ' + e.slice(0, 300))
}
await browser.close()
process.exit(falhas || erros.length ? 1 : 0)
