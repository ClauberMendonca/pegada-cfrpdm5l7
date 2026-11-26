#!/usr/bin/env node
// Caixa de e-mail de mentira para os testes: aceita qualquer mensagem por SMTP
// (porta 2525, sem senha) e mostra as recebidas em http://127.0.0.1:2526/.
// Nada sai para a internet.
import net from 'node:net'
import http from 'node:http'

const recebidas = []

net
  .createServer((s) => {
    let dados = ''
    let emData = false
    let atual = { de: '', para: [], corpo: '' }
    s.write('220 pegada-teste ESMTP\r\n')
    s.on('data', (pedaco) => {
      dados += pedaco.toString('utf8')
      for (;;) {
        if (emData) {
          const fim = dados.indexOf('\r\n.\r\n')
          if (fim < 0) return
          atual.corpo = dados.slice(0, fim)
          dados = dados.slice(fim + 5)
          recebidas.push(atual)
          atual = { de: '', para: [], corpo: '' }
          emData = false
          s.write('250 ok\r\n')
          continue
        }
        const nl = dados.indexOf('\r\n')
        if (nl < 0) return
        const linha = dados.slice(0, nl)
        dados = dados.slice(nl + 2)
        const cmd = linha.toUpperCase()
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) s.write('250-pegada-teste\r\n250 8BITMIME\r\n')
        else if (cmd.startsWith('MAIL FROM')) {
          atual.de = linha.slice(10)
          s.write('250 ok\r\n')
        } else if (cmd.startsWith('RCPT TO')) {
          atual.para.push(linha.slice(8).replace(/[<>]/g, '').trim())
          s.write('250 ok\r\n')
        } else if (cmd === 'DATA') {
          emData = true
          s.write('354 manda\r\n')
        } else if (cmd === 'QUIT') {
          s.write('221 tchau\r\n')
          s.end()
        } else s.write('250 ok\r\n')
      }
    })
    s.on('error', () => {})
  })
  .listen(2525, '127.0.0.1')

// Desfaz o quoted-printable para o teste achar os links inteiros.
const limpo = (t) =>
  t.replace(/=\r\n/g, '').replace(/((?:=[0-9A-F]{2})+)/g, (m) => {
    try {
      return Buffer.from(m.replace(/=/g, ''), 'hex').toString('utf8')
    } catch {
      return m
    }
  })

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(recebidas.map((m) => ({ para: m.para, corpo: limpo(m.corpo) }))))
  })
  .listen(2526, '127.0.0.1')

console.log('Caixa de e-mail de teste: SMTP em 127.0.0.1:2525, leitura em http://127.0.0.1:2526/')
