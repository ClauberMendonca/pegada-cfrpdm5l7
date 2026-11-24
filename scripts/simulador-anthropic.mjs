#!/usr/bin/env node
// Simulador local da API de mensagens da Anthropic, só para testes automáticos.
// Responde a POST /v1/messages com uma sugestão fixa em JSON e confere que o
// servidor do Pegada mandou os cabeçalhos e campos esperados.
import http from 'node:http'

const PORTA = Number(process.env.SIMULADOR_PORTA || 8787)

http
  .createServer((req, res) => {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      const ok =
        req.method === 'POST' &&
        req.url === '/v1/messages' &&
        req.headers['x-api-key'] &&
        req.headers['anthropic-version'] === '2026-10-21'
      let pedido = {}
      try {
        pedido = JSON.parse(corpo)
      } catch {}
      if (!ok || !pedido.model || !Array.isArray(pedido.messages) || 'temperature' in pedido) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'pedido inesperado' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_simulado',
          type: 'message',
          role: 'assistant',
          model: pedido.model,
          stop_reason: 'end_turn',
          content: [
            { type: 'thinking', thinking: '', signature: 'x' },
            { type: 'text', text: '{"titulo": "Correr 10 km em menos de uma hora", "prazo": "", "por_que": "Um estado verificável."}' },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      )
    })
  })
  .listen(PORTA, '127.0.0.1', () => console.log('simulador da Anthropic em http://127.0.0.1:' + PORTA))
