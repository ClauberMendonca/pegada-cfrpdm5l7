#!/usr/bin/env node
// Simulador local da API de mensagens da Anthropic, só para testes automáticos.
// Responde a POST /v1/messages com uma sugestão fixa em JSON e confere que o
// servidor do Pegada mandou os cabeçalhos e campos esperados.
import http from 'node:http'

const PORTA = Number(process.env.SIMULADOR_PORTA || 8787)

// A resposta muda conforme o tipo de sugestão pedido, lido da instrução enviada.
function respostaPara(pedido) {
  if (pedido.includes('Classifique a captura'))
    return { destino: 'avanco', tipo: 'acao', titulo: 'Pedir o relatório de caixa', por_que: 'É algo a fazer.' }
  if (pedido.includes('Reescreva como AVANÇO'))
    return { titulo: 'Estudar a planilha de treino', tipo: 'estudo', por_que: 'Começa por verbo.' }
  if (pedido.includes('frase de propósito'))
    return { texto: 'Eu existo para cuidar de quem amo, para que todos cresçam.', por_que: 'Formato do método.' }
  return { titulo: 'Correr 10 km em menos de uma hora', prazo: '', por_que: 'Um estado verificável.' }
}

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
            { type: 'text', text: JSON.stringify(respostaPara(JSON.stringify(pedido))) },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      )
    })
  })
  .listen(PORTA, '127.0.0.1', () => console.log('simulador da Anthropic em http://127.0.0.1:' + PORTA))
