// FATIA 6A1 — GUARDA DE CONCLUSÃO DO AVANÇO (registro de completed_at).
//
// Escopo: SOMENTE a coleção `actions` — campo completed_at (DateField
// opcional, instante UTC) criado pela migration 0014. "Primeira conclusão
// conhecida" — âncora histórica mínima de MARCAR Feito, não afirma quando a
// atividade ocorreu no mundo real (não é o Dia do fato, não é histórico de
// transições, não é ledger/segunda data).
//
// Ponto de modelo: onRecordCreate + onRecordUpdate — valida e decide o campo
// no estado FINAL do registro antes da validação/persistência, alcançando
// saves normais da API, painel e saves internos/transacionais (ex.: txApp da
// conversão de capturas e guarda 5A no mesmo fluxo). O timestamp entra ANTES
// da persistência na MESMA operação de status, passando pela cadeia normal
// (e.next()) — falha/rollback não deixa status ou timestamp parcialmente
// salvos. Nada é gravado fora do registro em curso: SEM save recursivo, SEM
// segundo PATCH/save em after-success, SEM transação própria (a transação,
// quando existe, é a da gravação normal). Se o evento já corre dentro de uma
// transação, o mesmo e.app transacional é usado para reler o estado
// persistido — nunca $app global, nunca transação paralela.
//
// Contrato (semântica 6A1):
// - Backend decide: valor recebido do cliente/código chamador para
//   completed_at NUNCA é fonte de verdade — sobrescrito pelo canônico
//   persistido ou pelo agora calculado; omissão também preserva.
// - Criação nova com status 'feita': completed_at = agora do backend
//   (DateTime() nativo, UTC), na mesma criação. Criação em OUTRO status:
//   vazio canônico (''), qualquer que seja o valor proposto.
// - Atualização: se o estado PERSISTIDO anterior não era 'feita' e o novo
//   status é 'feita', preencher com agora SOMENTE se o campo persistido ainda
//   está vazio. Se já existe completed_at: PRESERVAR exatamente em qualquer
//   edição, repetição de feita, reabertura, cancelamento ou reconclusão —
//   uma ocorrência não ganha nova âncora histórica ao reabrir.
// - Registro antigo já 'feita' com completed_at vazio: editar título, notas,
//   planejamento, vínculo ou repetir feita NÃO atribui conclusão de hoje.
//   Status continua editável pelas regras atuais; o timestamp não prova que
//   o status presente seja Feito.
// - Relógio: DateTime() nativo da instância (instante UTC, string() no
//   formato canônico). NUNCA updated, Date.now do cliente, dia-calendário,
//   fuso do perfil, offset fixo ou transformação de planned_*.
// - Estado persistido: e.record.original() é snapshot de ORIGEM, não
//   releitura — a decisão de "campo persistido ainda vazio" e do estado
//   anterior do status usa RELEITURA pelo e.app do evento (mesma transação
//   quando houver), no padrão do hook de numeração desta instância. Um save
//   de objeto antigo não pode apagar/substituir a primeira conclusão que
//   outro dispositivo já gravou; duas chamadas concorrentes/retry de
//   conclusão não movem completed_at para outra data. Conflito real de
//   transação falha pelo tratamento normal — sem retry automático.
// - Sem superusuário ignorando a guarda; sem leitura/escrita de outras
//   entidades; sem consumidor pós-commit, gerador, cron ou job nesta fatia.
//
// NOTAS JSVM desta instância: lógica INLINE no callback (declarações de topo
// não são compartilhadas entre pools); e.app corrente (nunca $app); callback
// de runInTransaction é VOID; e.next() no fim de cada caminho.

// ---------- Criação ----------
onRecordCreate((e) => {
  const status =
    typeof e.record.getString === 'function'
      ? e.record.getString('status')
      : String(e.record.get('status') || '')

  if (status === 'feita') {
    // Primeira conclusão conhecida na própria criação: agora do BACKEND,
    // sempre — valor proposto pelo chamador nunca é fonte de verdade.
    e.record.set('completed_at', new DateTime().string())
  } else {
    // Criação em outro status: vazio canônico, qualquer que seja o valor
    // proposto para completed_at.
    e.record.set('completed_at', '')
  }
  return e.next()
}, 'actions')

// ---------- Atualização ----------
onRecordUpdate((e) => {
  const rec = e.record

  const currentApp = e.app

  const originalApp = currentApp
  originalApp.runInTransaction((txApp) => {
    e.app = txApp
    try {
      // Estado PERSISTIDO corrente, relido dentro da MESMA transação
      // que executa a gravação normal — original() seria snapshot de
      // origem e fresh() não consulta o banco.
      let persistedStatus = ''
      let persistedCompletedAt = ''
      try {
        const persisted = txApp.findRecordById(rec.collection().name, rec.id)
        persistedStatus = persisted.getString('status')
        const stored = persisted.getDateTime('completed_at')
        // Vazio canônico do DateField serializa como '' — sem data zero.
        persistedCompletedAt = stored && typeof stored.string === 'function' ? stored.string() : ''
      } catch (_) {
        // Releitura indisponível (registro removido na mesma janela):
        // cai no snapshot de origem — a operação solicitada segue pela
        // cadeia normal; a preservação explícita abaixo ainda se aplica.
        persistedStatus = rec.original().getString('status')
        const storedOriginal = rec.original().getDateTime('completed_at')
        persistedCompletedAt =
          storedOriginal && typeof storedOriginal.string === 'function'
            ? storedOriginal.string()
            : ''
      }

      const nowString = new DateTime().string()
      const newStatus = rec.getString('status')

      if (persistedCompletedAt === '') {
        if (persistedStatus !== 'feita' && newStatus === 'feita') {
          // Transição para feita SEM conclusão registrada: primeira
          // conclusão conhecida — agora do backend, na MESMA gravação.
          rec.set('completed_at', nowString)
        } else {
          // Não-conclusão OU registro antigo já 'feita' sem âncora:
          // editar título/notas/planejamento/vínculo ou repetir feita
          // NÃO atribui conclusão de hoje. Sobrescreve qualquer valor
          // proposto com o vazio canônico (backend decide; omissão
          // também preserva o estado persistido vazio).
          rec.set('completed_at', '')
        }
      } else {
        // Já existe completed_at: PRESERVAR exatamente — em qualquer
        // edição, repetição de feita, reabertura, cancelamento ou
        // reconclusão. Nenhuma reconclusão move ou recria a âncora.
        rec.set('completed_at', persistedCompletedAt)
      }
      e.next()
    } finally {
      e.app = originalApp
    }
  })
}, 'actions')
