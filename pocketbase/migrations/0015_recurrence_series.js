// FATIA 6B1 — SÉRIES RECORRENTES: BASE PERSISTIDA E IDENTIDADE (fundação).
//
// Migration ADITIVA — sem backfill, sem UPDATE em registros existentes, sem
// seed, sem criar/ativar nenhuma série:
// 1. Coleção `recurrence_series` — definição persistida de uma série recorrente
//    de Avanços:
//    - user_id: dono (relação obrigatória a users), imutável.
//    - source_action_id: Avanço de ORIGEM (relação obrigatória a actions),
//      imutável, SEM cascadeDelete. Índice UNIQUE: uma série por fonte,
//      inclusive quando parada. A fonte NÃO é implicitamente a ocorrência 1
//      (adoção será escolha transacional futura).
//    - status: draft | active | paused | stopped. Criação começa draft;
//      valor omitido não ativa. Estados são SÓ da série — nunca status do
//      Avanço/Resultado. Nenhuma série é criada/ativada nesta fatia.
//    - rule: objeto JSON da regra v1 (contrato src/types/recurrence.ts e
//      pocketbase/hooks/lib/recurrence-calendar.js) — validado pelas guardas
//      antes de persistir; não é string serializada.
//    - template: objeto JSON version:1 com APENAS title, description,
//      context, project_id, responsibility_id, strategy_id — validado pelas
//      guardas antes de persistir.
//    - revision: inteiro positivo seguro, inicial 1 — revisão da CONFIGURAÇÃO
//      (não é contador de ocorrências).
//    Sem sequence_number/código; id/created/updated nativos. Regras: list/view
//    apenas dono autenticado; create/update/delete BLOQUEADOS pela API comum
//    (null) — escrita só por caminhos internos/futuros comandos nativos.
// 2. Identidade OPCIONAL de ocorrência em `actions` (sem required, sem
//    cascade, vazios canônicos):
//    - recurrence_series_id: relação singular à série (vazio = Avanço comum).
//    - recurrence_ordinal: número inteiro (0 = sem identidade; vinculado
//      exige >= 1).
//    - recurrence_revision: número inteiro (0 = sem identidade; vinculado
//      exige >= 1, existente na versão corrente ao atribuir — nesta fundação,
//      1).
//    Índice UNIQUE PARCIAL em (recurrence_series_id, recurrence_ordinal)
//    APENAS quando a série não está vazia — Avanços comuns seguem vazios/0
//    sem colisão. A série já identifica o dono: user_id NÃO entra na chave;
//    revisão e planned_date NÃO entram (mudança de regra não permite recriar
//    o mesmo ordinal).
// Nada é inferido de planned_date, posição de lista, título, conclusão ou
// número permanente. Cada ocorrência nova continua recebendo sequence_number
// pelo mecanismo atual (0009), independente do ordinal. Índices/contadores da
// numeração e campos anteriores NÃO são tocados.
migrate(
  (app) => {
    // ---------- 1. Coleção recurrence_series ----------
    let seriesCol = null
    try {
      seriesCol = app.findCollectionByNameOrId('recurrence_series')
    } catch (_) {
      seriesCol = null
    }
    if (!seriesCol) {
      seriesCol = new Collection({
        name: 'recurrence_series',
        type: 'base',
        // API comum: leitura apenas do dono; escrita BLOQUEADA (null) — os
        // comandos nativos autenticados futuros persistirão por caminho
        // interno. Acesso administrativo atual (superusuário/painel) segue
        // existindo, com os limites declarados.
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          // Dono imutável (relação obrigatória).
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          // Avanço de origem — imutável, sem cascade: excluir o Avanço com
          // série é vetado pelas guardas (nada desvincula/renumera em lote).
          {
            name: 'source_action_id',
            type: 'relation',
            required: true,
            collectionId: app.findCollectionByNameOrId('actions').id,
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['draft', 'active', 'paused', 'stopped'],
            maxSelect: 1,
          },
          // Regra v1 como OBJETO JSON (não string serializada); estrutura/
          // calendário/fuso validados pelas guardas via módulos 6A2.
          { name: 'rule', type: 'json', maxSize: 2000000 },
          // Template v1 como OBJETO JSON — APENAS title, description,
          // context, project_id, responsibility_id, strategy_id.
          { name: 'template', type: 'json', maxSize: 2000000 },
          // Revisão da configuração — inteiro positivo, inicial 1.
          {
            name: 'revision',
            type: 'number',
            required: true,
            onlyInt: true,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          // Uma série por fonte, inclusive quando parada.
          'CREATE UNIQUE INDEX idx_recurrence_series_source ON recurrence_series (source_action_id)',
          'CREATE INDEX idx_recurrence_series_user ON recurrence_series (user_id)',
          'CREATE INDEX idx_recurrence_series_user_status ON recurrence_series (user_id, status)',
        ],
      })
      app.save(seriesCol)
      seriesCol = app.findCollectionByNameOrId('recurrence_series')
    }
    const seriesColId = seriesCol.id

    // ---------- 2. Identidade opcional em actions ----------
    const actions = app.findCollectionByNameOrId('actions')
    let actionsChanged = false

    if (!actions.fields.getByName('recurrence_series_id')) {
      actions.fields.add(
        new RelationField({
          name: 'recurrence_series_id',
          collectionId: seriesColId,
          required: false,
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      actionsChanged = true
    }
    if (!actions.fields.getByName('recurrence_ordinal')) {
      actions.fields.add(
        new NumberField({
          name: 'recurrence_ordinal',
          required: false,
          onlyInt: true,
          // Inteiro seguro; 0 = sem identidade. Sem min/max artificiais —
          // coerência da tupla é validada pelas guardas de modelo.
        }),
      )
      actionsChanged = true
    }
    if (!actions.fields.getByName('recurrence_revision')) {
      actions.fields.add(
        new NumberField({
          name: 'recurrence_revision',
          required: false,
          onlyInt: true,
        }),
      )
      actionsChanged = true
    }

    // Índice UNIQUE PARCIAL: só onde a série não está vazia. Milhares de
    // Avanços comuns vazios/0 não colidem; user_id/revision/planned_date não
    // entram (a série identifica o dono; mudar a regra não permite recriar o
    // mesmo ordinal).
    // NESTA VERSÃO DO POCKETBASE collection.indexes é STRING JSON em coleções
    // carregadas — NÃO é array: actions.idx.push(...) falha ("Cannot read
    // property 'push' of undefined"). O padrão nativo (já aplicado na 0012)
    // é actions.addIndex(nome, unique, colunas, where) — idempotente.
    actions.addIndex(
      'idx_actions_recurrence_identity',
      true,
      'recurrence_series_id, recurrence_ordinal',
      "recurrence_series_id IS NOT NULL AND recurrence_series_id != ''",
    )
    actionsChanged = true

    if (actionsChanged) {
      app.save(actions)
    }
  },
  (app) => {
    // Rollback: remove índice/campos novos de actions e depois a coleção.
    const actions = app.findCollectionByNameOrId('actions')
    let actionsChanged = false
    if (actions.fields.getByName('recurrence_revision')) {
      actions.fields.removeByName('recurrence_revision')
      actionsChanged = true
    }
    if (actions.fields.getByName('recurrence_ordinal')) {
      actions.fields.removeByName('recurrence_ordinal')
      actionsChanged = true
    }
    if (actions.fields.getByName('recurrence_series_id')) {
      actions.removeIndex('idx_actions_recurrence_identity')
      actions.fields.removeByName('recurrence_series_id')
      actionsChanged = true
    }
    if (actionsChanged) {
      app.save(actions)
    }
    try {
      const seriesCol = app.findCollectionByNameOrId('recurrence_series')
      app.delete(seriesCol)
    } catch (_) {}
  },
)
