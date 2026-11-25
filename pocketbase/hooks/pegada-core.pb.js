function pegadaRota(e) {
  /**
   * PEGADA — NÚCLEO DA API DO MÉTODO (CommonJS para a JSVM do PocketBase).
   *
   * Uma única fonte para os três níveis:
   *   nível 0 — as telas chamam estas operações (nada escreve direto nas coleções);
   *   nível 1 — a IA embutida só sugere; quando a pessoa aceita, a escrita passa
   *             por aqui marcada como 'ia_embutida';
   *   nível 2 — agentes externos chamam as MESMAS operações pela rota HTTP ou
   *             pelo servidor MCP, com token, escopos e limite de uso próprios.
   *
   * Cada operação tem: nome no vocabulário do método, descrição clara (é o que
   * o agente lê), esquema de entrada (JSON Schema, usado também pelo MCP),
   * escopo, e se é uma ESCOLHA do método (Propósito, Responsabilidades,
   * Resultados, Estratégias). Escolhas feitas por agente viram PROPOSTA e só
   * valem depois que o dono confirma.
   *
   * Toda escrita gera um evento em audit_events com a lista de mudanças
   * (antes/depois), o que permite desfazer.
   *
   * ARQUIVO ÚNICO: o núcleo e as rotas HTTP vivem neste mesmo arquivo, dentro
   * da função pegadaRota (nada de require — nesta instância o require de
   * .pb.js falha com "Invalid module" por qualquer caminho).
   */

  'use strict'

  var VERSION = '0.1.0'
  var MAX_ACTIVE_RESULTS = 7
  var REF_ELEMENTS = ['responsabilidade', 'resultado', 'estrategia', 'avanco']
  var SUGGESTED_ACTIVE_RESULTS = 5
  var KINDS = ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia', 'espera']
  var KIND_LABEL = {
    acao: 'Ação',
    compromisso: 'Compromisso',
    estudo: 'Estudo',
    reflexao: 'Reflexão',
    ideia: 'Ideia',
    espera: 'Espera',
  }
  var TRAIL_KINDS = ['estudo', 'reflexao', 'ideia']
  var SCOPES = ['ler', 'capturar', 'avancos', 'propor', 'desfazer']
  var DEFAULT_AGENT_SCOPES = ['ler', 'capturar', 'avancos', 'propor']
  var DEFAULT_HOURLY_LIMIT = 300

  // Como "desfazer uma criação" sem apagar (exclusão física é bloqueada).
  var CANCEL_ON_UNDO = {
    actions: { status: 'cancelada', is_next_step: false, is_today_selected: false },
    projects: { status: 'arquivado' },
    captures: { status: 'descartada' },
    responsibilities: { status: 'arquivada' },
    strategies: { status: 'arquivada' },
  }

  // ---------------------------------------------------------------- erros

  function rule(code, message) {
    // Mensagem que explica a regra, para pessoa e agente se corrigirem.
    return new BadRequestError('[' + code + '] ' + message, { regra: code })
  }

  function conflict(message) {
    return new ApiError(409, message, {})
  }

  // ---------------------------------------------------------------- utilidades

  function str(v) {
    return typeof v === 'string' ? v.trim() : ''
  }

  function has(obj, key) {
    return (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== undefined &&
      obj[key] !== null
    )
  }

  function norm(v) {
    if (v === null || v === undefined) return ''
    if (typeof v === 'boolean' || typeof v === 'number') return v
    return String(v)
  }

  function isDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
    var d = new Date(v + 'T00:00:00Z')
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }

  function todayFor(app, userId) {
    var tz = 'America/Sao_Paulo'
    try {
      var u = app.findRecordById('users', userId)
      if (u.getString('timezone')) tz = u.getString('timezone')
    } catch (_) {}
    try {
      return new DateTime().time().in(new Timezone(tz)).format('2006-01-02')
    } catch (_) {
      return new Date().toISOString().slice(0, 10)
    }
  }

  function findOwned(app, collection, id, userId, label) {
    if (!id) throw rule('ID_OBRIGATORIO', label + ': informe o id.')
    var rec
    try {
      rec = app.findRecordById(collection, id)
    } catch (_) {
      throw new NotFoundError(label + ' não encontrado(a): ' + id)
    }
    if (rec.getString('user_id') !== userId)
      throw new NotFoundError(label + ' não encontrado(a): ' + id)
    return rec
  }

  function label(rec) {
    var n = rec.getInt ? rec.getInt('sequence_number') : 0
    return (n ? '#' + n + ' ' : '') + '"' + rec.getString('title') + '"'
  }

  // ---------------------------------------------------------------- contexto de escrita

  function makeCtx(app, actor) {
    var changes = []
    return {
      app: app,
      actor: actor,
      userId: actor.userId,
      changes: changes,
      create: function (collection, data) {
        var col = app.findCollectionByNameOrId(collection)
        var rec = new Record(col)
        rec.set('user_id', actor.userId)
        var after = {}
        for (var k in data) {
          if (data[k] === undefined) continue
          rec.set(k, data[k])
          after[k] = norm(data[k])
        }
        app.save(rec)
        changes.push({ c: collection, id: rec.id, k: 'create', before: {}, after: after })
        return rec
      },
      update: function (rec, data) {
        var collection = rec.collection().name
        var before = {}
        var after = {}
        var changed = false
        for (var k in data) {
          if (data[k] === undefined) continue
          var prev = norm(rec.get(k))
          var next = norm(data[k])
          if (prev === next) continue
          before[k] = prev
          after[k] = next
          rec.set(k, data[k])
          changed = true
        }
        if (!changed) return rec
        app.save(rec)
        changes.push({ c: collection, id: rec.id, k: 'update', before: before, after: after })
        return rec
      },
    }
  }

  // ---------------------------------------------------------------- o fio

  function purposeOf(app, userId) {
    try {
      return app.findRecordById('users', userId).getString('life_purpose')
    } catch (_) {
      return ''
    }
  }

  function safeFind(app, collection, id) {
    if (!id) return null
    try {
      return app.findRecordById(collection, id)
    } catch (_) {
      return null
    }
  }

  /**
   * Monta a frase do porquê: "Faço X, pela estratégia S, para alcançar R,
   * porque P." Avanço sem ligação devolve fio vazio e sem_fio=true.
   */
  function fioOf(app, action, purpose, cache) {
    cache = cache || {}
    var get = function (c, id) {
      var key = c + ':' + id
      if (!(key in cache)) cache[key] = safeFind(app, c, id)
      return cache[key]
    }
    var title = action.getString('title')
    var result = get('projects', action.getString('project_id'))
    var strategy = get('strategies', action.getString('strategy_id'))
    var directResp = get('responsibilities', action.getString('responsibility_id'))
    var resp = result ? get('responsibilities', result.getString('responsibility_id')) : directResp
    var parts = ['Faço "' + title + '"']
    if (strategy) parts.push('pela estratégia "' + strategy.getString('title') + '"')
    if (result) {
      parts.push('para alcançar "' + result.getString('title') + '"')
      if (resp) parts.push('sustentando "' + resp.getString('title') + '"')
    } else if (resp) {
      parts.push('para sustentar "' + resp.getString('title') + '"')
    }
    var semFio = !result && !resp
    if (!semFio && purpose) {
      var p = purpose.replace(/[.\s]+$/, '')
      parts.push('porque ' + p.charAt(0).toLowerCase() + p.slice(1))
    }
    return {
      frase: semFio ? '' : parts.join(', ') + '.',
      sem_fio: semFio,
      resultado: result ? { id: result.id, titulo: result.getString('title') } : null,
      estrategia: strategy ? { id: strategy.id, titulo: strategy.getString('title') } : null,
      responsabilidade: resp ? { id: resp.id, titulo: resp.getString('title') } : null,
      // construir = nasce do Propósito; sustentar = nasce de uma Responsabilidade
      apoio: semFio ? 'livre' : resp ? 'sustentar' : 'construir',
    }
  }

  function actionView(app, a, purpose, cache) {
    var kind = a.getString('kind') || 'acao'
    return {
      id: a.id,
      numero: a.getInt('sequence_number') || null,
      titulo: a.getString('title'),
      tipo: kind,
      tipo_nome: KIND_LABEL[kind],
      status: a.getString('status'),
      contexto: a.getString('context'),
      principal: a.getBool('is_next_step'),
      para_hoje: a.getBool('is_today_selected'),
      prazo: a.getString('deadline'),
      data_planejada: a.getString('planned_date'),
      hora_planejada: a.getString('planned_time'),
      aguardando: a.getString('waiting_for'),
      rastro: a.getString('trail'),
      fio: fioOf(app, a, purpose, cache),
    }
  }

  function resultView(r) {
    return {
      id: r.id,
      numero: r.getInt('sequence_number') || null,
      titulo: r.getString('title'),
      prazo: r.getString('deadline'),
      como_sei: r.getString('completion_condition'),
      status: r.getString('status'),
      contexto: r.getString('context'),
      responsabilidade_id: r.getString('responsibility_id') || null,
    }
  }

  // ---------------------------------------------------------------- regras compartilhadas

  function resolveKind(v, fallback) {
    var k = str(v) || fallback || ''
    if (!k) throw rule('TIPO_OBRIGATORIO', 'Todo avanço tem um tipo: ' + KINDS.join(', ') + '.')
    if (KINDS.indexOf(k) < 0)
      throw rule('TIPO_INVALIDO', 'Tipo deve ser um de: ' + KINDS.join(', ') + '.')
    return k
  }

  function checkActiveLimit(app, userId, exceptId) {
    var active = app.findRecordsByFilter(
      'projects',
      "user_id = {:u} && status = 'ativo'",
      '',
      0,
      0,
      {
        u: userId,
      },
    )
    var n = 0
    for (var i = 0; i < active.length; i++) if (active[i].id !== exceptId) n++
    if (n >= MAX_ACTIVE_RESULTS) {
      throw rule(
        'LIMITE_RESULTADOS',
        'Já existem ' +
          n +
          ' resultados ativos. O método sugere de 5 a 7. ' +
          'Conclua, abandone ou mova um para a lista de futuros antes de ativar outro, ' +
          "ou crie este com situacao 'futuro'.",
      )
    }
    return n + 1 > SUGGESTED_ACTIVE_RESULTS
      ? 'Você está com ' + (n + 1) + ' resultados ativos, perto do limite de 7.'
      : ''
  }

  // Campos do modelo antigo (antes do método). Aceitos só para não quebrar
  // telas antigas; não aparecem no catálogo nem no MCP. Remover quando o
  // formulário de Resultado for simplificado.
  var LEGACY_RESULT_FIELDS = [
    'aspiration',
    'controllable_delivery',
    'learning_asset',
    'r_resultado',
    'r_razao',
    'r_referencia',
    'r_rumo',
    'r_recursos',
    'r_restricoes',
    'r_riscos',
    'r_responsavel',
  ]
  function legacyResultPatch(input) {
    var out = {}
    var d = input && input._legado
    if (!d || typeof d !== 'object') return out
    for (var i = 0; i < LEGACY_RESULT_FIELDS.length; i++) {
      var f = LEGACY_RESULT_FIELDS[i]
      if (has(d, f)) out[f] = str(d[f])
    }
    return out
  }

  function checkResultShape(title, deadline) {
    if (!title)
      throw rule(
        'RESULTADO_ESTADO',
        'Escreva o resultado como um estado alcançado (ex.: "Empresa funcionando duas semanas sem mim").',
      )
    if (!deadline)
      throw rule(
        'RESULTADO_PRAZO',
        'Resultado ativo precisa de prazo (AAAA-MM-DD), para que no prazo dê para responder "alcancei ou não?".',
      )
    if (!isDate(deadline))
      throw rule('DATA_INVALIDA', 'Prazo deve estar no formato AAAA-MM-DD e ser uma data real.')
  }

  /** Resolve os vínculos de um avanço e o contexto coerente. */
  function resolveLinks(ctx, input, current) {
    var app = ctx.app
    var userId = ctx.userId
    var projectId = has(input, 'resultado_id')
      ? str(input.resultado_id)
      : current
        ? current.getString('project_id')
        : ''
    var strategyId = has(input, 'estrategia_id')
      ? str(input.estrategia_id)
      : current
        ? current.getString('strategy_id')
        : ''
    var respId = has(input, 'responsabilidade_id')
      ? str(input.responsabilidade_id)
      : current
        ? current.getString('responsibility_id')
        : ''

    var strategy = null
    if (strategyId) {
      strategy = findOwned(app, 'strategies', strategyId, userId, 'Estratégia')
      var sp = strategy.getString('project_id')
      if (projectId && projectId !== sp) {
        throw rule(
          'ESTRATEGIA_DE_OUTRO_RESULTADO',
          'A estratégia pertence a outro resultado. Escolha uma estratégia do mesmo resultado.',
        )
      }
      projectId = sp
      if (
        strategy.getString('status') !== 'ativa' &&
        (!current || current.getString('strategy_id') !== strategyId)
      ) {
        throw rule('ESTRATEGIA_ARQUIVADA', 'Só é possível ligar a uma estratégia ativa.')
      }
    }
    var result = null
    var context = ''
    if (projectId) {
      result = findOwned(app, 'projects', projectId, userId, 'Resultado')
      context = result.getString('context')
      respId = '' // a responsabilidade é herdada do resultado
    } else if (respId) {
      var resp = findOwned(app, 'responsibilities', respId, userId, 'Responsabilidade')
      context = resp.getString('context')
    }
    if (!context) {
      var c = str(input.contexto)
      context =
        c === 'vida' || c === 'trabalho' ? c : current ? current.getString('context') : 'trabalho'
    }
    return {
      project_id: projectId,
      strategy_id: projectId ? strategyId : '',
      responsibility_id: respId,
      context: context,
    }
  }

  // ---------------------------------------------------------------- operações

  var S_ID = { type: 'string', description: 'id do registro' }
  var S_DATE = { type: 'string', description: 'data AAAA-MM-DD' }
  var S_CTX = { type: 'string', enum: ['vida', 'trabalho'] }

  var OPS = {
    // ======================= LEITURA =======================
    ver_fio_de_hoje: {
      scope: 'ler',
      write: false,
      title: 'Ver o fio de hoje',
      description:
        'Mostra o dia: o avanço principal, os compromissos e o que vence hoje, e os poucos avanços escolhidos para hoje. Cada avanço vem com a frase do porquê (o fio). Use antes de propor o plano do dia.',
      schema: { type: 'object', properties: {} },
      run: function (ctx) {
        var app = ctx.app
        var today = todayFor(app, ctx.userId)
        var purpose = purposeOf(app, ctx.userId)
        var open = app.findRecordsByFilter(
          'actions',
          "user_id = {:u} && status != 'feita' && status != 'cancelada' && (is_next_step = true || is_today_selected = true || planned_date = {:d} || (deadline != '' && deadline <= {:d}))",
          '-is_next_step,planned_time,deadline',
          200,
          0,
          { u: ctx.userId, d: today },
        )
        var cache = {}
        var out = {
          data: today,
          proposito: purpose,
          principal: null,
          compromissos: [],
          vencendo: [],
          para_hoje: [],
        }
        for (var i = 0; i < open.length; i++) {
          var v = actionView(app, open[i], purpose, cache)
          if (v.principal) out.principal = v
          else if (v.tipo === 'compromisso' && v.data_planejada === today) out.compromissos.push(v)
          else if (v.prazo && v.prazo <= today && !v.para_hoje) out.vencendo.push(v)
          else out.para_hoje.push(v)
        }
        out.capturas_pendentes = app.findRecordsByFilter(
          'captures',
          "user_id = {:u} && status = 'pendente'",
          '',
          0,
          0,
          { u: ctx.userId },
        ).length
        out.propostas_pendentes = app.findRecordsByFilter(
          'proposals',
          "user_id = {:u} && status = 'pendente'",
          '',
          0,
          0,
          { u: ctx.userId },
        ).length
        out.dica = out.principal
          ? ''
          : 'Nenhum avanço principal escolhido. Pergunta do método: qual avanço mais aproxima um resultado seu hoje?'
        if (out.para_hoje.length > 5)
          out.dica =
            'Há ' +
            out.para_hoje.length +
            ' avanços para hoje; o método sugere de 3 a 5, fora os compromissos.'
        return out
      },
    },

    ver_mapa: {
      scope: 'ler',
      write: false,
      title: 'Ver o mapa do sentido',
      description:
        'Devolve a estrutura inteira: Propósito, Responsabilidades ativas (com os avanços e rotinas que as sustentam), Resultados (ativos e futuros) com suas Estratégias e avanços abertos, e os avanços livres. Use para entender onde encaixar algo novo.',
      schema: { type: 'object', properties: {} },
      run: function (ctx) {
        var app = ctx.app
        var u = ctx.userId
        var resps = app.findRecordsByFilter(
          'responsibilities',
          "user_id = {:u} && status = 'ativa'",
          'title',
          0,
          0,
          { u: u },
        )
        var results = app.findRecordsByFilter(
          'projects',
          "user_id = {:u} && (status = 'ativo' || status = 'futuro' || status = 'pausado' || status = 'rascunho')",
          'deadline',
          0,
          0,
          { u: u },
        )
        var strategies = app.findRecordsByFilter(
          'strategies',
          "user_id = {:u} && status = 'ativa'",
          'created',
          0,
          0,
          { u: u },
        )
        var openActions = app.findRecordsByFilter(
          'actions',
          "user_id = {:u} && status != 'feita' && status != 'cancelada'",
          '',
          0,
          0,
          { u: u },
        )
        var countBy = {}
        var semFio = 0
        for (var i = 0; i < openActions.length; i++) {
          var pid = openActions[i].getString('project_id')
          if (pid) countBy[pid] = (countBy[pid] || 0) + 1
          else if (!openActions[i].getString('responsibility_id')) semFio++
        }
        // Progresso de cada resultado e os avanços abertos de cada estratégia.
        var doneActions = app.findRecordsByFilter(
          'actions',
          "user_id = {:u} && status = 'feita' && project_id != ''",
          '',
          0,
          0,
          { u: u },
        )
        var doneBy = {}
        for (var d = 0; d < doneActions.length; d++) {
          var dp = doneActions[d].getString('project_id')
          doneBy[dp] = (doneBy[dp] || 0) + 1
        }
        var openByStrategy = {}
        var openLoose = {}
        // Avanços sem resultado: os que sustentam uma responsabilidade (rotinas
        // e avulsos) e os livres, que não têm ligação nenhuma e são legítimos.
        var openByResp = {}
        var openFree = []
        for (var o = 0; o < openActions.length; o++) {
          var oa = openActions[o]
          var item = {
            id: oa.id,
            titulo: oa.getString('title'),
            tipo: oa.getString('kind') || 'acao',
            status: oa.getString('status'),
            contexto: oa.getString('context'),
            hoje: oa.getBool('is_today_selected') || oa.getBool('is_next_step'),
            principal: oa.getBool('is_next_step'),
            rotina: !!oa.getString('recurrence_series_id'),
            prazo: oa.getString('deadline'),
          }
          var sid = oa.getString('strategy_id')
          var opid = oa.getString('project_id')
          var orid = oa.getString('responsibility_id')
          if (sid) (openByStrategy[sid] = openByStrategy[sid] || []).push(item)
          else if (opid) (openLoose[opid] = openLoose[opid] || []).push(item)
          else if (orid) (openByResp[orid] = openByResp[orid] || []).push(item)
          else openFree.push(item)
        }
        var resultsOut = results.map(function (r) {
          var v = resultView(r)
          v.avancos_feitos = doneBy[r.id] || 0
          v.avancos_total = (doneBy[r.id] || 0) + (countBy[r.id] || 0)
          v.avancos_sem_estrategia = openLoose[r.id] || []
          v.estrategias = strategies
            .filter(function (s) {
              return s.getString('project_id') === r.id
            })
            .map(function (s) {
              return {
                id: s.id,
                titulo: s.getString('title'),
                sinal_de_teste: s.getString('test_signal'),
                avancos: openByStrategy[s.id] || [],
              }
            })
          v.avancos_abertos = countBy[r.id] || 0
          return v
        })
        return {
          proposito: purposeOf(app, u),
          responsabilidades: resps.map(function (r) {
            return {
              id: r.id,
              titulo: r.getString('title'),
              contexto: r.getString('context'),
              escolhida_por: r.getString('chosen_by') || null,
              avancos: openByResp[r.id] || [],
            }
          }),
          resultados: resultsOut,
          avancos_livres: openFree,
          avancos_sem_fio: semFio,
          resultados_sem_forma_minima: results
            .filter(function (r) {
              return r.getString('status') === 'ativo' && !r.getString('deadline')
            })
            .map(function (r) {
              return { id: r.id, titulo: r.getString('title') }
            }),
          limite_resultados_ativos: MAX_ACTIVE_RESULTS,
        }
      },
    },

    ver_resumo_semana: {
      scope: 'ler',
      write: false,
      title: 'Ver o espelho e o balanço',
      description:
        'Prepara a revisão: avanços concluídos no período agrupados por resultado (o espelho), divisão entre construir, sustentar e livres (o balanço), resultados ativos parados, estratégias com seus avanços (para testar a aposta) e Esperas abertas. Padrão: últimos 7 dias.',
      schema: {
        type: 'object',
        properties: {
          dias: {
            type: 'integer',
            minimum: 1,
            maximum: 366,
            description: 'tamanho do período em dias (padrão 7)',
          },
        },
      },
      run: function (ctx, input) {
        var app = ctx.app
        var u = ctx.userId
        var dias = Math.max(1, Math.min(366, parseInt(input.dias, 10) || 7))
        var since = new DateTime().addDate(0, 0, -dias).string()
        var purpose = purposeOf(app, u)
        var done = app.findRecordsByFilter(
          'actions',
          "user_id = {:u} && status = 'feita' && completed_at >= {:s}",
          '-completed_at',
          0,
          0,
          { u: u, s: since },
        )
        var cache = {}
        var balanco = { construir: 0, sustentar: 0, livre: 0 }
        var porResultado = {}
        var porEstrategia = {}
        for (var i = 0; i < done.length; i++) {
          var f = fioOf(app, done[i], purpose, cache)
          balanco[f.apoio]++
          if (f.resultado) {
            var k = f.resultado.id
            if (!porResultado[k]) porResultado[k] = { resultado: f.resultado, concluidos: [] }
            porResultado[k].concluidos.push({
              id: done[i].id,
              titulo: done[i].getString('title'),
              tipo: done[i].getString('kind') || 'acao',
            })
          }
          if (f.estrategia)
            porEstrategia[f.estrategia.id] = (porEstrategia[f.estrategia.id] || 0) + 1
        }
        var actives = app.findRecordsByFilter(
          'projects',
          "user_id = {:u} && status = 'ativo'",
          'deadline',
          0,
          0,
          { u: u },
        )
        var parados = actives
          .filter(function (r) {
            return !porResultado[r.id]
          })
          .map(resultView)
        var strategies = app.findRecordsByFilter(
          'strategies',
          "user_id = {:u} && status = 'ativa'",
          '',
          0,
          0,
          { u: u },
        )
        var esperas = app.findRecordsByFilter(
          'actions',
          "user_id = {:u} && kind = 'espera' && status != 'feita' && status != 'cancelada'",
          'created',
          0,
          0,
          { u: u },
        )
        var total = done.length || 1
        // Um retrato de cada resultado ativo, para a revisão olhar um por vez:
        // quanto já andou, o que andou no período e há quanto tempo está parado.
        var hoje = new Date()
        var ativos = actives.map(function (r) {
          var acts = app.findRecordsByFilter(
            'actions',
            "user_id = {:u} && project_id = {:p} && status != 'cancelada'",
            '',
            0,
            0,
            { u: u, p: r.id },
          )
          var feitos = 0
          var ultimo = ''
          for (var j = 0; j < acts.length; j++) {
            if (acts[j].getString('status') !== 'feita') continue
            feitos++
            var c = String(acts[j].get('completed_at') || '')
            if (c > ultimo) ultimo = c
          }
          var v = resultView(r)
          v.avancos_total = acts.length
          v.avancos_feitos = feitos
          v.feitos_no_periodo = porResultado[r.id] ? porResultado[r.id].concluidos.length : 0
          v.dias_parado = ultimo
            ? Math.max(0, Math.floor((hoje.getTime() - new Date(ultimo.replace(' ', 'T')).getTime()) / 86400000))
            : null
          v.estrategias = strategies
            .filter(function (s) {
              return s.getString('project_id') === r.id
            })
            .map(function (s) {
              return { id: s.id, titulo: s.getString('title') }
            })
          return v
        })
        return {
          periodo_dias: dias,
          proposito: purpose,
          resultados_ativos: ativos,
          concluidos: done.length,
          espelho: Object.keys(porResultado).map(function (k) {
            return porResultado[k]
          }),
          resultados_parados: parados,
          balanco: {
            construir: balanco.construir,
            sustentar: balanco.sustentar,
            livres: balanco.livre,
            percentual_livres: Math.round((balanco.livre * 100) / total),
          },
          estrategias: strategies.map(function (s) {
            return {
              id: s.id,
              titulo: s.getString('title'),
              resultado_id: s.getString('project_id'),
              sinal_de_teste: s.getString('test_signal'),
              avancos_concluidos: porEstrategia[s.id] || 0,
              pergunta: 'Os avanços deste período me aproximaram do resultado?',
            }
          }),
          esperas_abertas: esperas.map(function (a) {
            return {
              id: a.id,
              titulo: a.getString('title'),
              aguardando: a.getString('waiting_for'),
              desde: String(a.get('created')).slice(0, 10),
              pergunta: 'Preciso cobrar alguém?',
            }
          }),
          capturas_pendentes: app.findRecordsByFilter(
            'captures',
            "user_id = {:u} && status = 'pendente'",
            '',
            0,
            0,
            { u: u },
          ).length,
        }
      },
    },

    listar_capturas: {
      scope: 'ler',
      write: false,
      title: 'Listar capturas',
      description:
        'Lista as capturas. Por padrão só as pendentes, que ainda precisam ser processadas.',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pendente', 'todas'] },
          limite: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      run: function (ctx, input) {
        var all = str(input.status) === 'todas'
        var list = ctx.app.findRecordsByFilter(
          'captures',
          all ? 'user_id = {:u}' : "user_id = {:u} && status = 'pendente'",
          '-created',
          Math.min(200, parseInt(input.limite, 10) || 50),
          0,
          { u: ctx.userId },
        )
        return {
          capturas: list.map(function (c) {
            return {
              id: c.id,
              texto: c.getString('raw_text'),
              status: c.getString('status'),
              criada_em: String(c.get('created')),
            }
          }),
        }
      },
    },

    listar_avancos: {
      scope: 'ler',
      write: false,
      title: 'Listar avanços',
      description:
        'Lista avanços com o seu fio. Filtre por resultado, estratégia, responsabilidade, tipo, situação, ou use sem_fio=true para achar avanços que ainda não estão ligados a nenhum resultado ou responsabilidade.',
      schema: {
        type: 'object',
        properties: {
          resultado_id: S_ID,
          estrategia_id: S_ID,
          responsabilidade_id: S_ID,
          tipo: { type: 'string', enum: KINDS },
          situacao: {
            type: 'string',
            enum: ['abertos', 'feitos', 'todos'],
            description: 'padrão: abertos',
          },
          sem_fio: { type: 'boolean' },
          limite: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      run: function (ctx, input) {
        var f = ['user_id = {:u}']
        var p = { u: ctx.userId }
        var sit = str(input.situacao) || 'abertos'
        if (sit === 'abertos') f.push("status != 'feita' && status != 'cancelada'")
        if (sit === 'feitos') f.push("status = 'feita'")
        if (str(input.resultado_id)) {
          f.push('project_id = {:p}')
          p.p = str(input.resultado_id)
        }
        if (str(input.estrategia_id)) {
          f.push('strategy_id = {:s}')
          p.s = str(input.estrategia_id)
        }
        if (str(input.responsabilidade_id)) {
          f.push('responsibility_id = {:r}')
          p.r = str(input.responsabilidade_id)
        }
        if (str(input.tipo)) {
          f.push(str(input.tipo) === 'acao' ? "(kind = 'acao' || kind = '')" : 'kind = {:k}')
          p.k = str(input.tipo)
        }
        if (input.sem_fio === true) f.push("project_id = '' && responsibility_id = ''")
        var list = ctx.app.findRecordsByFilter(
          'actions',
          f.join(' && '),
          '-is_next_step,-is_today_selected,-created',
          Math.min(200, parseInt(input.limite, 10) || 100),
          0,
          p,
        )
        var purpose = purposeOf(ctx.app, ctx.userId)
        var cache = {}
        return {
          avancos: list.map(function (a) {
            return actionView(ctx.app, a, purpose, cache)
          }),
        }
      },
    },

    ver_historico: {
      scope: 'ler',
      write: false,
      title: 'Ver o histórico',
      description:
        'Mostra quem fez o quê, mais recente primeiro: a pessoa, a IA embutida ou cada agente. Cada item pode ser desfeito enquanto ninguém mexeu de novo no mesmo registro.',
      schema: {
        type: 'object',
        properties: { limite: { type: 'integer', minimum: 1, maximum: 200 } },
      },
      run: function (ctx, input) {
        var list = ctx.app.findRecordsByFilter(
          'audit_events',
          'user_id = {:u}',
          '-created',
          Math.min(200, parseInt(input.limite, 10) || 30),
          0,
          { u: ctx.userId },
        )
        return { eventos: list.map(eventView) }
      },
    },

    listar_propostas: {
      scope: 'ler',
      write: false,
      title: 'Listar propostas',
      description: 'Lista as propostas de agentes que aguardam (ou já tiveram) a decisão do dono.',
      schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pendente', 'confirmada', 'recusada', 'falhou', 'todas'],
          },
        },
      },
      run: function (ctx, input) {
        var st = str(input.status) || 'pendente'
        var list = ctx.app.findRecordsByFilter(
          'proposals',
          st === 'todas' ? 'user_id = {:u}' : 'user_id = {:u} && status = {:s}',
          '-created',
          100,
          0,
          { u: ctx.userId, s: st },
        )
        return { propostas: list.map(proposalView) }
      },
    },

    // ======================= CAPTURA =======================
    capturar: {
      scope: 'capturar',
      write: true,
      title: 'Capturar',
      description:
        'Guarda qualquer coisa que surgiu, sem classificar. Use para tudo que ainda não tem lugar; o processamento vem depois.',
      schema: {
        type: 'object',
        required: ['texto'],
        properties: { texto: { type: 'string', minLength: 1, maxLength: 5000 } },
      },
      run: function (ctx, input) {
        var t = str(input.texto)
        if (!t) throw rule('TEXTO_OBRIGATORIO', 'A captura precisa de um texto.')
        var c = ctx.create('captures', { raw_text: t, status: 'pendente' })
        return { resumo: 'Capturou "' + t.slice(0, 80) + '"', captura_id: c.id }
      },
    },

    editar_captura: {
      scope: 'capturar',
      write: true,
      title: 'Editar captura',
      description: 'Corrige o texto de uma captura ainda pendente.',
      schema: {
        type: 'object',
        required: ['captura_id', 'texto'],
        properties: { captura_id: S_ID, texto: { type: 'string', minLength: 1, maxLength: 5000 } },
      },
      run: function (ctx, input) {
        var c = findOwned(ctx.app, 'captures', str(input.captura_id), ctx.userId, 'Captura')
        if (c.getString('status') !== 'pendente')
          throw rule('CAPTURA_JA_PROCESSADA', 'Esta captura já foi processada.')
        if (!str(input.texto)) throw rule('TEXTO_OBRIGATORIO', 'A captura precisa de um texto.')
        ctx.update(c, { raw_text: str(input.texto) })
        return { resumo: 'Editou a captura', captura_id: c.id }
      },
    },

    descartar_captura: {
      scope: 'capturar',
      write: true,
      title: 'Descartar captura',
      description: 'Marca uma captura como descartada (nada é apagado; pode ser desfeito).',
      schema: { type: 'object', required: ['captura_id'], properties: { captura_id: S_ID } },
      run: function (ctx, input) {
        var c = findOwned(ctx.app, 'captures', str(input.captura_id), ctx.userId, 'Captura')
        if (c.getString('status') !== 'pendente')
          throw rule('CAPTURA_JA_PROCESSADA', 'Esta captura já foi processada.')
        ctx.update(c, { status: 'descartada' })
        return { resumo: 'Descartou a captura "' + c.getString('raw_text').slice(0, 60) + '"' }
      },
    },

    processar_captura: {
      scope: 'avancos',
      write: true,
      title: 'Processar captura',
      description:
        "Transforma uma captura pendente em: 'avanco' (com ou sem fio), 'resultado', 'responsabilidade' ou 'estrategia'. Em 'dados' vão os mesmos campos da operação de criação correspondente (criar_avanco, criar_resultado, criar_responsabilidade, criar_estrategia). Se dados.titulo faltar, usa o texto da captura. Para agentes, os destinos resultado, responsabilidade e estrategia viram proposta para o dono confirmar.",
      isChoice: function (input) {
        return str(input.destino) !== 'avanco'
      },
      schema: {
        type: 'object',
        required: ['captura_id', 'destino'],
        properties: {
          captura_id: S_ID,
          destino: {
            type: 'string',
            enum: ['avanco', 'resultado', 'responsabilidade', 'estrategia'],
          },
          dados: { type: 'object', description: 'campos da criação do destino' },
        },
      },
      run: function (ctx, input) {
        var c = findOwned(ctx.app, 'captures', str(input.captura_id), ctx.userId, 'Captura')
        if (c.getString('status') !== 'pendente')
          throw rule('CAPTURA_JA_PROCESSADA', 'Esta captura já foi processada.')
        var dados =
          input.dados && typeof input.dados === 'object'
            ? JSON.parse(JSON.stringify(input.dados))
            : {}
        if (!str(dados.titulo)) dados.titulo = c.getString('raw_text').slice(0, 200)
        var destino = str(input.destino)
        var map = {
          avanco: ['criar_avanco', 'convertida_acao', 'converted_action_id', 'avanco_id'],
          resultado: [
            'criar_resultado',
            'convertida_projeto',
            'converted_project_id',
            'resultado_id',
          ],
          responsabilidade: [
            'criar_responsabilidade',
            'convertida_responsabilidade',
            'converted_responsibility_id',
            'responsabilidade_id',
          ],
          estrategia: [
            'criar_estrategia',
            'convertida_estrategia',
            'converted_strategy_id',
            'estrategia_id',
          ],
        }[destino]
        if (!map)
          throw rule(
            'DESTINO_INVALIDO',
            'destino deve ser avanco, resultado, responsabilidade ou estrategia.',
          )
        var out = OPS[map[0]].run(ctx, dados)
        var patch = { status: map[1] }
        patch[map[2]] = out[map[3]]
        ctx.update(c, patch)
        out.resumo = 'Processou captura → ' + out.resumo
        out.captura_id = c.id
        return out
      },
    },

    // ======================= AVANÇOS =======================
    criar_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Criar avanço',
      description:
        'Cria um avanço de um dos seis tipos (acao, compromisso, estudo, reflexao, ideia, espera). Ligue-o a uma estratégia, a um resultado ou, nas rotinas, a uma responsabilidade, para que ele carregue o porquê. Sem ligação ele fica livre. Espera exige "aguardando" (de quem ou o quê).',
      schema: {
        type: 'object',
        required: ['titulo', 'tipo'],
        properties: {
          titulo: { type: 'string', minLength: 1, maxLength: 300 },
          tipo: { type: 'string', enum: KINDS },
          resultado_id: S_ID,
          estrategia_id: S_ID,
          responsabilidade_id: {
            type: 'string',
            description: 'só para avanço sem resultado (rotina de sustentação)',
          },
          contexto: S_CTX,
          descricao: { type: 'string', maxLength: 5000 },
          prazo: S_DATE,
          data_planejada: S_DATE,
          hora_planejada: { type: 'string', description: 'HH:mm' },
          aguardando: { type: 'string', description: 'para Espera: de quem ou do quê' },
          para_hoje: { type: 'boolean' },
          principal: { type: 'boolean', description: 'torna este o avanço principal do dia' },
        },
      },
      run: function (ctx, input) {
        var title = str(input.titulo)
        if (!title) throw rule('TITULO_OBRIGATORIO', 'O avanço precisa de um título.')
        var kind = resolveKind(input.tipo, '')
        var links = resolveLinks(ctx, input, null)
        if (kind === 'espera' && !str(input.aguardando))
          throw rule(
            'ESPERA_SEM_QUEM',
            'Uma Espera precisa dizer de quem ou do quê você está aguardando (campo aguardando).',
          )
        if (str(input.prazo) && !isDate(str(input.prazo)))
          throw rule('DATA_INVALIDA', 'prazo deve ser AAAA-MM-DD.')
        var plannedDate = str(input.data_planejada)
        if (plannedDate && !isDate(plannedDate))
          throw rule('DATA_INVALIDA', 'data_planejada deve ser AAAA-MM-DD.')
        var tz = ''
        if (plannedDate) {
          try {
            tz = ctx.app.findRecordById('users', ctx.userId).getString('timezone')
          } catch (_) {}
          tz = tz || 'America/Sao_Paulo'
        }
        if (input.principal === true) clearMain(ctx, '')
        var rec = ctx.create('actions', {
          title: title,
          kind: kind,
          context: links.context,
          status: kind === 'espera' ? 'aguardando' : 'pronta',
          project_id: links.project_id,
          strategy_id: links.strategy_id,
          responsibility_id: links.responsibility_id,
          description: str(input.descricao) || undefined,
          deadline: str(input.prazo) || undefined,
          planned_date: plannedDate || undefined,
          planned_time: plannedDate ? str(input.hora_planejada) || undefined : undefined,
          planned_timezone: plannedDate ? tz : undefined,
          waiting_for: str(input.aguardando) || undefined,
          is_next_step: input.principal === true,
          is_today_selected: input.principal === true || input.para_hoje === true,
        })
        var fio = fioOf(ctx.app, rec, purposeOf(ctx.app, ctx.userId))
        return {
          resumo: 'Criou ' + KIND_LABEL[kind] + ' ' + label(rec),
          avanco_id: rec.id,
          fio: fio,
          aviso: fio.sem_fio
            ? 'Avanço livre: ainda sem porquê. Ligue a um resultado quando fizer sentido.'
            : '',
        }
      },
    },

    editar_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Editar avanço',
      description:
        'Muda título, tipo, descrição, prazo, data planejada ou "aguardando" de um avanço. Para mudar a ligação use ligar_avanco.',
      schema: {
        type: 'object',
        required: ['avanco_id'],
        properties: {
          avanco_id: S_ID,
          titulo: { type: 'string', maxLength: 300 },
          tipo: { type: 'string', enum: KINDS },
          descricao: { type: 'string', maxLength: 5000 },
          prazo: { type: 'string', description: "AAAA-MM-DD ou '' para limpar" },
          data_planejada: { type: 'string', description: "AAAA-MM-DD ou '' para limpar" },
          hora_planejada: { type: 'string', description: "HH:mm ou ''" },
          aguardando: { type: 'string' },
        },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        var patch = {}
        if (has(input, 'titulo')) {
          if (!str(input.titulo)) throw rule('TITULO_OBRIGATORIO', 'O avanço precisa de um título.')
          patch.title = str(input.titulo)
        }
        if (has(input, 'tipo')) patch.kind = resolveKind(input.tipo, '')
        if (has(input, 'descricao')) patch.description = str(input.descricao)
        if (has(input, 'prazo')) {
          if (str(input.prazo) && !isDate(str(input.prazo)))
            throw rule('DATA_INVALIDA', 'prazo deve ser AAAA-MM-DD.')
          patch.deadline = str(input.prazo)
        }
        if (has(input, 'data_planejada')) {
          var d = str(input.data_planejada)
          if (d && !isDate(d)) throw rule('DATA_INVALIDA', 'data_planejada deve ser AAAA-MM-DD.')
          patch.planned_date = d
          if (!d) {
            patch.planned_time = ''
            patch.planned_timezone = ''
          } else if (!a.getString('planned_timezone')) {
            var tz = ''
            try {
              tz = ctx.app.findRecordById('users', ctx.userId).getString('timezone')
            } catch (_) {}
            patch.planned_timezone = tz || 'America/Sao_Paulo'
          }
        }
        if (has(input, 'hora_planejada')) patch.planned_time = str(input.hora_planejada)
        if (has(input, 'aguardando')) patch.waiting_for = str(input.aguardando)
        var kind = patch.kind || a.getString('kind') || 'acao'
        var waiting = has(patch, 'waiting_for') ? patch.waiting_for : a.getString('waiting_for')
        if (kind === 'espera' && !waiting)
          throw rule(
            'ESPERA_SEM_QUEM',
            'Uma Espera precisa dizer de quem ou do quê você está aguardando.',
          )
        if (kind === 'espera' && a.getString('status') === 'pronta') patch.status = 'aguardando'
        ctx.update(a, patch)
        return { resumo: 'Editou o avanço ' + label(a), avanco_id: a.id }
      },
    },

    ligar_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Ligar avanço (dar o fio)',
      description:
        "Liga um avanço a uma estratégia, a um resultado ou, para rotinas sem resultado, a uma responsabilidade. Envie '' para desligar. Ligar a uma estratégia já liga ao resultado dela.",
      schema: {
        type: 'object',
        required: ['avanco_id'],
        properties: {
          avanco_id: S_ID,
          resultado_id: S_ID,
          estrategia_id: S_ID,
          responsabilidade_id: S_ID,
        },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        // trocar de resultado sem dizer a estratégia limpa a estratégia antiga
        if (
          has(input, 'resultado_id') &&
          !has(input, 'estrategia_id') &&
          str(input.resultado_id) !== a.getString('project_id')
        )
          input.estrategia_id = ''
        var links = resolveLinks(ctx, input, a)
        ctx.update(a, {
          project_id: links.project_id,
          strategy_id: links.strategy_id,
          responsibility_id: links.responsibility_id,
          context: links.context,
        })
        var fio = fioOf(ctx.app, a, purposeOf(ctx.app, ctx.userId))
        return {
          resumo: 'Ligou o avanço ' + label(a) + (fio.sem_fio ? ' (agora livre)' : ''),
          avanco_id: a.id,
          fio: fio,
        }
      },
    },

    concluir_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Concluir avanço',
      description:
        'Marca um avanço como concluído. Regra do rastro: Estudo exige a conclusão anotada, Reflexão exige a decisão registrada e Ideia exige o destino (virou outro avanço ou foi descartada), no campo rastro.',
      schema: {
        type: 'object',
        required: ['avanco_id'],
        properties: { avanco_id: S_ID, rastro: { type: 'string', maxLength: 3000 } },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        if (a.getString('status') === 'feita')
          throw rule('JA_CONCLUIDO', 'Este avanço já está concluído.')
        var kind = a.getString('kind') || 'acao'
        var trail = str(input.rastro) || a.getString('trail')
        if (TRAIL_KINDS.indexOf(kind) >= 0 && !trail) {
          var what = {
            estudo: 'a conclusão do estudo',
            reflexao: 'a decisão tomada',
            ideia: 'o destino da ideia (virou outro avanço ou foi descartada)',
          }[kind]
          throw rule(
            'REGRA_DO_RASTRO',
            KIND_LABEL[kind] + ' só se conclui deixando rastro: informe ' + what + ' em rastro.',
          )
        }
        ctx.update(a, { status: 'feita', trail: trail || undefined, is_next_step: false })
        // A conclusão de um Estudo ou de uma Reflexão vira uma nota presa ao
        // resultado: o que a pessoa aprendeu ou decidiu não se perde.
        var projId = a.getString('project_id')
        if ((kind === 'estudo' || kind === 'reflexao') && trail && projId) {
          try {
            ctx.create('references', {
              element_type: 'resultado',
              element_id: projId,
              kind: 'nota',
              title: (kind === 'estudo' ? 'Conclusão do estudo: ' : 'Decisão da reflexão: ') + a.getString('title'),
              body: trail,
              source_action_id: a.id,
              status: 'ativa',
            })
          } catch (_) {
            // Sem a coleção (servidor ainda não migrado), a conclusão segue valendo.
          }
        }
        return { resumo: 'Concluiu ' + KIND_LABEL[kind] + ' ' + label(a), avanco_id: a.id }
      },
    },

    // ======================= MATERIAL DE REFERÊNCIA =======================
    listar_referencias: {
      scope: 'ler',
      write: false,
      title: 'Listar material de referência',
      description:
        'Lista os anexos leves (notas, links, contatos, documentos) de um elemento. O Pegada não tem arquivo geral: o material aparece só onde é usado.',
      schema: {
        type: 'object',
        required: ['elemento_tipo', 'elemento_id'],
        properties: {
          elemento_tipo: { type: 'string', enum: REF_ELEMENTS },
          elemento_id: S_ID,
        },
      },
      run: function (ctx, input) {
        var recs = ctx.app.findRecordsByFilter(
          'references',
          "user_id = {:u} && element_type = {:t} && element_id = {:e} && status = 'ativa'",
          '-created',
          200,
          0,
          { u: ctx.userId, t: str(input.elemento_tipo), e: str(input.elemento_id) },
        )
        return {
          referencias: recs.map(function (r) {
            return {
              id: r.id,
              tipo: r.getString('kind'),
              titulo: r.getString('title'),
              texto: r.getString('body'),
              endereco: r.getString('url'),
              do_avanco_id: r.getString('source_action_id') || null,
              criada_em: r.getString('created'),
            }
          }),
        }
      },
    },
    anexar_referencia: {
      scope: 'avancos',
      write: true,
      title: 'Anexar material de referência',
      description:
        'Prende uma nota, um link, um contato ou um documento (pelo endereço) a uma responsabilidade, um resultado, uma estratégia ou um avanço.',
      schema: {
        type: 'object',
        required: ['elemento_tipo', 'elemento_id', 'tipo'],
        properties: {
          elemento_tipo: { type: 'string', enum: REF_ELEMENTS },
          elemento_id: S_ID,
          tipo: { type: 'string', enum: ['nota', 'link', 'contato', 'documento'] },
          titulo: { type: 'string', maxLength: 300 },
          texto: { type: 'string', maxLength: 5000 },
          endereco: { type: 'string', maxLength: 2000 },
        },
      },
      run: function (ctx, input) {
        var et = str(input.elemento_tipo)
        var col = { responsabilidade: 'responsibilities', resultado: 'projects', estrategia: 'strategies', avanco: 'actions' }[et]
        if (!col) throw rule('ELEMENTO_INVALIDO', 'elemento_tipo deve ser responsabilidade, resultado, estrategia ou avanco.')
        var kind = str(input.tipo)
        if (['nota', 'link', 'contato', 'documento'].indexOf(kind) < 0)
          throw rule('TIPO_INVALIDO', 'tipo deve ser nota, link, contato ou documento.')
        var el
        if (et === 'estrategia') {
          el = ctx.app.findRecordById('strategies', str(input.elemento_id))
          findOwned(ctx.app, 'projects', el.getString('project_id'), ctx.userId, 'Resultado')
        } else el = findOwned(ctx.app, col, str(input.elemento_id), ctx.userId, 'Elemento')
        var url = str(input.endereco)
        if (url && !/^(https?:\/\/|mailto:|tel:)/i.test(url)) url = 'https://' + url
        var title = str(input.titulo)
        var body = str(input.texto)
        if (!title && !body && !url) throw rule('REFERENCIA_VAZIA', 'Escreva a nota ou informe o endereço.')
        var r = ctx.create('references', {
          element_type: et,
          element_id: el.id,
          kind: kind,
          title: title || undefined,
          body: body || undefined,
          url: url || undefined,
          status: 'ativa',
        })
        return { resumo: 'Anexou ' + kind + ' a ' + et, referencia_id: r.id }
      },
    },
    remover_referencia: {
      scope: 'avancos',
      write: true,
      title: 'Remover material de referência',
      description: 'Tira um anexo do elemento. Dá para desfazer.',
      schema: { type: 'object', required: ['referencia_id'], properties: { referencia_id: S_ID } },
      run: function (ctx, input) {
        var r = findOwned(ctx.app, 'references', str(input.referencia_id), ctx.userId, 'Referência')
        ctx.update(r, { status: 'removida' })
        return { resumo: 'Removeu um anexo', referencia_id: r.id }
      },
    },

    reabrir_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Reabrir avanço',
      description: 'Volta um avanço concluído ou cancelado para aberto.',
      schema: { type: 'object', required: ['avanco_id'], properties: { avanco_id: S_ID } },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        var st = a.getString('status')
        if (st !== 'feita' && st !== 'cancelada')
          throw rule('JA_ABERTO', 'Este avanço já está aberto.')
        ctx.update(a, { status: a.getString('kind') === 'espera' ? 'aguardando' : 'pronta' })
        return { resumo: 'Reabriu o avanço ' + label(a), avanco_id: a.id }
      },
    },

    cancelar_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Cancelar avanço',
      description: 'Cancela um avanço que deixou de fazer sentido (nada é apagado).',
      schema: {
        type: 'object',
        required: ['avanco_id'],
        properties: { avanco_id: S_ID, motivo: { type: 'string', maxLength: 1000 } },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        if (a.getString('status') === 'cancelada')
          throw rule('JA_CANCELADO', 'Este avanço já está cancelado.')
        ctx.update(a, {
          status: 'cancelada',
          is_next_step: false,
          is_today_selected: false,
          trail: str(input.motivo) || undefined,
        })
        return { resumo: 'Cancelou o avanço ' + label(a), avanco_id: a.id }
      },
    },

    mudar_situacao_avanco: {
      scope: 'avancos',
      write: true,
      title: 'Mudar a situação de um avanço',
      description:
        "Marca um avanço aberto como 'pronta', 'em_andamento', 'aguardando' ou 'bloqueada' (com motivo). Para concluir use concluir_avanco; para cancelar, cancelar_avanco.",
      schema: {
        type: 'object',
        required: ['avanco_id', 'situacao'],
        properties: {
          avanco_id: S_ID,
          situacao: { type: 'string', enum: ['pronta', 'em_andamento', 'aguardando', 'bloqueada'] },
          motivo: { type: 'string', maxLength: 1000 },
        },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        var to = str(input.situacao)
        if (['pronta', 'em_andamento', 'aguardando', 'bloqueada'].indexOf(to) < 0)
          throw rule(
            'SITUACAO_INVALIDA',
            'situacao deve ser pronta, em_andamento, aguardando ou bloqueada.',
          )
        var patch = { status: to }
        if (to === 'aguardando' || to === 'bloqueada') {
          var why = str(input.motivo) || a.getString('waiting_for')
          if (to === 'aguardando' && !why)
            throw rule('ESPERA_SEM_QUEM', 'Diga de quem ou do quê você está aguardando (motivo).')
          patch.waiting_for = why
        }
        ctx.update(a, patch)
        return { resumo: 'Avanço ' + label(a) + ' → ' + to, avanco_id: a.id }
      },
    },

    definir_avanco_principal: {
      scope: 'avancos',
      write: true,
      title: 'Definir o avanço principal',
      description:
        'Escolhe o único avanço principal do dia ("qual avanço mais aproxima um resultado meu hoje?"). O anterior deixa de ser principal. Envie avanco_id vazio para ficar sem principal.',
      schema: {
        type: 'object',
        required: ['avanco_id'],
        properties: {
          avanco_id: { type: 'string', description: "id do avanço, ou '' para nenhum" },
        },
      },
      run: function (ctx, input) {
        var id = str(input.avanco_id)
        clearMain(ctx, id)
        if (!id) return { resumo: 'Ficou sem avanço principal' }
        var a = findOwned(ctx.app, 'actions', id, ctx.userId, 'Avanço')
        var st = a.getString('status')
        if (st === 'feita' || st === 'cancelada')
          throw rule('AVANCO_FECHADO', 'Só um avanço aberto pode ser o principal.')
        ctx.update(a, { is_next_step: true, is_today_selected: true })
        return {
          resumo: 'Definiu ' + label(a) + ' como avanço principal',
          avanco_id: a.id,
          fio: fioOf(ctx.app, a, purposeOf(ctx.app, ctx.userId)),
        }
      },
    },

    escolher_para_hoje: {
      scope: 'avancos',
      write: true,
      title: 'Escolher para hoje',
      description:
        'Coloca ou tira um avanço da lista de hoje. O método sugere de 3 a 5 por dia, fora os compromissos.',
      schema: {
        type: 'object',
        required: ['avanco_id', 'hoje'],
        properties: { avanco_id: S_ID, hoje: { type: 'boolean' } },
      },
      run: function (ctx, input) {
        var a = findOwned(ctx.app, 'actions', str(input.avanco_id), ctx.userId, 'Avanço')
        var on = input.hoje === true
        var patch = { is_today_selected: on }
        if (!on) patch.is_next_step = false
        ctx.update(a, patch)
        return {
          resumo: (on ? 'Escolheu para hoje ' : 'Tirou de hoje ') + label(a),
          avanco_id: a.id,
        }
      },
    },

    // ======================= ESCOLHAS DO MÉTODO (agente → proposta) =======================
    definir_proposito: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Definir o propósito',
      description:
        'Grava a frase de propósito ("Eu existo para [verbo] [quem ou o quê], para que [mudança]."). É escolha do dono: agentes só propõem.',
      schema: {
        type: 'object',
        required: ['texto'],
        properties: { texto: { type: 'string', maxLength: 500 } },
      },
      run: function (ctx, input) {
        var t = str(input.texto)
        if (t.length > 500)
          throw rule('PROPOSITO_LONGO', 'O propósito tem no máximo 500 caracteres.')
        var u = ctx.app.findRecordById('users', ctx.userId)
        ctx.update(u, { life_purpose: t })
        return { resumo: t ? 'Definiu o propósito' : 'Limpou o propósito' }
      },
    },

    criar_responsabilidade: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Criar responsabilidade',
      description:
        'Cria uma responsabilidade (algo pelo qual a pessoa responde hoje, não um papel). escolhida_por: "mim" ou "para_mim". Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['titulo', 'contexto'],
        properties: {
          titulo: { type: 'string', maxLength: 200 },
          contexto: S_CTX,
          escolhida_por: { type: 'string', enum: ['mim', 'para_mim'] },
          descricao: { type: 'string', maxLength: 3000 },
        },
      },
      run: function (ctx, input) {
        var c = str(input.contexto)
        if (c !== 'vida' && c !== 'trabalho')
          throw rule('CONTEXTO_OBRIGATORIO', "contexto deve ser 'vida' ou 'trabalho'.")
        var by = str(input.escolhida_por)
        if (by && by !== 'mim' && by !== 'para_mim')
          throw rule('ESCOLHIDA_POR', "escolhida_por deve ser 'mim' ou 'para_mim'.")
        var r = ctx.create('responsibilities', {
          title: str(input.titulo),
          context: c,
          status: 'ativa',
          chosen_by: by || undefined,
          description: str(input.descricao) || undefined,
        })
        return {
          resumo: 'Criou a responsabilidade "' + r.getString('title') + '"',
          responsabilidade_id: r.id,
        }
      },
    },

    editar_responsabilidade: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Editar responsabilidade',
      description:
        'Muda título, descrição ou "escolhida_por" de uma responsabilidade. Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['responsabilidade_id'],
        properties: {
          responsabilidade_id: S_ID,
          titulo: { type: 'string', maxLength: 200 },
          descricao: { type: 'string' },
          contexto: S_CTX,
          escolhida_por: { type: 'string', enum: ['mim', 'para_mim'] },
        },
      },
      run: function (ctx, input) {
        var r = findOwned(
          ctx.app,
          'responsibilities',
          str(input.responsabilidade_id),
          ctx.userId,
          'Responsabilidade',
        )
        var patch = {}
        if (has(input, 'titulo')) patch.title = str(input.titulo)
        if (has(input, 'descricao')) patch.description = str(input.descricao)
        if (has(input, 'escolhida_por')) patch.chosen_by = str(input.escolhida_por)
        if (has(input, 'contexto')) {
          var cx = str(input.contexto)
          if (cx !== 'vida' && cx !== 'trabalho')
            throw rule('CONTEXTO_OBRIGATORIO', "contexto deve ser 'vida' ou 'trabalho'.")
          patch.context = cx
        }
        ctx.update(r, patch)
        return {
          resumo: 'Editou a responsabilidade "' + r.getString('title') + '"',
          responsabilidade_id: r.id,
        }
      },
    },

    arquivar_responsabilidade: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Arquivar responsabilidade',
      description:
        'Arquiva uma responsabilidade que terminou ou foi devolvida (reativar=true para trazer de volta). Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['responsabilidade_id'],
        properties: { responsabilidade_id: S_ID, reativar: { type: 'boolean' } },
      },
      run: function (ctx, input) {
        var r = findOwned(
          ctx.app,
          'responsibilities',
          str(input.responsabilidade_id),
          ctx.userId,
          'Responsabilidade',
        )
        var back = input.reativar === true
        ctx.update(r, { status: back ? 'ativa' : 'arquivada' })
        return {
          resumo:
            (back ? 'Reativou' : 'Arquivou') + ' a responsabilidade "' + r.getString('title') + '"',
          responsabilidade_id: r.id,
        }
      },
    },

    criar_resultado: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Criar resultado',
      description:
        'Cria um resultado na forma mínima: um estado alcançado (titulo) e um prazo (AAAA-MM-DD). Nasce do Propósito (sem responsabilidade_id) ou de uma Responsabilidade. Limite: 7 ativos; acima disso use situacao "futuro". Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['titulo', 'prazo'],
        properties: {
          titulo: { type: 'string', maxLength: 300, description: 'o estado alcançado' },
          prazo: S_DATE,
          como_sei: { type: 'string', maxLength: 2000, description: 'como saberei que alcancei' },
          responsabilidade_id: S_ID,
          contexto: S_CTX,
          situacao: {
            type: 'string',
            enum: ['ativo', 'futuro', 'rascunho'],
            description:
              'padrão: ativo. futuro = lista de futuros; rascunho = ainda sem forma mínima',
          },
        },
      },
      run: function (ctx, input) {
        var title = str(input.titulo)
        var deadline = str(input.prazo)
        var sit = str(input.situacao)
        var status = sit === 'futuro' || sit === 'rascunho' ? sit : 'ativo'
        var aviso = ''
        if (status === 'ativo') {
          checkResultShape(title, deadline)
          aviso = checkActiveLimit(ctx.app, ctx.userId, '')
        } else if (!title) checkResultShape(title, deadline)
        if (deadline && !isDate(deadline)) throw rule('DATA_INVALIDA', 'Prazo deve ser AAAA-MM-DD.')
        var respId = str(input.responsabilidade_id)
        var context = str(input.contexto)
        if (respId)
          context = findOwned(
            ctx.app,
            'responsibilities',
            respId,
            ctx.userId,
            'Responsabilidade',
          ).getString('context')
        if (context !== 'vida' && context !== 'trabalho') context = 'trabalho'
        var data = legacyResultPatch(input)
        data.title = title
        var r = ctx.create(
          'projects',
          Object.assign(data, {
            deadline: deadline || undefined,
            completion_condition: str(input.como_sei) || undefined,
            responsibility_id: respId || undefined,
            context: context,
            status: status,
          }),
        )
        return {
          resumo: 'Criou o resultado ' + label(r) + (status !== 'ativo' ? ' (' + status + ')' : ''),
          resultado_id: r.id,
          aviso: aviso,
        }
      },
    },

    editar_resultado: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Editar resultado',
      description:
        'Muda o estado (titulo), o prazo, o "como sei" ou a responsabilidade de origem de um resultado. Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['resultado_id'],
        properties: {
          resultado_id: S_ID,
          titulo: { type: 'string' },
          prazo: S_DATE,
          como_sei: { type: 'string' },
          contexto: S_CTX,
          responsabilidade_id: { type: 'string', description: "id ou '' para nascer do Propósito" },
        },
      },
      run: function (ctx, input) {
        var r = findOwned(ctx.app, 'projects', str(input.resultado_id), ctx.userId, 'Resultado')
        var patch = legacyResultPatch(input)
        if (has(input, 'titulo')) patch.title = str(input.titulo)
        if (has(input, 'contexto') && !has(input, 'responsabilidade_id')) {
          var cx = str(input.contexto)
          if (cx === 'vida' || cx === 'trabalho') patch.context = cx
        }
        if (has(input, 'prazo')) patch.deadline = str(input.prazo)
        if (has(input, 'como_sei')) patch.completion_condition = str(input.como_sei)
        if (has(input, 'responsabilidade_id')) {
          var rid = str(input.responsabilidade_id)
          patch.responsibility_id = rid
          if (rid)
            patch.context = findOwned(
              ctx.app,
              'responsibilities',
              rid,
              ctx.userId,
              'Responsabilidade',
            ).getString('context')
        }
        var finalTitle = has(patch, 'title') ? patch.title : r.getString('title')
        var finalDeadline = has(patch, 'deadline') ? patch.deadline : r.getString('deadline')
        var aviso = ''
        if (finalDeadline && !isDate(finalDeadline))
          throw rule('DATA_INVALIDA', 'Prazo deve ser AAAA-MM-DD.')
        if (r.getString('status') === 'ativo') {
          // Mexeu no estado ou no prazo: a forma mínima vale. Resultados antigos
          // sem prazo continuam editáveis, mas recebem o aviso.
          if (has(patch, 'title') || has(patch, 'deadline'))
            checkResultShape(finalTitle, finalDeadline)
          else if (!finalDeadline)
            aviso =
              'Este resultado ativo ainda não tem prazo. Dê um prazo para que dê para responder "alcancei ou não?".'
        }
        ctx.update(r, patch)
        return { resumo: 'Editou o resultado ' + label(r), resultado_id: r.id, aviso: aviso }
      },
    },

    decidir_resultado: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Decidir o destino de um resultado',
      description:
        "Decisão da revisão trimestral: 'alcancado', 'sigo' (ativar), 'abandonar' (escolha legítima, não fracasso), 'futuro' (volta para a lista de futuros) ou 'pausar'. Agentes só propõem.",
      schema: {
        type: 'object',
        required: ['resultado_id', 'decisao'],
        properties: {
          resultado_id: S_ID,
          decisao: {
            type: 'string',
            enum: ['alcancado', 'sigo', 'abandonar', 'futuro', 'pausar', 'arquivar', 'rascunho'],
          },
          nota: { type: 'string' },
        },
      },
      run: function (ctx, input) {
        var r = findOwned(ctx.app, 'projects', str(input.resultado_id), ctx.userId, 'Resultado')
        var to = {
          alcancado: 'concluido',
          sigo: 'ativo',
          abandonar: 'abandonado',
          futuro: 'futuro',
          pausar: 'pausado',
          arquivar: 'arquivado',
          rascunho: 'rascunho',
        }[str(input.decisao)]
        if (!to)
          throw rule(
            'DECISAO_INVALIDA',
            'decisao deve ser alcancado, sigo, abandonar, futuro, pausar, arquivar ou rascunho.',
          )
        var aviso = ''
        if (to === 'ativo' && r.getString('status') !== 'ativo') {
          checkResultShape(r.getString('title'), r.getString('deadline'))
          aviso = checkActiveLimit(ctx.app, ctx.userId, r.id)
        }
        ctx.update(r, { status: to })
        return { resumo: 'Resultado ' + label(r) + ' → ' + to, resultado_id: r.id, aviso: aviso }
      },
    },

    criar_estrategia: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Criar estratégia (a aposta)',
      description:
        'Cria uma estratégia para um resultado: uma hipótese de caminho, com um sinal de teste opcional ("se em 4 semanas não houver X, a aposta falhou"). Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['resultado_id', 'titulo'],
        properties: {
          resultado_id: S_ID,
          titulo: { type: 'string', maxLength: 200 },
          sinal_de_teste: { type: 'string', maxLength: 1000 },
          descricao: { type: 'string', maxLength: 3000 },
        },
      },
      run: function (ctx, input) {
        var r = findOwned(ctx.app, 'projects', str(input.resultado_id), ctx.userId, 'Resultado')
        if (!str(input.titulo))
          throw rule('TITULO_OBRIGATORIO', 'A estratégia precisa de um título.')
        var s = ctx.create('strategies', {
          project_id: r.id,
          title: str(input.titulo),
          status: 'ativa',
          test_signal: str(input.sinal_de_teste) || undefined,
          description: str(input.descricao) || undefined,
        })
        return {
          resumo: 'Criou a estratégia "' + s.getString('title') + '" para ' + label(r),
          estrategia_id: s.id,
        }
      },
    },

    editar_estrategia: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Editar estratégia',
      description:
        'Muda título, descrição ou sinal de teste de uma estratégia. Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['estrategia_id'],
        properties: {
          estrategia_id: S_ID,
          titulo: { type: 'string' },
          sinal_de_teste: { type: 'string' },
          descricao: { type: 'string' },
        },
      },
      run: function (ctx, input) {
        var s = findOwned(ctx.app, 'strategies', str(input.estrategia_id), ctx.userId, 'Estratégia')
        var patch = {}
        if (has(input, 'titulo')) patch.title = str(input.titulo)
        if (has(input, 'sinal_de_teste')) patch.test_signal = str(input.sinal_de_teste)
        if (has(input, 'descricao')) patch.description = str(input.descricao)
        ctx.update(s, patch)
        return { resumo: 'Editou a estratégia "' + s.getString('title') + '"', estrategia_id: s.id }
      },
    },

    arquivar_estrategia: {
      scope: 'propor',
      write: true,
      choice: true,
      title: 'Trocar de aposta (arquivar estratégia)',
      description:
        'Arquiva uma estratégia que não funcionou. O resultado continua; só o caminho muda. Os avanços ligados mantêm o histórico. Agentes só propõem.',
      schema: {
        type: 'object',
        required: ['estrategia_id'],
        properties: { estrategia_id: S_ID, reativar: { type: 'boolean' } },
      },
      run: function (ctx, input) {
        var s = findOwned(ctx.app, 'strategies', str(input.estrategia_id), ctx.userId, 'Estratégia')
        var back = input.reativar === true
        ctx.update(s, { status: back ? 'ativa' : 'arquivada' })
        return {
          resumo: (back ? 'Reativou' : 'Arquivou') + ' a estratégia "' + s.getString('title') + '"',
          estrategia_id: s.id,
        }
      },
    },
  }

  function clearMain(ctx, exceptId) {
    var mains = ctx.app.findRecordsByFilter(
      'actions',
      'user_id = {:u} && is_next_step = true',
      '',
      0,
      0,
      { u: ctx.userId },
    )
    for (var i = 0; i < mains.length; i++) {
      if (mains[i].id !== exceptId) ctx.update(mains[i], { is_next_step: false })
    }
  }

  // ---------------------------------------------------------------- views de meta-registros

  function eventView(ev) {
    return {
      id: ev.id,
      quem: ev.getString('actor_type'),
      agente_id: ev.getString('agent_id') || null,
      operacao: ev.getString('op'),
      resumo: ev.getString('summary'),
      lote: ev.getString('batch_id') || null,
      proposta_id: ev.getString('proposal_id') || null,
      desfaz: ev.getString('undo_of') || null,
      desfeito_em: String(ev.get('undone_at') || '') || null,
      quando: String(ev.get('created')),
    }
  }

  function proposalView(p) {
    return {
      id: p.id,
      agente_id: p.getString('agent_id') || null,
      operacao: p.getString('op'),
      entrada: jsonField(p, 'input', {}),
      resumo: p.getString('summary'),
      motivo: p.getString('reason'),
      status: p.getString('status'),
      erro: p.getString('error') || null,
      criada_em: String(p.get('created')),
    }
  }

  // ---------------------------------------------------------------- atores e autorização

  /**
   * Descobre quem chama: pessoa (sessão do app) ou agente (token pgd_...).
   * Header opcional X-Pegada-Origem: sugestao_ia marca escrita feita pela
   * pessoa ao aceitar uma sugestão da IA embutida (nível 1).
   */
  function resolveActor(e, pathToken) {
    var token = pathToken || ''
    if (!token) {
      var h = String(e.request.header.get('Authorization') || '')
      var m = h.match(/^Bearer\s+(pgd_[A-Za-z0-9]+)\s*$/)
      if (m) token = m[1]
    }
    if (token) return agentActor(e.app, token)
    if (e.auth && e.auth.collection().name === 'users') {
      var origin = String(e.request.header.get('X-Pegada-Origem') || '')
      return {
        type: origin === 'sugestao_ia' ? 'ia_embutida' : 'pessoa',
        userId: e.auth.id,
        agent: null,
      }
    }
    throw new UnauthorizedError(
      'Entre no app ou use um token de agente (Authorization: Bearer pgd_...).',
    )
  }

  function agentActor(app, token) {
    if (!/^pgd_[A-Za-z0-9]{20,}$/.test(token))
      throw new UnauthorizedError('Token de agente inválido.')
    var agent
    try {
      agent = app.findFirstRecordByFilter('agents', 'token_hash = {:h}', {
        h: $security.sha256(token),
      })
    } catch (_) {
      throw new UnauthorizedError('Token de agente inválido ou revogado.')
    }
    if (agent.getString('status') !== 'ativo')
      throw new UnauthorizedError('Este agente foi revogado pelo dono.')
    return { type: 'agente', userId: agent.getString('user_id'), agent: agent }
  }

  // Campos JSON chegam da JSVM como bytes crus; getString devolve o JSON em texto.
  function jsonField(rec, field, fallback) {
    try {
      var raw = rec.getString(field)
      if (!raw) return fallback
      var v = JSON.parse(raw)
      return v === null || v === undefined ? fallback : v
    } catch (_) {
      return fallback
    }
  }

  function agentScopes(agent) {
    var s = jsonField(agent, 'scopes', [])
    return Array.isArray(s) ? s : []
  }

  function meterAgent(app, agent) {
    var limit = agent.getInt('hourly_limit') || DEFAULT_HOURLY_LIMIT
    var now = new DateTime()
    var start = agent.getDateTime('window_start')
    var count = agent.getInt('window_count')
    var hourAgo = now.add(-3600 * 1000 * 1000 * 1000)
    if (start.isZero() || start.before(hourAgo)) {
      agent.set('window_start', now)
      count = 0
    }
    if (count >= limit) {
      throw new ApiError(
        429,
        'Limite de ' +
          limit +
          ' chamadas por hora deste agente atingido. Tente mais tarde ou peça ao dono para aumentar.',
        {},
      )
    }
    agent.set('window_count', count + 1)
    agent.set('last_used_at', now)
    app.save(agent)
  }

  function opsFor(actor) {
    var allowed = actor.type === 'agente' ? agentScopes(actor.agent) : SCOPES
    var out = []
    for (var name in OPS) if (allowed.indexOf(OPS[name].scope) >= 0) out.push(name)
    return out
  }

  // ---------------------------------------------------------------- execução

  function newId() {
    return $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789')
  }

  function isChoiceOp(op, input) {
    return op.choice === true || (typeof op.isChoice === 'function' && op.isChoice(input || {}))
  }

  /**
   * Executa uma operação. actor = { type, userId, agent }. opts = { batchId,
   * proposal, metered }. Escolhas feitas por agente viram proposta.
   */
  function execute(app, actor, name, input, opts) {
    opts = opts || {}
    input = input && typeof input === 'object' ? input : {}
    var op = OPS[name]
    if (!op)
      throw new NotFoundError(
        'Operação desconhecida: ' + name + '. Consulte o catálogo em /backend/v1/pegada/operacoes.',
      )
    if (actor.type === 'agente') {
      if (agentScopes(actor.agent).indexOf(op.scope) < 0) {
        throw new ForbiddenError(
          'Este agente não tem o escopo "' + op.scope + '" exigido por ' + name + '.',
        )
      }
      if (!opts.metered) meterAgent(app, actor.agent)
    }

    if (!op.write) {
      return {
        ok: true,
        operacao: name,
        resultado: op.run({ app: app, userId: actor.userId, actor: actor }, input),
      }
    }

    // Agente fazendo escolha do método → proposta pendente.
    if (actor.type === 'agente' && isChoiceOp(op, input)) {
      var proposal = null
      app.runInTransaction(function (tx) {
        var col = tx.findCollectionByNameOrId('proposals')
        var p = new Record(col)
        p.set('user_id', actor.userId)
        p.set('agent_id', actor.agent.id)
        p.set('op', name)
        p.set('input', input)
        p.set('summary', (op.title || name) + ': ' + summarizeInput(input))
        p.set('reason', str(input.motivo || input._motivo))
        p.set('status', 'pendente')
        tx.save(p)
        proposal = proposalView(p)
      })
      return {
        ok: true,
        operacao: name,
        proposta: proposal,
        mensagem: 'Esta é uma escolha do método e ficou pendente até o dono confirmar no painel.',
      }
    }

    var out = null
    app.runInTransaction(function (tx) {
      var ctx = makeCtx(tx, actor)
      var res = op.run(ctx, JSON.parse(JSON.stringify(input))) || {}
      if (ctx.changes.length === 0) {
        out = { ok: true, operacao: name, resultado: res, evento_id: null, sem_mudancas: true }
        return
      }
      var ev = new Record(tx.findCollectionByNameOrId('audit_events'))
      ev.set('user_id', actor.userId)
      ev.set('actor_type', opts.proposal ? 'pessoa' : actor.type)
      if (actor.agent) ev.set('agent_id', actor.agent.id)
      if (opts.proposal) {
        ev.set('agent_id', opts.proposal.getString('agent_id'))
        ev.set('proposal_id', opts.proposal.id)
      }
      ev.set('op', name)
      ev.set('summary', String(res.resumo || name).slice(0, 1000))
      ev.set('changes', ctx.changes)
      if (opts.batchId) ev.set('batch_id', opts.batchId)
      tx.save(ev)
      out = { ok: true, operacao: name, resultado: res, evento_id: ev.id }
    })
    return out
  }

  function summarizeInput(input) {
    var keys = ['titulo', 'texto', 'decisao', 'prazo', 'destino']
    var parts = []
    for (var i = 0; i < keys.length; i++)
      if (input[keys[i]]) parts.push(String(input[keys[i]]).slice(0, 120))
    return parts.join(' · ') || JSON.stringify(input).slice(0, 200)
  }

  function executeBatch(app, actor, list, atomic) {
    if (!Array.isArray(list) || list.length === 0)
      throw rule('LOTE_VAZIO', 'Envie operacoes: [{ op, entrada }].')
    if (list.length > 50) throw rule('LOTE_GRANDE', 'No máximo 50 operações por lote.')
    if (actor.type === 'agente') meterAgent(app, actor.agent)
    var batchId = newId()
    var results = []
    var run = function (a, i) {
      var item = list[i] || {}
      return execute(a, actor, str(item.op), item.entrada || item.input || {}, {
        batchId: batchId,
        metered: true,
      })
    }
    if (atomic) {
      app.runInTransaction(function (tx) {
        for (var i = 0; i < list.length; i++) results.push(run(tx, i))
      })
    } else {
      for (var i = 0; i < list.length; i++) {
        try {
          results.push(run(app, i))
        } catch (err) {
          results.push({ ok: false, operacao: str((list[i] || {}).op), erro: errMessage(err) })
        }
      }
    }
    return { lote_id: batchId, atomico: !!atomic, resultados: results }
  }

  function errMessage(err) {
    if (!err) return 'erro'
    if (err.message) return String(err.message)
    return String(err)
  }

  // ---------------------------------------------------------------- desfazer

  function undo(app, actor, eventId) {
    if (actor.type === 'agente' && agentScopes(actor.agent).indexOf('desfazer') < 0) {
      throw new ForbiddenError('Este agente não tem o escopo "desfazer".')
    }
    if (actor.type === 'agente') meterAgent(app, actor.agent)
    var out = null
    app.runInTransaction(function (tx) {
      var ev
      try {
        ev = tx.findRecordById('audit_events', eventId)
      } catch (_) {
        throw new NotFoundError('Evento não encontrado.')
      }
      if (ev.getString('user_id') !== actor.userId)
        throw new NotFoundError('Evento não encontrado.')
      if (actor.type === 'agente' && ev.getString('agent_id') !== actor.agent.id) {
        throw new ForbiddenError('Um agente só desfaz o que ele mesmo fez.')
      }
      if (!ev.getDateTime('undone_at').isZero()) throw conflict('Este evento já foi desfeito.')
      if (ev.getString('op') === 'desfazer')
        throw conflict('Não é possível desfazer um desfazer. Refaça a operação original.')
      var changes = jsonField(ev, 'changes', [])
      var ctx = makeCtx(tx, { type: actor.type, userId: actor.userId, agent: actor.agent })
      for (var i = changes.length - 1; i >= 0; i--) {
        var ch = changes[i]
        var rec
        try {
          rec = tx.findRecordById(ch.c, ch.id)
        } catch (_) {
          throw conflict('Um registro deste evento não existe mais; desfaça manualmente.')
        }
        if (ch.k === 'update') {
          for (var f in ch.after) {
            if (norm(rec.get(f)) !== ch.after[f]) {
              throw conflict(
                'O registro mudou depois deste evento (campo ' +
                  f +
                  '). Desfaça os eventos mais recentes primeiro ou ajuste manualmente.',
              )
            }
          }
          ctx.update(rec, ch.before)
        } else if (ch.k === 'create') {
          var cancel = CANCEL_ON_UNDO[ch.c]
          if (cancel) ctx.update(rec, cancel)
        }
      }
      ev.set('undone_at', new DateTime())
      tx.save(ev)
      var u = new Record(tx.findCollectionByNameOrId('audit_events'))
      u.set('user_id', actor.userId)
      u.set('actor_type', actor.type)
      if (actor.agent) u.set('agent_id', actor.agent.id)
      u.set('op', 'desfazer')
      u.set('summary', 'Desfez: ' + ev.getString('summary'))
      u.set('changes', ctx.changes)
      u.set('undo_of', ev.id)
      tx.save(u)
      out = {
        ok: true,
        desfeito: ev.id,
        evento_id: u.id,
        resumo: 'Desfez: ' + ev.getString('summary'),
      }
    })
    return out
  }

  function undoBatch(app, actor, batchId) {
    var evs = app.findRecordsByFilter(
      'audit_events',
      "user_id = {:u} && batch_id = {:b} && op != 'desfazer'",
      '-created',
      0,
      0,
      { u: actor.userId, b: batchId },
    )
    if (evs.length === 0) throw new NotFoundError('Lote não encontrado.')
    var out = []
    app.runInTransaction(function (tx) {
      for (var i = 0; i < evs.length; i++) {
        if (!evs[i].getDateTime('undone_at').isZero()) continue
        out.push(undo(tx, actor, evs[i].id))
      }
    })
    return { ok: true, lote_id: batchId, desfeitos: out.length }
  }

  // ---------------------------------------------------------------- propostas

  function decideProposal(app, actor, proposalId, confirm) {
    if (actor.type === 'agente') throw new ForbiddenError('Só o dono decide propostas.')
    var p
    try {
      p = app.findRecordById('proposals', proposalId)
    } catch (_) {
      throw new NotFoundError('Proposta não encontrada.')
    }
    if (p.getString('user_id') !== actor.userId) throw new NotFoundError('Proposta não encontrada.')
    if (p.getString('status') !== 'pendente') throw conflict('Esta proposta já foi decidida.')
    if (!confirm) {
      p.set('status', 'recusada')
      p.set('decided_at', new DateTime())
      app.save(p)
      return { ok: true, proposta: proposalView(p) }
    }
    var input = jsonField(p, 'input', {})
    try {
      var res = execute(
        app,
        { type: 'pessoa', userId: actor.userId, agent: null },
        p.getString('op'),
        input,
        { proposal: p },
      )
      p.set('status', 'confirmada')
      p.set('decided_at', new DateTime())
      p.set('result_event_id', res.evento_id || '')
      app.save(p)
      return { ok: true, proposta: proposalView(p), resultado: res }
    } catch (err) {
      p.set('status', 'falhou')
      p.set('decided_at', new DateTime())
      p.set('error', errMessage(err).slice(0, 1000))
      app.save(p)
      throw err
    }
  }

  // ---------------------------------------------------------------- agentes

  function createAgent(app, actor, input) {
    if (actor.type !== 'pessoa') throw new ForbiddenError('Só o dono, no app, cria agentes.')
    var name = str(input.nome)
    if (!name) throw rule('NOME_OBRIGATORIO', 'Dê um nome ao agente (ex.: "Claude no celular").')
    var scopes = Array.isArray(input.escopos)
      ? input.escopos.filter(function (s) {
          return SCOPES.indexOf(s) >= 0
        })
      : DEFAULT_AGENT_SCOPES
    if (scopes.length === 0)
      throw rule('ESCOPOS', 'Escolha ao menos um escopo: ' + SCOPES.join(', ') + '.')
    var token =
      'pgd_' +
      $security.randomStringWithAlphabet(
        40,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      )
    var a = new Record(app.findCollectionByNameOrId('agents'))
    a.set('user_id', actor.userId)
    a.set('name', name)
    a.set('token_hash', $security.sha256(token))
    a.set('token_prefix', token.slice(0, 10))
    a.set('scopes', scopes)
    a.set('status', 'ativo')
    a.set(
      'hourly_limit',
      Math.max(1, Math.min(100000, parseInt(input.limite_por_hora, 10) || DEFAULT_HOURLY_LIMIT)),
    )
    a.set('window_count', 0)
    app.save(a)
    return {
      ok: true,
      agente: { id: a.id, nome: name, escopos: scopes, prefixo: a.getString('token_prefix') },
      token: token,
      aviso: 'Guarde este token agora: ele não será mostrado de novo.',
    }
  }

  function revokeAgent(app, actor, agentId) {
    if (actor.type !== 'pessoa') throw new ForbiddenError('Só o dono revoga agentes.')
    var a = findOwned(app, 'agents', agentId, actor.userId, 'Agente')
    a.set('status', 'revogado')
    app.save(a)
    return { ok: true, agente_id: a.id, status: 'revogado' }
  }

  // ---------------------------------------------------------------- catálogo e MCP

  function catalog(actor) {
    var names = actor ? opsFor(actor) : Object.keys(OPS)
    return names.map(function (n) {
      var op = OPS[n]
      return {
        nome: n,
        titulo: op.title,
        descricao: op.description,
        escopo: op.scope,
        escrita: !!op.write,
        escolha_do_metodo: !!op.choice || typeof op.isChoice === 'function',
        entrada: op.schema,
      }
    })
  }

  var MCP_INSTRUCTIONS =
    'Pegada é um método de execução que liga cada passo do dia ao resultado escolhido e ao propósito da pessoa ' +
    '("Faço isto, para alcançar aquilo, porque é o que me move"). Elementos: Propósito, Responsabilidades, ' +
    'Resultados (estado + prazo, até 7 ativos), Estratégias (apostas testáveis) e Avanços (acao, compromisso, ' +
    'estudo, reflexao, ideia, espera). Tudo que surge vai primeiro para a Captura. Regras: escolhas de Propósito, ' +
    'Responsabilidades, Resultados e Estratégias são do dono, então suas chamadas viram propostas pendentes; ' +
    'Estudo, Reflexão e Ideia só se concluem com rastro; existe um único avanço principal por dia. ' +
    'Comece por ver_fio_de_hoje ou ver_mapa. Explique sempre o porquê (o fio) ao propor algo. Tudo que você faz ' +
    'fica no histórico do dono e pode ser desfeito.'

  function mcpTools(actor) {
    var tools = opsFor(actor).map(function (n) {
      var op = OPS[n]
      var choice = !!op.choice || typeof op.isChoice === 'function'
      return {
        name: n,
        title: op.title,
        description: op.description,
        inputSchema: op.schema,
        annotations: {
          title: op.title,
          readOnlyHint: !op.write,
          destructiveHint: false,
          idempotentHint: !op.write,
          openWorldHint: false,
        },
        _meta: { escopo: op.scope, escolha_do_metodo: choice },
      }
    })
    var scopes = agentScopes(actor.agent)
    tools.push({
      name: 'executar_em_lote',
      title: 'Executar em lote',
      description:
        'Executa até 50 operações de uma vez (ex.: processar várias capturas). atomico=true faz tudo ou nada.',
      inputSchema: {
        type: 'object',
        required: ['operacoes'],
        properties: {
          operacoes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['op'],
              properties: { op: { type: 'string' }, entrada: { type: 'object' } },
            },
          },
          atomico: { type: 'boolean' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    })
    if (scopes.indexOf('desfazer') >= 0) {
      tools.push({
        name: 'desfazer',
        title: 'Desfazer',
        description:
          'Desfaz um evento que ESTE agente fez (id vindo de ver_historico ou do retorno da operação).',
        inputSchema: {
          type: 'object',
          required: ['evento_id'],
          properties: { evento_id: { type: 'string' } },
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      })
    }
    return tools
  }

  function mcpHandle(app, actor, msg) {
    var id = msg && msg.id !== undefined ? msg.id : null
    var method = msg && msg.method
    var reply = function (result) {
      return { jsonrpc: '2.0', id: id, result: result }
    }
    var fail = function (code, message) {
      return { jsonrpc: '2.0', id: id, error: { code: code, message: message } }
    }
    if (!method) return fail(-32600, 'Requisição inválida')
    if (id === null && method.indexOf('notifications/') === 0) return null
    if (method === 'initialize') {
      var requested = msg.params && msg.params.protocolVersion
      var supported = ['2025-06-18', '2025-03-26', '2024-11-05']
      return reply({
        protocolVersion: supported.indexOf(requested) >= 0 ? requested : supported[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pegada', title: 'Pegada', version: VERSION },
        instructions: MCP_INSTRUCTIONS,
      })
    }
    if (method === 'ping') return reply({})
    if (method === 'tools/list') return reply({ tools: mcpTools(actor) })
    if (method === 'tools/call') {
      var p = msg.params || {}
      var name = String(p.name || '')
      var args = p.arguments || {}
      try {
        var res
        if (name === 'executar_em_lote')
          res = executeBatch(app, actor, args.operacoes, args.atomico === true)
        else if (name === 'desfazer') res = undo(app, actor, str(args.evento_id))
        else res = execute(app, actor, name, args)
        return reply({
          content: [{ type: 'text', text: JSON.stringify(res) }],
          structuredContent: res,
          isError: false,
        })
      } catch (err) {
        // Erro de regra volta como resultado com isError, para o agente se corrigir.
        return reply({ content: [{ type: 'text', text: errMessage(err) }], isError: true })
      }
    }
    return fail(-32601, 'Método não suportado: ' + method)
  }

  var __pegadaCore = {
    VERSION: VERSION,
    OPS: OPS,
    SCOPES: SCOPES,
    resolveActor: resolveActor,
    agentActor: agentActor,
    execute: execute,
    executeBatch: executeBatch,
    undo: undo,
    undoBatch: undoBatch,
    decideProposal: decideProposal,
    createAgent: createAgent,
    revokeAgent: revokeAgent,
    catalog: catalog,
    mcpHandle: mcpHandle,
    meterAgent: meterAgent,
    errMessage: errMessage,
  }

  // ---------------- ROTAS (despacho dentro da mesma função, sem require) ----------------
  var core = __pegadaCore
  var metodo = String(e.request.method || '').toUpperCase()
  var caminho = String(e.request.url.path || '').replace(/\/+$/, '')
  var resto = caminho.split('/backend/v1/pegada/')[1] || ''
  var p = resto.split('/')

  function corpo() {
    return e.requestInfo().body || {}
  }

  function mcp(tokenUrl) {
    var actor
    try {
      actor = core.resolveActor(e, tokenUrl)
    } catch (err) {
      if (!tokenUrl) e.response.header().set('WWW-Authenticate', 'Bearer realm="pegada"')
      return e.json(401, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: core.errMessage(err) },
      })
    }
    if (!tokenUrl && actor.type !== 'agente') {
      return e.json(403, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'O MCP é para agentes: crie um agente no app e use o token dele.',
        },
      })
    }
    var body = e.requestInfo().body
    var msgs = Array.isArray(body) ? body : [body]
    var out = []
    for (var i = 0; i < msgs.length; i++) {
      var r = core.mcpHandle(e.app, actor, msgs[i])
      if (r) out.push(r)
    }
    if (out.length === 0) return e.noContent(202)
    return e.json(200, Array.isArray(body) ? out : out[0])
  }

  // Preferência de privacidade da IA: devolve o estado e, se vier corpo, grava.
  function iaPreferencia() {
    var actor = core.resolveActor(e)
    if (actor.type === 'agente') throw new ForbiddenError('Esta rota é do app.')
    var dono = e.app.findRecordById('users', actor.userId)
    var body = corpo()
    var mudou = false
    if (typeof body.desligada === 'boolean') {
      dono.set('ai_off', body.desligada)
      mudou = true
    }
    if (body.aviso_visto === true && !dono.getString('ai_notice_at')) {
      dono.set('ai_notice_at', new Date().toISOString().replace('T', ' '))
      mudou = true
    }
    if (mudou) e.app.save(dono)
    return e.json(200, {
      disponivel: !!$os.getenv('ANTHROPIC_API_KEY'),
      desligada: dono.getBool('ai_off'),
      aviso_visto: !!dono.getString('ai_notice_at'),
    })
  }

  function iaSugerir() {
    var actor = core.resolveActor(e)
    if (actor.type === 'agente')
      throw new ForbiddenError('Agentes já têm a própria IA; esta rota é do app.')
    // Nível 1: chama o Claude pela API da Anthropic. Segredos do servidor:
    //   ANTHROPIC_API_KEY  liga a IA embutida (sem ela, 503 honesto)
    //   PEGADA_IA_MODELO   opcional, padrão claude-sonnet-5-5
    //   PEGADA_IA_URL      só para testes (simulador local)
    var apiKey = $os.getenv('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return e.json(503, { message: 'IA embutida indisponível neste servidor.' })
    }
    // Privacidade: a pessoa pode desligar a IA, e nada é enviado antes de ela
    // ler o aviso de que o texto do pedido vai à Anthropic.
    var dono = e.app.findRecordById('users', actor.userId)
    if (dono.getBool('ai_off'))
      return e.json(403, { message: 'A IA está desligada em Configurações.' })
    if (!dono.getString('ai_notice_at'))
      return e.json(428, { message: 'Leia o aviso de privacidade da IA antes de usá-la.' })
    var body = corpo()
    var tipo = String(body.tipo || '')
    var texto = String(body.texto || '').slice(0, 2000)
    if (!texto) throw new BadRequestError('Envie o texto.')
    var guide = {
      resultado:
        'Reescreva como RESULTADO do método Pegada: um estado alcançado, verificável, com prazo AAAA-MM-DD se o texto der pista. Responda JSON {"titulo": "...", "prazo": "AAAA-MM-DD ou vazio", "por_que": "uma frase"}.',
      avanco:
        'Reescreva como AVANÇO: título curto começando por verbo e o tipo entre acao, compromisso, estudo, reflexao, ideia, espera. Responda JSON {"titulo": "...", "tipo": "...", "por_que": "uma frase"}.',
      proposito:
        'Proponha uma frase de propósito no formato "Eu existo para [verbo] [quem ou o quê], para que [mudança]." Responda JSON {"texto": "...", "por_que": "uma frase"}.',
      captura:
        'Classifique a captura: destino entre avanco, resultado, responsabilidade, estrategia; se avanco, o tipo. Responda JSON {"destino": "...", "tipo": "...", "titulo": "...", "por_que": "uma frase"}.',
      // Desdobrar: descer um degrau da escada, sempre como sugestões selecionáveis.
      desdobrar_papel:
        'A pessoa descreve um PAPEL que vive (pai, sócia, líder). Traduza em 3 a 5 RESPONSABILIDADES: compromissos contínuos, com padrão a manter e sem linha de chegada, escritos como "Cuidar de…" ou "Zelar por…". Para cada uma, o contexto: vida ou trabalho. Responda JSON {"sugestoes": [{"titulo": "...", "contexto": "vida ou trabalho", "por_que": "uma frase"}]}.',
      desdobrar_responsabilidade:
        'A pessoa informa uma RESPONSABILIDADE. Proponha 2 a 4 RESULTADOS que nascem dela: estados futuros e verificáveis, escritos como algo já pronto, com prazo AAAA-MM-DD só se fizer sentido. Responda JSON {"sugestoes": [{"titulo": "...", "prazo": "AAAA-MM-DD ou vazio", "por_que": "uma frase"}]}.',
      desdobrar_resultado:
        'A pessoa informa um RESULTADO. Proponha 2 a 3 ESTRATÉGIAS: apostas diferentes sobre o caminho, escritas como "Por meio de…", que podem ser trocadas sem mudar o resultado. Responda JSON {"sugestoes": [{"titulo": "...", "por_que": "uma frase"}]}.',
      desdobrar_estrategia:
        'A pessoa informa uma ESTRATÉGIA e o resultado a que ela serve. Proponha 3 a 5 AVANÇOS concretos: título curto começando por verbo e o tipo entre acao, compromisso, estudo, reflexao, ideia, espera. Responda JSON {"sugestoes": [{"titulo": "...", "tipo": "...", "por_que": "uma frase"}]}.',
      // Correção gentil: confere se o texto é mesmo um resultado.
      conferir_resultado:
        'A pessoa está criando um RESULTADO (estado futuro e verificável, com linha de chegada). Diga o que o texto é de fato: resultado, responsabilidade (padrão a manter, sem linha de chegada), estrategia (um caminho que serve a outro estado) ou proposito (nunca se conclui). Responda JSON {"e": "resultado|responsabilidade|estrategia|proposito", "por_que": "uma frase gentil, começando por Isto"}.',
    }[tipo]
    if (!guide) throw new BadRequestError('tipo de sugestão desconhecido.')
    var baseUrl = ($os.getenv('PEGADA_IA_URL') || 'https://api.anthropic.com').replace(/\/$/, '')
    var modelo = $os.getenv('PEGADA_IA_MODELO') || 'claude-sonnet-5-5'
    var res = null
    try {
      res = $http.send({
        url: baseUrl + '/v1/messages',
        method: 'POST',
        timeout: 30,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2026-10-21',
          'anthropic-beta': 'server-side-fallback-2026-07-01',
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 2000,
          output_config: { effort: 'low' },
          fallbacks: 'default',
          system:
            'Você ajuda a aplicar o método Pegada. ' +
            guide +
            ' Responda só o JSON, em português do Brasil.',
          messages: [{ role: 'user', content: texto }],
        }),
      })
    } catch (_) {
      return e.json(502, { message: 'A IA não respondeu. Tente de novo.' })
    }
    if (!res || res.statusCode !== 200 || !res.json) {
      return e.json(502, { message: 'A IA não respondeu. Tente de novo.' })
    }
    if (res.json.stop_reason === 'refusal') {
      return e.json(502, {
        message: 'A IA não quis sugerir para este texto. Escreva com suas palavras.',
      })
    }
    var content = ''
    var blocos = Array.isArray(res.json.content) ? res.json.content : []
    for (var bi = 0; bi < blocos.length; bi++) {
      if (blocos[bi] && blocos[bi].type === 'text') content += String(blocos[bi].text || '')
    }
    var sugestao = null
    try {
      // Só o trecho entre a primeira "{" e a última "}": a IA às vezes
      // escreve uma frase ou uma cerca de código em volta do JSON.
      var bruto = String(content)
      var ini = bruto.indexOf('{')
      var fim = bruto.lastIndexOf('}')
      sugestao = JSON.parse(ini >= 0 && fim > ini ? bruto.slice(ini, fim + 1) : bruto.trim())
    } catch (_) {
      sugestao = null
    }
    if (!sugestao)
      return e.json(502, { message: 'A IA não devolveu uma sugestão válida. Tente de novo.' })
    return e.json(200, { tipo: tipo, sugestao: sugestao, origem: 'ia_embutida' })
  }

  if (metodo === 'GET') {
    if (p[0] === 'operacoes' && p.length === 1) {
      var visitante = null
      try {
        visitante = core.resolveActor(e)
      } catch (_) {
        visitante = null
      }
      return e.json(200, { versao: core.VERSION, operacoes: core.catalog(visitante) })
    }
    if (p[0] === 'mcp') return e.json(405, { message: 'Use POST (MCP Streamable HTTP, sem SSE).' })
    throw new NotFoundError('Rota do Pegada não encontrada.')
  }

  if (p[0] === 'mcp' && p.length === 1) return mcp('')
  if (p[0] === 'mcp' && p.length === 2) return mcp(p[1])
  if (p[0] === 'ia' && p[1] === 'sugerir' && p.length === 2) return iaSugerir()
  if (p[0] === 'ia' && p[1] === 'preferencia' && p.length === 2) return iaPreferencia()

  var ator = core.resolveActor(e)
  if (p[0] === 'op' && p.length === 2) return e.json(200, core.execute(e.app, ator, p[1], corpo()))
  if (p[0] === 'lote' && p.length === 1) {
    var lote = corpo()
    return e.json(200, core.executeBatch(e.app, ator, lote.operacoes, lote.atomico === true))
  }
  if (p[0] === 'desfazer' && p.length === 2) return e.json(200, core.undo(e.app, ator, p[1]))
  if (p[0] === 'desfazer-lote' && p.length === 2)
    return e.json(200, core.undoBatch(e.app, ator, p[1]))
  if (p[0] === 'propostas' && p.length === 3 && p[2] === 'confirmar')
    return e.json(200, core.decideProposal(e.app, ator, p[1], true))
  if (p[0] === 'propostas' && p.length === 3 && p[2] === 'recusar')
    return e.json(200, core.decideProposal(e.app, ator, p[1], false))
  if (p[0] === 'agentes' && p.length === 1)
    return e.json(200, core.createAgent(e.app, ator, corpo()))
  if (p[0] === 'agentes' && p.length === 3 && p[2] === 'revogar')
    return e.json(200, core.revokeAgent(e.app, ator, p[1]))
  throw new NotFoundError('Rota do Pegada não encontrada.')
}

routerAdd('GET', '/backend/v1/pegada/operacoes', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/op/{nome}', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/lote', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/desfazer/{eventoId}', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/desfazer-lote/{loteId}', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/propostas/{id}/confirmar', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/propostas/{id}/recusar', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/agentes', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/agentes/{id}/revogar', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/mcp', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/mcp/{token}', pegadaRota)
routerAdd('GET', '/backend/v1/pegada/mcp', pegadaRota)
routerAdd('GET', '/backend/v1/pegada/mcp/{token}', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/ia/sugerir', pegadaRota)
routerAdd('POST', '/backend/v1/pegada/ia/preferencia', pegadaRota)
