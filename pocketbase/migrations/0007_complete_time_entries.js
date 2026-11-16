// FATIA — REGISTRO DE TEMPO V1: completar o esquema sem reescrever 0006.
//
// Esta migration é aditiva e segura para banco em que 0006 já foi aplicada:
// - duration_seconds precisa aceitar zero enquanto um cronômetro está running;
// - target_title guarda o título histórico, sem depender do alvo vivo;
// - operation_history guarda as intenções e resultados de todas as operações;
// - resumed_by impede retomar a mesma pausa duas vezes;
// - relações de tempo não fazem cascade delete, preservando o histórico.
//
// O down é intencionalmente não destrutivo. Não se apagam campos nem dados
// históricos durante rollback; a reversão deve ser feita por uma migration
// explícita e revisada, se algum dia for necessária.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('time_entries')

    const duration = collection.fields.getByName('duration_seconds')
    duration.required = false

    const userRelation = collection.fields.getByName('user_id')
    userRelation.cascadeDelete = false

    const actionRelation = collection.fields.getByName('action_id')
    actionRelation.cascadeDelete = false

    const projectRelation = collection.fields.getByName('project_id')
    projectRelation.cascadeDelete = false

    collection.fields.add(
      new TextField({
        name: 'target_title',
        required: false,
      }),
    )
    collection.fields.add(
      new JSONField({
        name: 'operation_history',
        required: false,
        maxSize: 1048576,
      }),
    )
    collection.fields.add(
      new TextField({
        name: 'resumed_by',
        required: false,
      }),
    )

    app.save(collection)
  },
  (app) => {
    // Intencionalmente no-op: rollback não pode apagar snapshot/ledger.
  },
)
