// PEGADA — PRIVACIDADE DA IA (aditiva, idempotente).
//
// Dois campos no perfil do dono:
//   ai_off        a pessoa desligou a IA embutida em Configurações
//   ai_notice_at  quando ela leu o aviso de que o texto do pedido vai à Anthropic
// Sem backfill: contas existentes seguem com a IA ligada e veem o aviso na
// primeira vez que a usarem de novo.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('_pb_users_auth_')
    let mudou = false
    if (!c.fields.getByName('ai_off')) {
      c.fields.add(new BoolField({ name: 'ai_off', required: false }))
      mudou = true
    }
    if (!c.fields.getByName('ai_notice_at')) {
      c.fields.add(new DateField({ name: 'ai_notice_at', required: false }))
      mudou = true
    }
    if (mudou) app.save(c)
  },
  (app) => {
    const c = app.findCollectionByNameOrId('_pb_users_auth_')
    let mudou = false
    for (const n of ['ai_off', 'ai_notice_at']) {
      if (c.fields.getByName(n)) {
        c.fields.removeByName(n)
        mudou = true
      }
    }
    if (mudou) app.save(c)
  },
)
