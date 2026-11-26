// PEGADA — VONTADES (aditiva, idempotente, sem backfill).
//
// A Vontade fica no mesmo nível da Responsabilidade, logo abaixo do Propósito:
// agrupa os resultados que a pessoa quer construir e que antes ficavam ligados
// direto ao Propósito. Teste que separa as duas: "se eu largar, alguém me
// cobra?" (sim = Responsabilidade, não = Vontade).
//
// 1. Coleção `wishes`: título, descrição, contexto vida|trabalho, situação
//    ativa|arquivada. Escrita só pela API do método (hooks); leitura do dono.
// 2. projects.wish_id: a Vontade de origem do Resultado (no máximo uma, e
//    nunca junto com responsibility_id: a regra fica na API do método).
// 3. captures: destino novo "convertida_vontade" e o vínculo converted_wish_id.
// Resultados existentes ficam como estão (livres) até a pessoa agrupá-los.
migrate(
  (app) => {
    const ownerRead = "@request.auth.id != '' && user_id = @request.auth.id"
    let wishes = null
    try {
      wishes = app.findCollectionByNameOrId('wishes')
    } catch (_) {
      wishes = new Collection({
        name: 'wishes',
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
          { name: 'title', type: 'text', required: true, max: 200, pattern: '\\S' },
          { name: 'description', type: 'text', max: 3000 },
          { name: 'context', type: 'select', required: true, values: ['vida', 'trabalho'], maxSelect: 1 },
          { name: 'status', type: 'select', required: true, values: ['ativa', 'arquivada'], maxSelect: 1 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_wishes_user ON wishes (user_id)',
          'CREATE INDEX idx_wishes_user_status ON wishes (user_id, status)',
        ],
      })
      app.save(wishes)
      wishes = app.findCollectionByNameOrId('wishes')
    }

    const projects = app.findCollectionByNameOrId('projects')
    if (!projects.fields.getByName('wish_id')) {
      projects.fields.add(
        new RelationField({
          name: 'wish_id',
          collectionId: wishes.id,
          required: false,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      projects.addIndex('idx_projects_wish', false, 'wish_id', '')
      app.save(projects)
    }

    const captures = app.findCollectionByNameOrId('captures')
    const cStatus = captures.fields.getByName('status')
    if (cStatus.values.indexOf('convertida_vontade') < 0) {
      cStatus.values = cStatus.values.concat(['convertida_vontade'])
    }
    if (!captures.fields.getByName('converted_wish_id')) {
      captures.fields.add(
        new RelationField({
          name: 'converted_wish_id',
          collectionId: wishes.id,
          maxSelect: 1,
          cascadeDelete: false,
        }),
      )
    }
    app.save(captures)
  },
  (app) => {
    // Rollback não destrutivo: só retira os campos novos e a coleção.
    try {
      const projects = app.findCollectionByNameOrId('projects')
      if (projects.fields.getByName('wish_id')) {
        projects.removeIndex('idx_projects_wish')
        projects.fields.removeByName('wish_id')
        app.save(projects)
      }
      const captures = app.findCollectionByNameOrId('captures')
      if (captures.fields.getByName('converted_wish_id')) {
        captures.fields.removeByName('converted_wish_id')
        app.save(captures)
      }
      app.delete(app.findCollectionByNameOrId('wishes'))
    } catch (_) {}
  },
)
