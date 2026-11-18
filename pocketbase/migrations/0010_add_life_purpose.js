// FATIA 2A — PROPÓSITO DE VIDA NO PERFIL: campo opcional `life_purpose`
// na coleção users (autenticação nativa), texto simples, multilinha,
// máximo 500 caracteres (mesmo limite no frontend). Opcional: ausente =
// sem propósito; contas existentes seguem sem valor até o dono escrever.
//
// Migration aditiva e idempotente: acrescenta apenas o campo, sem backfill,
// sem seeds, sem tocar em regras de acesso, autenticação, numeração ou tempo.
// O down remove o campo, preservando registros e demais colunas.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('_pb_users_auth_')

    // Idempotente: se o campo já existir com esse nome, nada a fazer.
    if (!collection.fields.getByName('life_purpose')) {
      collection.fields.add(
        new TextField({
          name: 'life_purpose',
          required: false,
          maxSize: 500,
        }),
      )
      app.save(collection)
    }
  },
  (app) => {
    // Rollback remove o campo, mas preserva a conta e os demais campos.
    const collection = app.findCollectionByNameOrId('_pb_users_auth_')
    if (collection.fields.getByName('life_purpose')) {
      collection.fields.removeByName('life_purpose')
      app.save(collection)
    }
  },
)
