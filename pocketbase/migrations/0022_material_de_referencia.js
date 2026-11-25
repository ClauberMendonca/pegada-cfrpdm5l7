// PEGADA — MATERIAL DE REFERÊNCIA (aditiva, idempotente).
//
// Documentos, links, contatos e anotações de apoio não são avanços: entram
// como anexos leves de qualquer elemento e aparecem só onde são usados.
// Não existe arquivo geral. A conclusão de um Estudo ou de uma Reflexão vira
// uma nota presa ao resultado (source_action_id guarda de onde ela veio).
//
// Escrita: só pela API do método (hooks). Leitura: só o dono.
migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId('references')
      return
    } catch (_) {}
    const ownerRead = "@request.auth.id != '' && user_id = @request.auth.id"
    const c = new Collection({
      name: 'references',
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
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: 'element_type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['responsabilidade', 'resultado', 'estrategia', 'avanco'],
        },
        { name: 'element_id', type: 'text', required: true, max: 40 },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['nota', 'link', 'contato', 'documento'],
        },
        { name: 'title', type: 'text', max: 300 },
        { name: 'body', type: 'text', max: 5000 },
        { name: 'url', type: 'text', max: 2000 },
        { name: 'source_action_id', type: 'text', max: 40 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['ativa', 'removida'] },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_references_element ON references (user_id, element_type, element_id)'],
    })
    app.save(c)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('references'))
    } catch (_) {}
  },
)
