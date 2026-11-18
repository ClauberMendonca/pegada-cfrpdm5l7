// FATIA 5A — GUARDA DE PLANEJAMENTO DO AVANÇO (agendamento simples, sem tela).
//
// Escopo: SOMENTE a coleção `actions` — campos planned_date (YYYY-MM-DD),
// planned_time (HH:mm) e planned_timezone (IANA explícito ou UTC), criados
// pela migration 0013. "Quando pretendo executar" — INTENÇÃO LOCAL, não
// registro de execução, não instantes: DST (hora inexistente/repetida) NÃO é
// resolvido aqui; política de ambiguidade pertence à futura resolução temporal.
//
// Ponto de modelo: onRecordValidate — valida o estado FINAL do registro
// (não só o corpo de um request), alcançando saves normais da API, painel e
// saves internos/transacionais (ex.: txApp da conversão de capturas). Nada é
// gravado nesta guarda (sem save recursivo, sem transação própria): falha →
// nada persiste; sucesso → e.next() encadeia dono/hierarquia/numeração
// intactos. Nenhum caminho existente é movido para saveNoValidate.
//
// Contrato dos campos (vazio canônico é ''):
// - Sem agendamento: os TRÊS vazios — criação/edição/execução nunca exigem
//   planejamento. Omissão de campo no update preserva o valor persistido
//   (onRecordValidate vê o estado final já mesclado — omissão nunca é remoção).
// - Com data: fuso válido OBRIGATÓRIO; hora continua opcional.
// - Hora ou fuso sem data é inválido. Valores só de espaços, formato parcial,
//   data impossível (31/02, 29/02 não bissexto), 24:00, ano < 1: rejeitados —
//   nada é fabricado (nem Hoje) nem limpo silenciosamente; o patch válido
//   resolve no MESMO patch (ex.: planned_time:'' limpa só a hora).
// - Fuso: apenas nome IANA explícito ou UTC. "Local", offset numérico
//   (+03:00), nome com espaços nas bordas: recusados. new Timezone(nome) do
//   PocketBase retorna UTC para nome inválido/vazio — construir sem erro NÃO
//   valida: confere-se string() contra a entrada exata.
// - Não lê nem escreve status/foco/progresso/deadline/sequence_number; não
//   consulta nem grava outras entidades; não há defaults ocultos (conversão
//   84/85 continua criando destinos SEM planejamento — campos ausentes ficam
//   vazios por natureza).
//
// NOTAS JSVM desta instância: lógica INLINE no callback (declarações de topo
// não são compartilhadas entre pools); chamada de e.next() no fim.
onRecordValidate((e) => {
  const rec = e.record

  const dateRaw = rec.getString('planned_date')
  const timeRaw = rec.getString('planned_time')
  const tzRaw = rec.getString('planned_timezone')

  const date = dateRaw === null || dateRaw === undefined ? '' : String(dateRaw)
  const time = timeRaw === null || timeRaw === undefined ? '' : String(timeRaw)
  const tz = tzRaw === null || tzRaw === undefined ? '' : String(tzRaw)

  // Sem agendamento: os TRÊS vazios (campo ausente no legado lê como '').
  if (date === '' && time === '' && tz === '') {
    return e.next()
  }

  // Estado coerente do GRUPO: hora ou fuso sem data é inválido.
  if (date === '') {
    throw new BadRequestError(
      'Data planejada ausente: informe a data ou limpe os demais campos do planejamento.',
    )
  }

  // ---------- Data: formato E dia real (calendário gregoriano, ano >= 1).
  const dateOk = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
  if (!dateOk) {
    throw new BadRequestError('Data planejada do Avanço inválida: use o formato YYYY-MM-DD.')
  }
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  // Ano >= 1; mês 1–12; dia dentro do mês (bissexto: divisível por 4, com
  // exceção dos séculos não divisíveis por 400) — 31/02 e 29/02 comuns
  // são rejeitados sem parser que normalize a data.
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    throw new BadRequestError(
      'Data planejada do Avanço inválida: informe um dia real do calendário.',
    )
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth =
    month === 1 ||
    month === 3 ||
    month === 5 ||
    month === 7 ||
    month === 8 ||
    month === 10 ||
    month === 12
      ? 31
      : month === 2
        ? isLeap
          ? 29
          : 28
        : 30
  if (day > daysInMonth) {
    throw new BadRequestError(
      'Data planejada do Avanço inválida: esse dia não existe no mês informado.',
    )
  }

  // ---------- Hora: HH:mm estrito, 00:00 a 23:59. Vazia = SEM HORA;
  // 00:00 explícita é válida e nunca é default.
  if (time !== '' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    throw new BadRequestError(
      'Hora planejada do Avanço inválida: use HH:mm entre 00:00 e 23:59, ou vazia para dia inteiro.',
    )
  }

  // ---------- Fuso: IANA explícito ou UTC. Sem data, já rejeitado acima —
  // com data, fuso é OBRIGATÓRIO.
  if (tz === '') {
    throw new BadRequestError('Fuso planejado do Avanço é obrigatório quando há data planejada.')
  }
  if (tz !== tz.trim() || tz.trim() === '') {
    throw new BadRequestError(
      'Fuso planejado do Avanço inválido: informe um nome IANA explícito (ou UTC), sem espaços.',
    )
  }
  if (tz === 'Local') {
    throw new BadRequestError(
      'Fuso planejado do Avanço inválido: "Local" não é referência — informe um nome IANA explícito ou UTC.',
    )
  }
  // Nomes IANA nunca contêm offset numérico/sinal/dois-pontos (ex.: +03:00).
  if (/[+]/.test(tz) || /^-/.test(tz) || /^-?[0-9]/.test(tz)) {
    throw new BadRequestError(
      'Fuso planejado do Avanço inválido: offset numérico não é referência — informe um nome IANA explícito ou UTC.',
    )
  }
  if (
    typeof Timezone !== 'function' ||
    !Timezone ||
    !new Timezone('UTC') ||
    !new Timezone('UTC').string
  ) {
    // Recurso indisponível nesta JSVM: falha EXPLÍCITA — nunca aceitar nome
    // arbitrário nem calar o fuso invalidado.
    throw new BadRequestError(
      'Validação de fuso planejado do Avanço indisponível neste backend — planejamento não pode ser gravado sem verificação do fuso.',
    )
  }
  // new Timezone(nome) devolve UTC para nome inválido/vazio: construir sem
  // erro não valida. Confere o nome devolvido por string() contra a entrada.
  const zone = new Timezone(tz)
  if (!zone || zone.string() !== tz) {
    throw new BadRequestError(
      'Fuso planejado do Avanço inválido: use um nome IANA explícito (ex.: America/Sao_Paulo) ou UTC.',
    )
  }

  // O patch válido pode mudar só parte do grupo (os demais valores já
  // persistidos foram validados juntos acima, no estado final). Nada mais é
  // lido ou gravado — sem save recursivo, sem transação própria.
  return e.next()
}, 'actions')
