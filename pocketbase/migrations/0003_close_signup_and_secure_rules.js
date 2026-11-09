migrate(
  (app) => {
    // Correção P0 de segurança (não recria nem apaga dados):
    // - users: cadastro público fechado (createRule locked), owner-only em update,
    //   delete bloqueado pela API comum (superusuário preserva acesso via painel);
    // - coleções de produto: create exige sessão e dono = autenticado, update impede
    //   troca de user_id e valida relações alteradas, delete bloqueado pela API comum.
    // Regras locked (null) permitem apenas superusuário; string vazia NUNCA é usada como bloqueio.
    // NOTA: esta instância PocketBase não suporta o modificador :changed (v0.23+);
    // usa-se o fallback equivalente: (:isset = false || body = valor atual do campo).

    const locked = null // locked = apenas superusuário (painel admin)

    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    users.createRule = locked
    users.deleteRule = locked
    // list/view/update permanecem no escopo do próprio registro
    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.updateRule = 'id = @request.auth.id'
    app.save(users)

    for (const name of ['projects', 'actions', 'captures', 'progress_logs']) {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = "@request.auth.id != '' && user_id = @request.auth.id"
      col.viewRule = "@request.auth.id != '' && user_id = @request.auth.id"
      col.createRule = "@request.auth.id != '' && user_id = @request.auth.id"
      // update: dono tem que continuar sendo o autenticado (rascunho avaliado na regra);
      // se o cliente enviar user_id diferente do atual, a regra falha
      col.updateRule =
        "@request.auth.id != '' && user_id = @request.auth.id && " +
        '(@request.body.user_id:isset = false || @request.body.user_id = user_id)'
      // exclusão definitiva apenas via painel admin (superusuário)
      col.deleteRule = locked
      app.save(col)
    }

    const actions = app.findCollectionByNameOrId('actions')
    // actions: project_id, quando enviado/alterado, deve apontar para projeto do próprio dono
    actions.updateRule =
      "@request.auth.id != '' && user_id = @request.auth.id && " +
      '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
      "(@request.body.project_id:isset = false || project_id = '' || " +
      "@request.body.project_id = '' || project_id.user_id = @request.auth.id)"
    app.save(actions)

    const captures = app.findCollectionByNameOrId('captures')
    // captures: relações de conversão, quando enviadas, devem apontar para registros do próprio dono
    captures.updateRule =
      "@request.auth.id != '' && user_id = @request.auth.id && " +
      '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
      "(@request.body.converted_project_id:isset = false || converted_project_id = '' || " +
      "@request.body.converted_project_id = '' || converted_project_id.user_id = @request.auth.id) && " +
      "(@request.body.converted_action_id:isset = false || converted_action_id = '' || " +
      "@request.body.converted_action_id = '' || converted_action_id.user_id = @request.auth.id)"
    app.save(captures)

    const progressLogs = app.findCollectionByNameOrId('progress_logs')
    // progress_logs: relações enviadas devem apontar para registros do próprio dono
    progressLogs.updateRule =
      "@request.auth.id != '' && user_id = @request.auth.id && " +
      '(@request.body.user_id:isset = false || @request.body.user_id = user_id) && ' +
      "(@request.body.project_id:isset = false || project_id = '' || " +
      "@request.body.project_id = '' || project_id.user_id = @request.auth.id) && " +
      "(@request.body.action_id:isset = false || action_id = '' || " +
      "@request.body.action_id = '' || action_id.user_id = @request.auth.id)"
    app.save(progressLogs)
  },
  (app) => {
    // rollback: restaura regras anteriores
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    users.createRule = ''
    users.deleteRule = "@request.auth.id != '' && id = @request.auth.id"
    users.listRule = 'id = @request.auth.id'
    users.viewRule = 'id = @request.auth.id'
    users.updateRule = 'id = @request.auth.id'
    app.save(users)

    for (const name of ['projects', 'actions', 'captures', 'progress_logs']) {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = "@request.auth.id != '' && user_id = @request.auth.id"
      col.viewRule = "@request.auth.id != '' && user_id = @request.auth.id"
      col.createRule = "@request.auth.id != ''"
      col.updateRule = "@request.auth.id != '' && user_id = @request.auth.id"
      col.deleteRule = "@request.auth.id != '' && user_id = @request.auth.id"
      app.save(col)
    }
  },
)
