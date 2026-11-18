// FATIA 4A — ESTRATÉGIAS LOCAIS AO RESULTADO: FUNDAÇÃO E VÍNCULOS.
//
// Migration aditiva (sem backfill, sem seeds, sem tocar registros existentes):
// 1. Coleção `strategies`: grupo local de caminho DENTRO de um Resultado.
//    - user_id: dono (relação obrigatória a users).
//    - project_id: Resultado ao qual pertence, FIXO (relação obrigatória).
//    - title: texto simples obrigatório, até 200, só de espaços inválido.
//    - description: texto simples opcional, até 3000; sem HTML/editor rico.
//    - status: ativa|arquivada (criação normal começa ativa quando omitido —
//      default aplicado no hook strategy-guards).
//    Sem context/responsibility_id duplicados (contexto/Responsabilidade são os
//    do Resultado vigente), sem sequence_number/contador/código, sem subtarefas,
//    tags, ordenação manual ou catálogo global. Títulos não são únicos (ID
//    nativo identifica o grupo local). Exclusão definitiva bloqueada pela API
//    comum (deleteRule locked) — arquivar/desarquivar é via status.
// 2. actions.strategy_id: relação singular OPCIONAL a strategies, vazia por
//    padrão, SEM cascadeDelete (nada desvincula em lote na exclusão/arquivamento).
//    projects NÃO recebe strategy_id.
// 3. Índices NÃO únicos para leitura por dono, por Resultado e por estratégia.
//    Nenhuma unicidade/contador/índice da numeração (sequence_number) é tocado.
// Regras: mesmo padrão da base (0003/0011) — dono obrigatório, user_id e
// project_id imutáveis no update (fallback :isset, pré-v0.23), relação de
// Avanço no update aponta para estratégia do próprio dono (verificação
// grosseira na regra; a validação real — existência, dono, mesmo Resultado,
// ativa em vínculo novo, coerência de patch — fica no hook strategy-guards).
migrate(
  (app) => {
    // ---------- 1. Coleção strategies ----------
    let stratCol = null
    try {
      stratCol = app.findCollectionByNameOrId('strategies')
    } catch (_) {
      stratCol = null
    }
    if (!stratCol) {
      stratCol = new Collection({
        name: 'strategies',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule:
          "@request.auth.id != '' && user_id = @request.auth.id && " +
          '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
          '(@request.body.project_id:isset = false || @request.body.project_id = project_id)',
        // Exclusão definitiva não existe na API comum: arquivar via status.
        deleteRule: null,
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: '_pb_users_auth_',
            cascadeDelete: true,
            maxSelect: 1,
          },
          // Resultado ao qual a Estratégia pertence — FIXO, imutável pela API.
          {
            name: 'project_id',
            type: 'relation',
            required: true,
            collectionId: app.findCollectionByNameOrId('projects').id,
            cascadeDelete: false,
            maxSelect: 1,
          },
          // Título simples obrigatório, até 200; só de espaços é inválido.
          { name: 'title', type: 'text', required: true, max: 200, pattern: '\\S' },
          // Descrição simples opcional, até 3000; sem HTML/editor rico.
          { name: 'description', type: 'text', max: 3000 },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['ativa', 'arquivada'],
            maxSelect: 1,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_strategies_user ON strategies (user_id)',
          'CREATE INDEX idx_strategies_project ON strategies (project_id)',
          'CREATE INDEX idx_strategies_user_project ON strategies (user_id, project_id)',
          'CREATE INDEX idx_strategies_user_status ON strategies (user_id, status)',
        ],
      })
      app.save(stratCol)
      stratCol = app.findCollectionByNameOrId('strategies')
    }
    const stratColId = stratCol.id

    // ---------- 2. actions.strategy_id ----------
    const actions = app.findCollectionByNameOrId('actions')
    if (!actions.fields.getByName('strategy_id')) {
      actions.fields.add(
        new RelationField({
          name: 'strategy_id',
          collectionId: stratColId,
          required: false,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      // Mesmo padrão de 0003/0011 para relações alteradas no update (fallback
      // :isset — modificador :changed não é suportado nesta instância).
      actions.updateRule =
        actions.updateRule +
        " && (@request.body.strategy_id:isset = false || strategy_id = '' || " +
        "@request.body.strategy_id = '' || strategy_id.user_id = @request.auth.id)"
      actions.addIndex('idx_actions_strategy', false, 'strategy_id', '')
      app.save(actions)
    }

    // Exclusão comum de Resultados já é bloqueada (security-guards: 403 em
    // onRecordDeleteRequest de 'projects') — preservada sem duplicação aqui.
  },
  (app) => {
    // Rollback: remove campo/índice novos de actions e restaura a regra de
    // update vigente antes desta fatia; depois remove a coleção.
    const actions = app.findCollectionByNameOrId('actions')
    if (actions.fields.getByName('strategy_id')) {
      actions.removeIndex('idx_actions_strategy')
      actions.fields.removeByName('strategy_id')
      actions.updateRule =
        "@request.auth.id != '' && user_id = @request.auth.id && " +
        '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
        "(@request.body.project_id:isset = false || project_id = '' || " +
        "@request.body.project_id = '' || project_id.user_id = @request.auth.id) && " +
        "(@request.body.responsibility_id:isset = false || responsibility_id = '' || " +
        "@request.body.responsibility_id = '' || responsibility_id.user_id = @request.auth.id)"
      app.save(actions)
    }

    try {
      const stratCol = app.findCollectionByNameOrId('strategies')
      app.delete(stratCol)
    } catch (_) {}
  },
)
