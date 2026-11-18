// FATIA 3A — RESPONSABILIDADES: BASE, VÍNCULOS E REGRAS.
//
// Migration aditiva (sem backfill, sem seeds, sem tocar registros):
// 1. Coleção `responsibilities`: compromisso contínuo do dono, contexto
//    vida|trabalho, status ativa|arquivada (criação normal começa ativa
//    quando omitido — default aplicado no hook responsibility-guards).
//    Sem sequence_number, sem contador, sem código R/AV. Títulos não são
//    únicos (ID nativo identifica). Exclusão definitiva bloqueada pela API
//    comum (deleteRule locked) — arquivar/desarquivar é via status.
// 2. Campos de vínculo OPCIONAIS de relação única (máx. 1 destino, vazio por
//    padrão, SEM cascade delete):
//    - projects.responsibility_id → a Responsabilidade do Resultado;
//    - actions.responsibility_id  → SOMENTE vínculo DIRETO do Avanço SOLTO.
//    Mesmo nome técnico, sentidos definidos pelos contratos (ver hook
//    responsibility-guards.pb.js e comentários em src/types/execution.ts).
// 3. Índices não únicos para consulta por dono/vínculo. Nenhum índice ou
//    contador da numeração (sequence_number) é tocado.
// Regras: mesmo padrão da base (0003) — dono obrigatório, user_id imutável no
// update (fallback :isset, pré-v0.23), relações enviadas no update apontam
// para registro do próprio dono (verificação grosseira na regra; a validação
// real — existência, dono, contexto, ativa, hierarquia — fica nos hooks).
migrate(
  (app) => {
    // ---------- 1. Coleção responsibilities ----------
    let respCol = null
    try {
      respCol = app.findCollectionByNameOrId('responsibilities')
    } catch (_) {
      respCol = null
    }
    if (!respCol) {
      respCol = new Collection({
        name: 'responsibilities',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule:
          "@request.auth.id != '' && user_id = @request.auth.id && " +
          '(@request.body.user_id:isset = false || @request.body.user_id = user_id)',
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
          // Título simples obrigatório, até 200; só de espaços é inválido.
          { name: 'title', type: 'text', required: true, max: 200, pattern: '\\S' },
          // Descrição simples opcional, até 3000; sem HTML/editor rico.
          { name: 'description', type: 'text', max: 3000 },
          {
            name: 'context',
            type: 'select',
            required: true,
            values: ['vida', 'trabalho'],
            maxSelect: 1,
          },
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
          'CREATE INDEX idx_responsibilities_user ON responsibilities (user_id)',
          'CREATE INDEX idx_responsibilities_user_context ON responsibilities (user_id, context)',
          'CREATE INDEX idx_responsibilities_user_status ON responsibilities (user_id, status)',
        ],
      })
      app.save(respCol)
      respCol = app.findCollectionByNameOrId('responsibilities')
    }
    const respColId = respCol.id

    // ---------- 2. projects.responsibility_id ----------
    const projects = app.findCollectionByNameOrId('projects')
    if (!projects.fields.getByName('responsibility_id')) {
      projects.fields.add(
        new RelationField({
          name: 'responsibility_id',
          collectionId: respColId,
          required: false,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      // Mesmo padrão de 0003 para relações alteradas no update (fallback :isset).
      projects.updateRule =
        projects.updateRule +
        " && (@request.body.responsibility_id:isset = false || responsibility_id = '' || " +
        "@request.body.responsibility_id = '' || responsibility_id.user_id = @request.auth.id)"
      projects.addIndex('idx_projects_responsibility', false, 'responsibility_id', '')
      app.save(projects)
    }

    // ---------- 3. actions.responsibility_id ----------
    const actions = app.findCollectionByNameOrId('actions')
    if (!actions.fields.getByName('responsibility_id')) {
      actions.fields.add(
        new RelationField({
          name: 'responsibility_id',
          collectionId: respColId,
          required: false,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      actions.updateRule =
        actions.updateRule +
        " && (@request.body.responsibility_id:isset = false || responsibility_id = '' || " +
        "@request.body.responsibility_id = '' || responsibility_id.user_id = @request.auth.id)"
      actions.addIndex('idx_actions_responsibility', false, 'responsibility_id', '')
      app.save(actions)
    }
  },
  (app) => {
    // Rollback: remove campos/índices novos e restaura as regras anteriores
    // às strings vigentes antes desta fatia; depois remove a coleção.
    const projects = app.findCollectionByNameOrId('projects')
    if (projects.fields.getByName('responsibility_id')) {
      projects.removeIndex('idx_projects_responsibility')
      projects.fields.removeByName('responsibility_id')
      projects.updateRule =
        "@request.auth.id != '' && user_id = @request.auth.id && " +
        '(@request.body.user_id:isset = false || @request.body.user_id = user_id)'
      app.save(projects)
    }

    const actions = app.findCollectionByNameOrId('actions')
    if (actions.fields.getByName('responsibility_id')) {
      actions.removeIndex('idx_actions_responsibility')
      actions.fields.removeByName('responsibility_id')
      actions.updateRule =
        "@request.auth.id != '' && user_id = @request.auth.id && " +
        '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
        "(@request.body.project_id:isset = false || project_id = '' || " +
        "@request.body.project_id = '' || project_id.user_id = @request.auth.id)"
      app.save(actions)
    }

    try {
      const respCol = app.findCollectionByNameOrId('responsibilities')
      app.delete(respCol)
    } catch (_) {}
  },
)
