// FATIA 5A — AGENDAMENTO SIMPLES DOS AVANÇOS: FUNDAÇÃO, SEM TELA.
//
// Migration ADITIVA em `actions` — três TextFields OPCIONAIS de planejamento
// local ("quando pretendo executar"), sem backfill, sem seed, sem tocar
// registros existentes, sem novo índice/contador/coleção:
//   - planned_date: dia-calendário YYYY-MM-DD, até 10 caracteres.
//   - planned_time: hora local HH:mm, até 5 caracteres; vazia = SEM HORA.
//   - planned_timezone: nome IANA explícito ou UTC, até 100 caracteres.
//
// Contrato:
// - Vazio canônico é '' — registros legados ficam SEM planejamento pelo vazio
//   nativo dos campos novos (nada é backfillado/inferido de prazo/created).
// - Nenhum campo é required: data planejada nunca bloqueia criar/editar/
//   executar um Avanço. Não há DateField de instante nem planned_at/scheduled_at
//   UTC derivado — dia inteiro e hora local preservados sem inventar meia-noite.
// - deadline NÃO é reutilizado nem reinterpretado; planejamento é campo novo.
// - Validação de formato/dia real/fuso explícito fica na GUARDA de modelo
//   (planned-execution-guards.pb.js, onRecordValidate de actions) — o campo
//   text aceita até o max por natureza; nada é limpo silenciosamente.
// - created/updated, title/description, sequence_number/contadores/constraints,
//   vínculos, flags de foco/status, logs e time_entries preservados. Nenhuma
//   migration antiga editada/reaplicada.
migrate(
  (app) => {
    const actions = app.findCollectionByNameOrId('actions')

    if (!actions.fields.getByName('planned_date')) {
      actions.fields.add(
        new TextField({
          name: 'planned_date',
          max: 10,
          // Formato grosseiro na borda; dia real (31/02, bissexto) é da guarda.
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        }),
      )
    }
    if (!actions.fields.getByName('planned_time')) {
      actions.fields.add(
        new TextField({
          name: 'planned_time',
          max: 5,
          // HH:mm estrito na borda; faixa real (00:00–23:59) é da guarda.
          pattern: '^\\d{2}:\\d{2}$',
        }),
      )
    }
    if (!actions.fields.getByName('planned_timezone')) {
      actions.fields.add(
        new TextField({
          name: 'planned_timezone',
          max: 100,
        }),
      )
    }

    app.save(actions)
  },
  (app) => {
    const actions = app.findCollectionByNameOrId('actions')
    if (actions.fields.getByName('planned_timezone')) {
      actions.fields.removeByName('planned_timezone')
    }
    if (actions.fields.getByName('planned_time')) {
      actions.fields.removeByName('planned_time')
    }
    if (actions.fields.getByName('planned_date')) {
      actions.fields.removeByName('planned_date')
    }
    app.save(actions)
  },
)
