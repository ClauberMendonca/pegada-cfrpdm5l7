// FATIA 6B2B — ADOÇÃO DA FONTE E CICLO DE VIDA DE SÉRIES RECORRENTES — SEM GERADOR.
//
// Migration ADITIVA mínima: adiciona APENAS o campo `lifecycle_version`
// (número inteiro seguro >= 0, inicial 0, decidido backend) à coleção
// recurrence_series (0015). NÃO é a revision da regra (que segue em 1) nem
// ordinal de ocorrência. Sem UPDATE/backfill/seed/exemplos, sem tocar campos,
// regras e índices anteriores, sem criar/ativar nenhuma série.
//
// Semântica (hook recurrence-series-lifecycle.pb.js): mudança REAL de status
// incrementa 1; estado intocado conserva a versão. Criação (registro draft 104)
// começa em 0 — o campo NUNCA vem do cliente.
//
// NOTAS DA INSTÂNCIA: collection.indexes de coleção carregada é STRING JSON —
// nunca .push; aqui NÃO há índice novo (nenhum addIndex/removeIndex é
// necessário). Padrão de campos: NumberField onlyInt (0015).
migrate(
  (app) => {
    let seriesCol = null
    try {
      seriesCol = app.findCollectionByNameOrId('recurrence_series')
    } catch (_) {
      seriesCol = null
    }
    if (!seriesCol) {
      throw new Error('Coleção recurrence_series não encontrada (0015 deve ser aplicada antes).')
    }

    if (seriesCol.fields.getByName('lifecycle_version')) {
      // Idempotente: nada a fazer.
      return
    }

    seriesCol.fields.add(
      new NumberField({
        name: 'lifecycle_version',
        required: false,
        onlyInt: true,
        // 0 = nunca houve transição de estado (draft intocado). Coerência
        // (>= 0, monotônica, par status/versão) é validada pelas guardas de
        // modelo e pelo comando de ciclo de vida — não por min/max aqui.
      }),
    )
    app.save(seriesCol)
  },
  (app) => {
    // Rollback: remove apenas o campo novo; nada mais é tocado.
    let seriesCol = null
    try {
      seriesCol = app.findCollectionByNameOrId('recurrence_series')
    } catch (_) {
      seriesCol = null
    }
    if (!seriesCol) return
    if (seriesCol.fields.getByName('lifecycle_version')) {
      seriesCol.fields.removeByName('lifecycle_version')
      app.save(seriesCol)
    }
  },
)
