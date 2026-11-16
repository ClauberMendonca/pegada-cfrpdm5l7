// FATIA — DESCRIÇÃO OPCIONAL NAS AÇÕES: campo próprio `description` na coleção actions.
//
// Migration aditiva e segura: acrescenta apenas o campo opcional `description`
// (texto livre, multilinha, sem obrigatoriedade e sem backfill automático).
// Registros antigos tratam a ausência como vazio no frontend. Nenhuma regra de
// acesso é alterada; nada de seeds, dados ou outras migrations.
//
// O down remove o campo, sem apagar registros nem outras colunas.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('actions')

    // Idempotente: se o campo já existir com esse nome, nada a fazer.
    if (!collection.fields.getByName('description')) {
      collection.fields.add(
        new TextField({
          name: 'description',
          required: false,
          maxSize: 20000,
        }),
      )
      app.save(collection)
    }
  },
  (app) => {
    // Rollback remove o campo, mas preserva todos os registros.
    const collection = app.findCollectionByNameOrId('actions')
    if (collection.fields.getByName('description')) {
      collection.fields.removeByName('description')
      app.save(collection)
    }
  },
)
