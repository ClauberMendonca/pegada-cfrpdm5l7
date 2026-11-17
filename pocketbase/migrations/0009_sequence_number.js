// NUMERAÇÃO PERMANENTE — ENTREGA 1 (backend e registros existentes).
//
// Adiciona `sequence_number` (inteiro positivo, público para leitura, imutável)
// em `projects` e `actions`, com sequências independentes e GLOBAIS por
// coleção (Vida/Trabalho, dono, vínculo ou filtros não criam subcontagens).
//
// Tudo em UMA transação (requisito: nada pela metade se falhar):
//   1. campo novo ainda SEM índice UNIQUE (registros antigos ficariam todos 0);
//   2. backfill dos registros existentes, ordenados por created ASC, id ASC
//      (UTC original; id apenas desempate estável) — somente sequence_number
//      é atualizado, via SQL parametrizado, preservando created/updated e
//      todos os demais campos byte a byte;
//   3. tabela interna privada de contadores (uma linha por coleção,
//      last_value inicializado com o último número atribuído);
//   4. índice UNIQUE(sequence_number) em cada coleção e NumberField
//      required/onlyInt com min 1 / max 9007199254740991 (2^53-1, limite de
//      precisão segura do JS — maior valor exato representável no runtime).
//
// O down remove os índices, os contadores e o campo — correções futuras são
// aditivas; após sucesso não há rollback destrutivo de dados.
migrate(
  (app) => {
    const SEQ_TABLE = 'ginga_seq_counters'
    const SAFE_MAX = 9007199254740991 // 2^53 - 1
    const collections = ['projects', 'actions']

    const seqTableExists = app.hasTable(SEQ_TABLE)
    if (!seqTableExists) {
      app
        .db()
        .newQuery(
          'CREATE TABLE ' +
            SEQ_TABLE +
            ' (collection TEXT PRIMARY KEY, last_value INTEGER NOT NULL DEFAULT 0)',
        )
        .execute()
    }

    for (const name of collections) {
      const col = app.findCollectionByNameOrId(name)
      const field = col.fields.getByName('sequence_number')

      if (!field) {
        // Fase 1: sem UNIQUE, sem required (os registros antigos ainda têm 0).
        col.fields.add(
          new NumberField({ name: 'sequence_number', onlyInt: true, min: 0, max: SAFE_MAX }),
        )
        app.save(col)

        // Fase 2: backfill idempotente — só os registros ainda sem número.
        app
          .db()
          .newQuery(
            'UPDATE ' +
              name +
              ' SET sequence_number = (' +
              'SELECT COUNT(*) + 1 FROM ' +
              name +
              ' AS t2 ' +
              'WHERE (t2.created < ' +
              name +
              '.created) ' +
              'OR (t2.created = ' +
              name +
              '.created AND t2.id < ' +
              name +
              '.id)) ' +
              'WHERE sequence_number IS NULL OR sequence_number = 0',
          )
          .execute()

        // Fase 3: contador persistente — preserva last_value já inicializado.
        const res = app
          .db()
          .newQuery('SELECT last_value FROM ' + SEQ_TABLE + ' WHERE collection = {:c}')
          .bind({ c: name })
          .execute()
        let lastValue = 0
        const rows = res && res.all ? res.all() : []
        if (rows.length > 0) {
          lastValue = Number(rows[0].last_value)
        }
        if (rows.length === 0) {
          const maxRow = app
            .db()
            .newQuery(
              'SELECT COALESCE(MAX(sequence_number), 0) AS m FROM ' +
                name +
                ' WHERE sequence_number IS NOT NULL',
            )
            .execute()
          const maxRows = maxRow && maxRow.all ? maxRow.all() : []
          if (maxRows.length > 0 && Number(maxRows[0].m) > lastValue) {
            lastValue = Number(maxRows[0].m)
          }
          app
            .db()
            .newQuery('INSERT INTO ' + SEQ_TABLE + ' (collection, last_value) VALUES ({:c}, {:v})')
            .bind({ c: name, v: lastValue })
            .execute()
        }

        // Fase 4: validadores finais + índice UNIQUE, já com números preenchidos.
        col.fields.removeByName('sequence_number')
        col.fields.add(
          new NumberField({
            name: 'sequence_number',
            onlyInt: true,
            required: true,
            min: 1,
            max: SAFE_MAX,
          }),
        )
        app.save(col)
        col.addIndex('idx_' + name + '_seqnum_unique', true, 'sequence_number', '')
        app.save(col)
      } else {
        // Já implantado nesta coleção: apenas validar, sem renumerar.
        const res = app
          .db()
          .newQuery('SELECT last_value FROM ' + SEQ_TABLE + ' WHERE collection = {:c}')
          .bind({ c: name })
          .execute()
        const rows = res && res.all ? res.all() : []
        if (rows.length === 0) {
          throw new Error('sequence_number já existe em ' + name + ' sem contador correspondente.')
        }
      }
    }
  },
  (app) => {
    // Rollback aditivo: remove índices, contadores e campo — não apaga registros.
    const SEQ_TABLE = 'ginga_seq_counters'
    const collections = ['projects', 'actions']
    for (const name of collections) {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col.fields.getByName('sequence_number')) {
          col.removeIndex('idx_' + name + '_seqnum_unique')
          col.fields.removeByName('sequence_number')
          app.save(col)
        }
      } catch (_) {}
    }
    try {
      app
        .db()
        .newQuery('DROP TABLE IF EXISTS ' + SEQ_TABLE)
        .execute()
    } catch (_) {}
  },
)
