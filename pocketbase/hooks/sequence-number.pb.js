// NUMERAÇÃO PERMANENTE — alocação transacional de sequence_number em
// projects/actions e guardas de imutabilidade.
//
// Alocação em nível de MODELO/PERSISTÊNCIA (onRecordCreate), antes da
// validação/inserção — alcança API comum, criação programática, painel e a
// conversão de capturas. Sobrescreve qualquer payload e falha fechada se o
// controle persistente estiver ausente ou corrompido (nunca recria em 0, nunca
// MAX/COUNT). Update nunca muda sequence_number (guarda de modelo na fase de
// execução, comparando com o valor persistido). Excluir/arquivar não devolve
// nem recalcula números: lacunas são esperadas.
//
// NOTAS JSVM desta instância:
// - lógica INLINE nos callbacks (pool não compartilha declarações de topo);
// - callback de runInTransaction é VOID — resultado em variável local;
// - pacote http não existe — literais numéricos nas respostas;
// - e.App muda dinamicamente na continuação: usar e.app corrente na consulta
//   do contador (nunca $app global), dentro de originalApp.runInTransaction.
//
// Tabela de contadores: ginga_seq_counters (collection TEXT PK, last_value
// INTEGER), criada pela migration 0009 — interna, sem CRUD público.
//
// Limite de precisão segura: 2^53 - 1 — ao atingir, falha sem truncar.

onRecordCreate(
  (e) => {
    const SEQ_MAX = 9007199254740991

    const originalApp = e.app
    originalApp.runInTransaction((txApp) => {
      e.app = txApp
      try {
        const name = e.record.collection().name
        const res = txApp
          .db()
          .newQuery(
            'UPDATE ginga_seq_counters SET last_value = last_value + 1 WHERE collection = {:c} AND last_value < {:m}',
          )
          .bind({ c: name, m: SEQ_MAX })
          .execute()
        const rows = res && res.all ? res.all() : []
        if (rows.length === 0) {
          throw new BadRequestError('Controle de numeração ausente ou esgotado para ' + name + '.')
        }
        const nextNumber = Number(rows[0].last_value)
        if (!Number.isFinite(nextNumber) || nextNumber < 1) {
          throw new BadRequestError('Controle de numeração corrompido para ' + name + '.')
        }
        e.record.set('sequence_number', nextNumber)
        e.next()
      } finally {
        e.app = originalApp
      }
    })
  },
  'projects',
  'actions',
)

onRecordUpdate(
  (e) => {
    const name = e.record.collection().name
    const persisted = e.record.original().getInt('sequence_number')
    const current = e.record.getInt('sequence_number')
    if (!persisted || persisted !== current) {
      throw new BadRequestError('sequence_number é imutável.')
    }
    e.next()
  },
  'projects',
  'actions',
)

onRecordDelete(
  (e) => {
    // Exclusão NÃO devolve nem recalcula número — lacunas são esperadas.
    e.next()
  },
  'projects',
  'actions',
)
