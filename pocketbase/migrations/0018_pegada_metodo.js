// PEGADA — MODELO DO MÉTODO (aditiva, idempotente, sem apagar dados).
//
// Alinha o banco ao método Pegada sem renomear coleções (renomear quebraria
// dados e telas). Mapa de nomes:
//   projects          = Resultados
//   actions           = Avanços
//   strategies        = Estratégias (a aposta)
//   responsibilities  = Responsabilidades
//   users.life_purpose = Propósito
//   captures          = Capturas
//
// Mudanças:
// 1. actions.kind — os seis tipos de avanço (acao, compromisso, estudo,
//    reflexao, ideia, espera). Vazio em registros antigos = 'acao'.
// 2. actions.trail — o rastro: conclusão, decisão ou destino exigido para
//    concluir Estudo, Reflexão e Ideia (regra do rastro).
// 3. projects.status ganha 'futuro' (lista de futuros) e 'abandonado'
//    (decisão legítima da revisão trimestral).
// 4. responsibilities.chosen_by — 'mim' | 'para_mim' (escolhida por mim ou
//    para mim). Vazio em registros antigos = não informado.
// 5. strategies.test_signal — o sinal de teste da aposta (opcional).
// 6. captures: destinos novos (Responsabilidade e Estratégia), com vínculos.
// 7. Escrita direta pelas coleções do núcleo do método fica BLOQUEADA
//    (create/update = null). Toda escrita passa pela API do método
//    (/backend/v1/pegada/*), que valida as regras no servidor e registra
//    quem fez o quê. Leitura continua igual (só o dono).
migrate(
  (app) => {
    const ensureField = (col, field) => {
      if (!col.fields.getByName(field.name)) col.fields.add(field)
    }

    // ---------- actions ----------
    const actions = app.findCollectionByNameOrId('actions')
    ensureField(
      actions,
      new SelectField({
        name: 'kind',
        maxSelect: 1,
        values: ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia', 'espera'],
      }),
    )
    ensureField(actions, new TextField({ name: 'trail', max: 3000 }))
    actions.createRule = null
    actions.updateRule = null
    app.save(actions)

    // ---------- projects (Resultados) ----------
    const projects = app.findCollectionByNameOrId('projects')
    const pStatus = projects.fields.getByName('status')
    const wanted = [
      'rascunho',
      'futuro',
      'ativo',
      'pausado',
      'concluido',
      'abandonado',
      'arquivado',
    ]
    pStatus.values = wanted
    projects.createRule = null
    projects.updateRule = null
    app.save(projects)

    // ---------- responsibilities ----------
    const resp = app.findCollectionByNameOrId('responsibilities')
    ensureField(
      resp,
      new SelectField({ name: 'chosen_by', maxSelect: 1, values: ['mim', 'para_mim'] }),
    )
    resp.createRule = null
    resp.updateRule = null
    app.save(resp)

    // ---------- strategies ----------
    const strat = app.findCollectionByNameOrId('strategies')
    ensureField(strat, new TextField({ name: 'test_signal', max: 1000 }))
    strat.createRule = null
    strat.updateRule = null
    app.save(strat)

    // ---------- captures ----------
    const captures = app.findCollectionByNameOrId('captures')
    const cStatus = captures.fields.getByName('status')
    cStatus.values = [
      'pendente',
      'convertida_projeto',
      'convertida_acao',
      'convertida_responsabilidade',
      'convertida_estrategia',
      'descartada',
    ]
    ensureField(
      captures,
      new RelationField({
        name: 'converted_responsibility_id',
        collectionId: resp.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    )
    ensureField(
      captures,
      new RelationField({
        name: 'converted_strategy_id',
        collectionId: strat.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    )
    captures.createRule = null
    captures.updateRule = null
    app.save(captures)
  },
  (app) => {
    // Rollback não destrutivo: só devolve a escrita direta ao dono.
    const owner = "@request.auth.id != '' && user_id = @request.auth.id"
    for (const name of ['actions', 'projects', 'responsibilities', 'strategies', 'captures']) {
      const col = app.findCollectionByNameOrId(name)
      col.createRule = owner
      col.updateRule =
        owner + ' && (@request.body.user_id:isset = false || @request.body.user_id = user_id)'
      app.save(col)
    }
  },
)
