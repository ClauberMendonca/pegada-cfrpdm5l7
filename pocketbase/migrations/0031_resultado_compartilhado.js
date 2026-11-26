// PEGADA — RESULTADO COMPARTILHADO E DELEGAÇÃO (aditiva, idempotente).
//
// O método continua sendo da pessoa: só o Resultado e o que está abaixo dele
// (Estratégias e Avanços) pode ser compartilhado. Propósito, Vontades e
// Responsabilidades nunca aparecem para os outros.
//
// Como fica no banco:
// - projects.user_id continua sendo o DONO do resultado; projects.member_ids
//   guarda os participantes ativos (sem o dono).
// - result_members guarda o convite e o vínculo pessoal de cada participante:
//   a Responsabilidade ou a Vontade DELE em que o resultado se encaixa.
// - actions.user_id passa a significar o RESPONSÁVEL pelo avanço. Delegar é
//   trocar o responsável; actions.delegated_by lembra quem passou. Assim o
//   Hoje, o fio e os limites de cada pessoa seguem valendo sem mudança.
// - notices: avisos discretos do app (convite, avanço recebido, devolvido,
//   concluído, resultado encerrado).
// - audit_events.project_id: o histórico de um resultado, visto por quem
//   participa dele.
//
// Leitura: quem é dono ou participante lê o resultado, as estratégias, os
// avanços e as notas dele. Quem saiu perde a leitura na hora. Escrita: só
// pela API do método, como sempre.
migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    const exists = (name) => {
      try {
        app.findCollectionByNameOrId(name)
        return true
      } catch (_) {
        return false
      }
    }
    const auth = "@request.auth.id != ''"
    const meu = 'user_id = @request.auth.id'
    const doResultado =
      '(project_id.user_id = @request.auth.id || project_id.member_ids.id ?= @request.auth.id)'

    // ---------- projects ----------
    const projects = app.findCollectionByNameOrId('projects')
    if (!projects.fields.getByName('member_ids')) {
      projects.fields.add(
        new RelationField({
          name: 'member_ids',
          collectionId: usersId,
          maxSelect: 50,
          cascadeDelete: false,
        }),
      )
    }
    const lerResultado = auth + ' && (' + meu + ' || member_ids.id ?= @request.auth.id)'
    projects.listRule = lerResultado
    projects.viewRule = lerResultado
    app.save(projects)

    // ---------- strategies ----------
    const strategies = app.findCollectionByNameOrId('strategies')
    const lerEstrategia = auth + ' && ' + doResultado
    strategies.listRule = lerEstrategia
    strategies.viewRule = lerEstrategia
    app.save(strategies)

    // ---------- actions ----------
    const actions = app.findCollectionByNameOrId('actions')
    if (!actions.fields.getByName('delegated_by')) {
      actions.fields.add(
        new RelationField({
          name: 'delegated_by',
          collectionId: usersId,
          maxSelect: 1,
          cascadeDelete: false,
        }),
      )
    }
    if (!actions.fields.getByName('delegated_at')) {
      actions.fields.add(new DateField({ name: 'delegated_at' }))
    }
    // Avanço sem resultado: só o responsável. Avanço de um resultado: quem
    // participa do resultado (o responsável que saiu deixa de ler).
    const lerAvanco = auth + " && ((project_id = '' && " + meu + ') || ' + doResultado + ')'
    actions.listRule = lerAvanco
    actions.viewRule = lerAvanco
    app.save(actions)

    // ---------- progress_logs (notas e progresso) ----------
    const logs = app.findCollectionByNameOrId('progress_logs')
    const lerNota =
      auth +
      ' && (' +
      meu +
      ' || ' +
      doResultado +
      ' || action_id.project_id.user_id = @request.auth.id' +
      ' || action_id.project_id.member_ids.id ?= @request.auth.id)'
    logs.listRule = lerNota
    logs.viewRule = lerNota
    app.save(logs)

    // ---------- result_members ----------
    if (!exists('result_members')) {
      const ler = auth + ' && (' + meu + ' || ' + doResultado + ')'
      app.save(
        new Collection({
          name: 'result_members',
          type: 'base',
          listRule: ler,
          viewRule: ler,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            {
              name: 'project_id',
              type: 'relation',
              required: true,
              collectionId: projects.id,
              maxSelect: 1,
              cascadeDelete: true,
            },
            {
              name: 'user_id',
              type: 'relation',
              required: true,
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: true,
            },
            {
              name: 'invited_by',
              type: 'relation',
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: false,
            },
            {
              name: 'status',
              type: 'select',
              required: true,
              maxSelect: 1,
              values: ['convidado', 'ativo', 'recusado', 'saiu', 'removido'],
            },
            // O porquê DESTA pessoa: ids de registros dela. Nunca aparecem
            // para os outros (a regra de leitura dessas coleções é só do dono).
            { name: 'responsibility_id', type: 'text', max: 40 },
            { name: 'wish_id', type: 'text', max: 40 },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: [
            'CREATE UNIQUE INDEX idx_result_members_par ON result_members (project_id, user_id)',
            'CREATE INDEX idx_result_members_user ON result_members (user_id, status)',
          ],
        }),
      )
    }

    // ---------- notices ----------
    if (!exists('notices')) {
      const proprio = auth + ' && ' + meu
      app.save(
        new Collection({
          name: 'notices',
          type: 'base',
          listRule: proprio,
          viewRule: proprio,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            {
              name: 'user_id',
              type: 'relation',
              required: true,
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: true,
            },
            // convite | convite_aceito | convite_recusado | avanco_recebido |
            // avanco_devolvido | avanco_concluido | resultado_encerrado |
            // saiu | removido | posse_recebida
            { name: 'kind', type: 'text', required: true, max: 40 },
            { name: 'text', type: 'text', required: true, max: 500 },
            { name: 'actor_name', type: 'text', max: 120 },
            { name: 'project_id', type: 'text', max: 40 },
            { name: 'action_id', type: 'text', max: 40 },
            { name: 'member_id', type: 'text', max: 40 },
            { name: 'read_at', type: 'date' },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          ],
          indexes: ['CREATE INDEX idx_notices_user ON notices (user_id, read_at, created)'],
        }),
      )
    }

    // ---------- audit_events ----------
    const audit = app.findCollectionByNameOrId('audit_events')
    if (!audit.fields.getByName('project_id')) {
      audit.fields.add(new TextField({ name: 'project_id', max: 40 }))
      audit.addIndex('idx_audit_project', false, 'project_id, created', '')
      app.save(audit)
    }
  },
  (app) => {
    const owner = "@request.auth.id != '' && user_id = @request.auth.id"
    for (const name of ['projects', 'strategies', 'actions', 'progress_logs']) {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = owner
      col.viewRule = owner
      app.save(col)
    }
    for (const name of ['notices', 'result_members']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (_) {}
    }
  },
)
