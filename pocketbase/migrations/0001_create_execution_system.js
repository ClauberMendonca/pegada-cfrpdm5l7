migrate(
  (app) => {
    // Update users collection if needed: add timezone field
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    if (!users.fields.getByName('timezone')) {
      users.fields.add(new TextField({ name: 'timezone' }))
      app.save(users)
    }

    // 1. Projects collection
    const projects = new Collection({
      name: 'projects',
      type: 'base',
      listRule: "@request.auth.id != '' && user_id = @request.auth.id",
      viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true },
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
          values: ['rascunho', 'ativo', 'pausado', 'concluido', 'arquivado'],
          maxSelect: 1,
        },
        { name: 'aspiration', type: 'text' }, // o que quero alcançar
        { name: 'controllable_delivery', type: 'text' }, // o que vou entregar (controlável)
        { name: 'completion_condition', type: 'text' }, // condição clara de término
        { name: 'deadline', type: 'text' }, // prazo opcional (YYYY-MM-DD)
        { name: 'learning_asset', type: 'text' }, // possível aprendizado ou ativo durável
        // Oito Rs opcionais
        { name: 'r_resultado', type: 'text' },
        { name: 'r_razao', type: 'text' },
        { name: 'r_referencia', type: 'text' },
        { name: 'r_rumo', type: 'text' },
        { name: 'r_recursos', type: 'text' },
        { name: 'r_restricoes', type: 'text' },
        { name: 'r_riscos', type: 'text' },
        { name: 'r_responsavel', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_projects_user ON projects (user_id)',
        'CREATE INDEX idx_projects_status ON projects (user_id, status)',
        'CREATE INDEX idx_projects_context ON projects (user_id, context)',
      ],
    })
    app.save(projects)

    const projectsColId = app.findCollectionByNameOrId('projects').id

    // 2. Actions collection
    const actions = new Collection({
      name: 'actions',
      type: 'base',
      listRule: "@request.auth.id != '' && user_id = @request.auth.id",
      viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'project_id',
          type: 'relation',
          collectionId: projectsColId,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true },
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
          values: ['pronta', 'em_andamento', 'aguardando', 'bloqueada', 'feita', 'cancelada'],
          maxSelect: 1,
        },
        { name: 'deadline', type: 'text' }, // YYYY-MM-DD
        { name: 'is_next_step', type: 'bool' }, // Próximo avanço do Hoje
        { name: 'is_today_selected', type: 'bool' }, // Selecionada explicitamente para Hoje
        { name: 'waiting_for', type: 'text' }, // Detalhes se aguardando/bloqueada
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_actions_user ON actions (user_id)',
        'CREATE INDEX idx_actions_project ON actions (project_id)',
        'CREATE INDEX idx_actions_status ON actions (user_id, status)',
        'CREATE INDEX idx_actions_today ON actions (user_id, is_today_selected)',
      ],
    })
    app.save(actions)

    const actionsColId = app.findCollectionByNameOrId('actions').id

    // 3. Captures collection
    const captures = new Collection({
      name: 'captures',
      type: 'base',
      listRule: "@request.auth.id != '' && user_id = @request.auth.id",
      viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'raw_text', type: 'text', required: true },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['pendente', 'convertida_projeto', 'convertida_acao', 'descartada'],
          maxSelect: 1,
        },
        {
          name: 'converted_project_id',
          type: 'relation',
          collectionId: projectsColId,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'converted_action_id',
          type: 'relation',
          collectionId: actionsColId,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_captures_user ON captures (user_id)',
        'CREATE INDEX idx_captures_status ON captures (user_id, status)',
      ],
    })
    app.save(captures)

    // 4. Progress Logs (Registros de Progresso)
    const progressLogs = new Collection({
      name: 'progress_logs',
      type: 'base',
      listRule: "@request.auth.id != '' && user_id = @request.auth.id",
      viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'project_id',
          type: 'relation',
          collectionId: projectsColId,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'action_id',
          type: 'relation',
          collectionId: actionsColId,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'text', type: 'text', required: true },
        {
          name: 'log_type',
          type: 'select',
          required: true,
          values: ['executei', 'resultado_aconteceu'],
          maxSelect: 1,
        },
        { name: 'date', type: 'text', required: true }, // YYYY-MM-DD
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_progress_user ON progress_logs (user_id)',
        'CREATE INDEX idx_progress_project ON progress_logs (project_id)',
        'CREATE INDEX idx_progress_action ON progress_logs (action_id)',
      ],
    })
    app.save(progressLogs)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('progress_logs'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('captures'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('actions'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('projects'))
    } catch (_) {}
  },
)
