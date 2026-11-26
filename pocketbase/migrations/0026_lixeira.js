// PEGADA — LIXEIRA (aditiva, idempotente).
//
// Excluir uma vontade, responsabilidade, resultado, estratégia ou avanço tira
// o item do banco junto com tudo o que está embaixo dele, e guarda uma cópia
// inteira aqui. Da Lixeira o dono restaura ou exclui de vez.
//
// Cada registro é uma exclusão: o que foi excluído (elemento e título), a
// contagem do que foi junto e a cópia das linhas (payload), na ordem em que
// voltam ao banco. Leitura do dono; escrita só pela API do método.
migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId('trash')
      return
    } catch (_) {}
    const ownerRead = "@request.auth.id != '' && user_id = @request.auth.id"
    app.save(
      new Collection({
        name: 'trash',
        type: 'base',
        listRule: ownerRead,
        viewRule: ownerRead,
        createRule: null,
        updateRule: null,
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
          {
            name: 'element_type',
            type: 'select',
            required: true,
            values: ['vontade', 'responsabilidade', 'resultado', 'estrategia', 'avanco'],
            maxSelect: 1,
          },
          { name: 'element_id', type: 'text', required: true, max: 50 },
          { name: 'title', type: 'text', max: 300 },
          { name: 'counts', type: 'json', maxSize: 2000 },
          { name: 'payload', type: 'json', maxSize: 20000000, hidden: true },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX idx_trash_user ON trash (user_id, created)'],
      }),
    )
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('trash'))
    } catch (_) {}
  },
)
