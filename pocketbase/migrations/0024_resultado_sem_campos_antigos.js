// PEGADA — O RESULTADO FICA SÓ COM O QUE O MÉTODO PEDE.
//
// Um resultado é um estado alcançado (title), um prazo (deadline) e "como vou
// saber que cheguei" (completion_condition). Os campos do modelo antigo saíram
// do método e das telas, e aqui saem do banco: Aspiração, Entrega Controlável,
// Aprendizado e os Oito Rs.
//
// NÃO TEM VOLTA: o conteúdo desses campos é apagado. A decisão foi do dono, em
// 25/11/2026. O caminho de volta só recria as colunas, vazias.
const CAMPOS = [
  'aspiration',
  'controllable_delivery',
  'learning_asset',
  'r_resultado',
  'r_razao',
  'r_referencia',
  'r_rumo',
  'r_recursos',
  'r_restricoes',
  'r_riscos',
  'r_responsavel',
]

migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('projects')
    let mudou = false
    for (const n of CAMPOS) {
      if (c.fields.getByName(n)) {
        c.fields.removeByName(n)
        mudou = true
      }
    }
    if (mudou) app.save(c)
  },
  (app) => {
    const c = app.findCollectionByNameOrId('projects')
    let mudou = false
    for (const n of CAMPOS) {
      if (!c.fields.getByName(n)) {
        c.fields.add(new TextField({ name: n, required: false }))
        mudou = true
      }
    }
    if (mudou) app.save(c)
  },
)
