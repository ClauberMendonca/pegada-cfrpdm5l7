// PEGADA — API DO MÉTODO (rotas HTTP + servidor MCP).
//
// Toda escrita do app passa por aqui (as coleções do núcleo estão com
// create/update bloqueados desde a 0016). As mesmas operações servem:
//   - às telas (sessão do dono)                      → nível 0
//   - à IA embutida, quando a pessoa aceita a sugestão → nível 1
//   - a agentes externos, por HTTP ou MCP (token)     → nível 2
//
// Rotas (prefixo /backend/v1/pegada):
//   GET  /operacoes                      catálogo com descrições e esquemas
//   POST /op/{nome}                      executa uma operação (corpo = entrada)
//   POST /lote                           { operacoes: [{op, entrada}], atomico }
//   POST /desfazer/{eventoId}            desfaz um evento do histórico
//   POST /desfazer-lote/{loteId}         desfaz um lote inteiro
//   POST /propostas/{id}/confirmar       dono confirma proposta de agente
//   POST /propostas/{id}/recusar         dono recusa proposta de agente
//   POST /agentes                        dono cria agente (devolve token 1x)
//   POST /agentes/{id}/revogar           dono revoga agente
//   POST /mcp                            servidor MCP (Bearer pgd_...)
//   POST /mcp/{token}                    servidor MCP com token na URL
//   POST /ia/sugerir                     nível 1: sugestão de redação/classificação
//
// NOTA JSVM: cada callback carrega o núcleo com require DENTRO dele.

routerAdd('GET', '/backend/v1/pegada/operacoes', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  let actor = null
  try {
    actor = core.resolveActor(e)
  } catch (_) {
    actor = null
  }
  return e.json(200, { versao: core.VERSION, operacoes: core.catalog(actor) })
})

routerAdd('POST', '/backend/v1/pegada/op/{nome}', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  const body = e.requestInfo().body || {}
  const res = core.execute(e.app, actor, e.request.pathValue('nome'), body)
  return e.json(200, res)
})

routerAdd('POST', '/backend/v1/pegada/lote', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  const body = e.requestInfo().body || {}
  return e.json(200, core.executeBatch(e.app, actor, body.operacoes, body.atomico === true))
})

routerAdd('POST', '/backend/v1/pegada/desfazer/{eventoId}', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.undo(e.app, actor, e.request.pathValue('eventoId')))
})

routerAdd('POST', '/backend/v1/pegada/desfazer-lote/{loteId}', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.undoBatch(e.app, actor, e.request.pathValue('loteId')))
})

routerAdd('POST', '/backend/v1/pegada/propostas/{id}/confirmar', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.decideProposal(e.app, actor, e.request.pathValue('id'), true))
})

routerAdd('POST', '/backend/v1/pegada/propostas/{id}/recusar', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.decideProposal(e.app, actor, e.request.pathValue('id'), false))
})

routerAdd('POST', '/backend/v1/pegada/agentes', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.createAgent(e.app, actor, e.requestInfo().body || {}))
})

routerAdd('POST', '/backend/v1/pegada/agentes/{id}/revogar', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  return e.json(200, core.revokeAgent(e.app, actor, e.request.pathValue('id')))
})

// ---------------- MCP (Streamable HTTP, respostas JSON, sem sessão) ----------------
// Funciona com clientes que aceitam header (Claude Code, Claude Desktop via
// config, outros) e, pela variante com token na URL, com conectores que só
// aceitam uma URL. O token é revogável a qualquer momento pelo dono.

routerAdd('POST', '/backend/v1/pegada/mcp', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  let actor
  try {
    actor = core.resolveActor(e)
  } catch (err) {
    e.response.header().set('WWW-Authenticate', 'Bearer realm="pegada"')
    return e.json(401, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: core.errMessage(err) },
    })
  }
  if (actor.type !== 'agente') {
    return e.json(403, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32001,
        message: 'O MCP é para agentes: crie um agente no app e use o token dele.',
      },
    })
  }
  const body = e.requestInfo().body
  const msgs = Array.isArray(body) ? body : [body]
  const out = []
  for (const m of msgs) {
    const r = core.mcpHandle(e.app, actor, m)
    if (r) out.push(r)
  }
  if (out.length === 0) return e.noContent(202)
  return e.json(200, Array.isArray(body) ? out : out[0])
})

routerAdd('POST', '/backend/v1/pegada/mcp/{token}', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  let actor
  try {
    actor = core.resolveActor(e, e.request.pathValue('token'))
  } catch (err) {
    return e.json(401, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: core.errMessage(err) },
    })
  }
  const body = e.requestInfo().body
  const msgs = Array.isArray(body) ? body : [body]
  const out = []
  for (const m of msgs) {
    const r = core.mcpHandle(e.app, actor, m)
    if (r) out.push(r)
  }
  if (out.length === 0) return e.noContent(202)
  return e.json(200, Array.isArray(body) ? out : out[0])
})

routerAdd('GET', '/backend/v1/pegada/mcp', (e) =>
  e.json(405, { message: 'Use POST (MCP Streamable HTTP, sem SSE).' }),
)
routerAdd('GET', '/backend/v1/pegada/mcp/{token}', (e) =>
  e.json(405, { message: 'Use POST (MCP Streamable HTTP, sem SSE).' }),
)

// ---------------- Nível 1: IA embutida (só sugere, nunca grava) ----------------
// Usa o $ai nativo do Skip Cloud quando existir. Fora do Skip, responde 503
// honestamente (nunca sugestão inventada). Tipos:
//   resultado  → reescreve como estado alcançado + prazo
//   avanco     → título claro, começando por verbo, e o tipo provável
//   proposito  → frase "Eu existo para ..., para que ..."
//   captura    → destino provável (avanco|resultado|responsabilidade|estrategia)
routerAdd('POST', '/backend/v1/pegada/ia/sugerir', (e) => {
  const core = (function () {
    var ps = [
      __hooks + '/lib/pegada-core.js',
      __hooks + '/pegada-core.js',
      __hooks + '/lib/pegada-core',
      __hooks + '/pegada-core',
    ]
    var last = null
    for (var i = 0; i < ps.length; i++) {
      try {
        return require(ps[i])
      } catch (err) {
        last = err
      }
    }
    throw new ApiError(500, 'pegada-core indisponivel: ' + last + ' | __hooks=' + __hooks)
  })()
  const actor = core.resolveActor(e)
  if (actor.type === 'agente')
    throw new ForbiddenError('Agentes já têm a própria IA; esta rota é do app.')
  if (typeof $ai === 'undefined' || !$ai || typeof $ai.chat !== 'function') {
    return e.json(503, { message: 'IA embutida indisponível neste servidor.' })
  }
  const body = e.requestInfo().body || {}
  const tipo = String(body.tipo || '')
  const texto = String(body.texto || '').slice(0, 2000)
  if (!texto) throw new BadRequestError('Envie o texto.')
  const guide = {
    resultado:
      'Reescreva como RESULTADO do método Pegada: um estado alcançado, verificável, com prazo AAAA-MM-DD se o texto der pista. Responda JSON {"titulo": "...", "prazo": "AAAA-MM-DD ou vazio", "por_que": "uma frase"}.',
    avanco:
      'Reescreva como AVANÇO: título curto começando por verbo e o tipo entre acao, compromisso, estudo, reflexao, ideia, espera. Responda JSON {"titulo": "...", "tipo": "...", "por_que": "uma frase"}.',
    proposito:
      'Proponha uma frase de propósito no formato "Eu existo para [verbo] [quem ou o quê], para que [mudança]." Responda JSON {"texto": "...", "por_que": "uma frase"}.',
    captura:
      'Classifique a captura: destino entre avanco, resultado, responsabilidade, estrategia; se avanco, o tipo. Responda JSON {"destino": "...", "tipo": "...", "titulo": "...", "por_que": "uma frase"}.',
  }[tipo]
  if (!guide) throw new BadRequestError('tipo deve ser resultado, avanco, proposito ou captura.')
  const res = $ai.chat({
    messages: [
      {
        role: 'system',
        content:
          'Você ajuda a aplicar o método Pegada. ' +
          guide +
          ' Responda só o JSON, em português do Brasil.',
      },
      { role: 'user', content: texto },
    ],
  })
  let content = ''
  try {
    content = res.choices[0].message.content
  } catch (_) {
    content = ''
  }
  let sugestao = null
  try {
    sugestao = JSON.parse(
      String(content)
        .replace(/^```(json)?|```$/g, '')
        .trim(),
    )
  } catch (_) {
    sugestao = null
  }
  if (!sugestao)
    return e.json(502, { message: 'A IA não devolveu uma sugestão válida. Tente de novo.' })
  return e.json(200, { tipo: tipo, sugestao: sugestao, origem: 'ia_embutida' })
})
