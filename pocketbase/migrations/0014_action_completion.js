// FATIA 6A1 — REGISTRO DE CONCLUSÃO DO AVANÇO (fundação, sem tela).
//
// Migration ADITIVA em `actions` — UM DateField OPCIONAL de instante UTC:
//   - completed_at: primeira conclusão conhecida registrada pelo BACKEND;
//     não equivale ao Dia do fato (quando a atividade ocorreu no mundo real).
//
// Contrato:
// - Vazio canônico do DateField ('' na serialização): registros legados ficam
//   SEM conclusão registrada — nada é backfillado/inferido de status=feita,
//   created, updated, logs, planned_*, snapshots ou tempos.
// - NENHUM UPDATE/backfill de registros existentes nesta migration (nem por
//   SQL, nem por record.save) — o campo só passa a ser gravado pelo guardião
//   de modelo (action-completion.pb.js) a partir desta implantação.
// - Sem autodate de criação/atualização genérica (created/updated existentes
//   preservados), sem min/max artificiais, sem índice ou relação novos.
// - Criação/edição manual do valor NÃO é fonte de verdade: o backend decide
//   pelo canônico persistido ou pelo agora calculado (guarda no modelo).
// - Não acrescenta o campo a projects, captures, progress_logs nem
//   time_entries. Regras/índices/contadores/campos atuais preservados.
//   Nenhuma migration antiga editada/reaplicada.
migrate(
  (app) => {
    const actions = app.findCollectionByNameOrId('actions')

    if (!actions.fields.getByName('completed_at')) {
      actions.fields.add(
        new DateField({
          name: 'completed_at',
          // DateField OPCIONAL: sem required, sem min/max (sem janela
          // artificial), sem autodate (onCreate/onUpdate não se aplicam ao
          // tipo date) — instante UTC gravado somente pela guarda de modelo.
        }),
      )
    }

    app.save(actions)
  },
  (app) => {
    const actions = app.findCollectionByNameOrId('actions')
    if (actions.fields.getByName('completed_at')) {
      actions.fields.removeByName('completed_at')
      app.save(actions)
    }
  },
)
