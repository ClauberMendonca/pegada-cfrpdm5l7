// REPARO DO CONTADOR DE NUMERAÇÃO PERMANENTE (Pegada).
//
// Sintoma: POST /backend/v1/pegada/op/processar_captura falhou com
// "sequence_number: Value must be unique." — o contador da tabela interna
// ginga_seq_counters estava ATRÁS do maior sequence_number já atribuído
// (frentes de números: registros criados por caminhos que não passavam pelo
// contador antes da guarda atual). O hook onRecordCreate incrementa o contador
// e grava last_value+1; se last_value < MAX, sorteia número já usado.
//
// Correção: para cada coleção ('projects' e 'actions'), LOGA last_value de
// antes, executa UPDATE com GUARDA (nunca diminui o contador — só sobe até o
// MAX atual), e LOGA o valor de depois. NÃO altera nenhum registro de
// projects/actions; a tabela de contadores é interna desta instância e o
// método não é exportado. Idempotente: se o contador já estiver >= MAX,
// o UPDATE muda 0 linhas e a migration é no-op (antes/depois idênticos).
// O down NÃO faz nada (nenhum efeito a reverter).

migrate(
  (app) => {
    const SEQ_TABLE = 'ginga_seq_counters'
    const collections = ['projects', 'actions']

    for (const name of collections) {
      const maxRow = app
        .db()
        .newQuery('SELECT COALESCE(MAX(sequence_number), 0) AS m FROM ' + name)
        .execute()
      const maxRows = maxRow && maxRow.all ? maxRow.all() : []
      const maxSeq = maxRows.length > 0 ? Number(maxRows[0].m) : 0

      const beforeRows = app
        .db()
        .newQuery('SELECT last_value FROM ' + SEQ_TABLE + ' WHERE collection = {:c}')
        .bind({ c: name })
        .execute()
      const rows = beforeRows && beforeRows.all ? beforeRows.all() : []
      const before = rows.length > 0 ? Number(rows[0].last_value) : null

      console.log(
        'seq-counter ANTES ' +
          name +
          '=' +
          String(before) +
          ' (MAX(sequence_number)=' +
          maxSeq +
          ')',
      )

      const upd = app
        .db()
        .newQuery(
          'UPDATE ' +
            SEQ_TABLE +
            ' SET last_value = (SELECT COALESCE(MAX(sequence_number), 0) FROM ' +
            name +
            ') WHERE collection = {:c} AND last_value < (SELECT COALESCE(MAX(sequence_number), 0) FROM ' +
            name +
            ')',
        )
        .bind({ c: name })
        .execute()
      let affected = 0
      try {
        affected = Number(upd.rowsAffected())
      } catch (_) {
        affected = 0
      }

      const afterRows = app
        .db()
        .newQuery('SELECT last_value FROM ' + SEQ_TABLE + ' WHERE collection = {:c}')
        .bind({ c: name })
        .execute()
      const afterRowsAll = afterRows && afterRows.all ? afterRows.all() : []
      const after = afterRowsAll.length > 0 ? Number(afterRowsAll[0].last_value) : null

      console.log(
        'seq-counter DEPOIS ' +
          name +
          '=' +
          String(after) +
          ' (MAX(sequence_number)=' +
          maxSeq +
          ', linhas alteradas=' +
          affected +
          ')',
      )
    }
  },
  (app) => {
    // Nada a reverter: o reparo só eleva contadores internos acesos; não recua.
  },
)
