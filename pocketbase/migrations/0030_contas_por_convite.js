// PEGADA — CONTAS POR CONVITE (aditiva, idempotente, sem apagar dados).
//
// Abre o app a outras pessoas sem abrir o cadastro:
// 1. users ganha `role` ('admin' só para quem cuida do sistema) e `disabled`
//    (conta desativada não entra; os dados ficam guardados). Senha passa a
//    ter no mínimo 10 caracteres; a sessão vale 30 dias e o link de nova
//    senha, 30 minutos.
// 2. invites — convite de uso único. O banco guarda só o hash do token.
// 3. access_events — registro de acesso (entradas, falhas, trocas de senha,
//    convites). Nunca guarda senha, token nem conteúdo do método.
// 4. Limite de tentativas de entrada e de recuperação, pelo limitador nativo.
//
// Escrita de invites e access_events: só pelos hooks. Leitura de
// access_events: a própria pessoa (e quem administra, pela rota própria).
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

    // ---------- users ----------
    const users = app.findCollectionByNameOrId(usersId)
    if (!users.fields.getByName('role')) {
      users.fields.add(new SelectField({ name: 'role', maxSelect: 1, values: ['admin'] }))
    }
    if (!users.fields.getByName('disabled')) {
      users.fields.add(new BoolField({ name: 'disabled' }))
    }
    if (!users.fields.getByName('last_seen_at')) {
      users.fields.add(new DateField({ name: 'last_seen_at' }))
    }
    // Limite diário da IA embutida por pessoa (dia em AAAA-MM-DD e contagem).
    if (!users.fields.getByName('ai_day')) {
      users.fields.add(new TextField({ name: 'ai_day', max: 10 }))
    }
    if (!users.fields.getByName('ai_count')) {
      users.fields.add(new NumberField({ name: 'ai_count', onlyInt: true }))
    }
    if (!users.fields.getByName('privacy_notice_at')) {
      users.fields.add(new DateField({ name: 'privacy_notice_at' }))
    }
    const senha = users.fields.getByName('password')
    if (senha) senha.min = 10
    users.authRule = 'disabled = false'
    users.authToken.duration = 30 * 24 * 60 * 60
    users.passwordResetToken.duration = 30 * 60
    app.save(users)

    // Quem administra: a conta de usuário com o mesmo e-mail do superusuário
    // do painel (é assim que o dono foi criado). Sem essa coincidência, a
    // conta mais antiga.
    let temAdmin = false
    try {
      app.findFirstRecordByFilter(usersId, "role = 'admin'")
      temAdmin = true
    } catch (_) {}
    if (!temAdmin) {
      let dono = null
      try {
        const supers = app.findRecordsByFilter('_superusers', "id != ''", 'created', 50, 0)
        for (const s of supers) {
          try {
            dono = app.findFirstRecordByFilter(usersId, 'email = {:e}', { e: s.getString('email') })
            break
          } catch (_) {}
        }
      } catch (_) {}
      if (!dono) {
        try {
          const antigos = app.findRecordsByFilter(usersId, "id != ''", 'created', 1, 0)
          if (antigos.length) dono = antigos[0]
        } catch (_) {}
      }
      if (dono) {
        dono.set('role', 'admin')
        app.save(dono)
      }
    }

    // ---------- invites ----------
    if (!exists('invites')) {
      app.save(
        new Collection({
          name: 'invites',
          type: 'base',
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            { name: 'email', type: 'email', required: true },
            { name: 'token_hash', type: 'text', required: true, hidden: true },
            {
              name: 'invited_by',
              type: 'relation',
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: false,
            },
            { name: 'expires_at', type: 'date', required: true },
            {
              name: 'status',
              type: 'select',
              required: true,
              maxSelect: 1,
              values: ['pendente', 'aceito', 'cancelado'],
            },
            {
              name: 'accepted_user',
              type: 'relation',
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: false,
            },
            { name: 'accepted_at', type: 'date' },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: [
            'CREATE UNIQUE INDEX idx_invites_token ON invites (token_hash)',
            'CREATE INDEX idx_invites_email ON invites (email)',
          ],
        }),
      )
    }

    // ---------- access_events ----------
    if (!exists('access_events')) {
      const proprio = "@request.auth.id != '' && user_id = @request.auth.id"
      app.save(
        new Collection({
          name: 'access_events',
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
              collectionId: usersId,
              maxSelect: 1,
              cascadeDelete: true,
            },
            // entrada | falha_entrada | senha_trocada | recuperacao_pedida |
            // senha_redefinida | email_trocado | conta_criada | convite_criado |
            // convite_cancelado | conta_desativada | conta_reativada |
            // sessoes_encerradas | perfil_editado | agente_criado |
            // agente_revogado | dados_exportados | conta_excluida
            { name: 'kind', type: 'text', required: true, max: 40 },
            { name: 'ip', type: 'text', max: 64 },
            { name: 'agent', type: 'text', max: 200 },
            { name: 'detail', type: 'text', max: 300 },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          ],
          indexes: [
            'CREATE INDEX idx_access_user_created ON access_events (user_id, created)',
            'CREATE INDEX idx_access_created ON access_events (created)',
          ],
        }),
      )
    }

    // ---------- limite de tentativas ----------
    // No Fly.io o endereço de quem acessa chega em Fly-Client-IP; sem isso o
    // limite valeria para todos juntos (o IP visto seria o do proxy).
    const s = app.settings()
    s.trustedProxy.headers = ['Fly-Client-IP']
    s.trustedProxy.useLeftmostIP = false
    s.rateLimits.enabled = true
    s.rateLimits.rules = [
      { label: '*:authWithPassword', audience: '', duration: 60, maxRequests: 20 },
      { label: '*:requestPasswordReset', audience: '', duration: 300, maxRequests: 5 },
      { label: '*:confirmPasswordReset', audience: '', duration: 300, maxRequests: 10 },
      { label: '*:requestEmailChange', audience: '', duration: 300, maxRequests: 5 },
      { label: '/backend/v1/pegada/conta/convite/', audience: '', duration: 60, maxRequests: 20 },
    ]
    app.save(s)
  },
  (app) => {
    for (const name of ['access_events', 'invites']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (_) {}
    }
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    users.authRule = ''
    for (const n of ['role', 'disabled', 'last_seen_at', 'privacy_notice_at', 'ai_day', 'ai_count']) {
      if (users.fields.getByName(n)) users.fields.removeByName(n)
    }
    app.save(users)
    const s = app.settings()
    s.rateLimits.enabled = false
    app.save(s)
  },
)
