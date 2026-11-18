// FATIA 3A — GUARDAS DE RESPONSABILIDADES (modelo/persistência + requisição).
//
// Escopo desta fatia (sem menu/rotas/UI — 3B/3C):
// - responsibilities: dono derivado da sessão na API comum (payload nunca
//   decide), status default 'ativa' em toda criação sem status, exclusão
//   definitiva bloqueada pela API comum (deleteRule locked na migration 0011).
// - Validação de vínculos em nível de MODELO (onRecordCreate/onRecordUpdate),
//   alcançando API comum, painel e a conversão de capturas (txApp.save) —
//   as guardas usam a app transacional corrente (e.app), respeitando o
//   contrato void de runInTransaction do hook capture-convert.
// - Regras de hierarquia (uma fonte de verdade):
//   * Resultado (com ou sem Responsabilidade): 0..1 em
//     projects.responsibility_id.
//   * Avanço com project_id: responsabilidade EFETIVA herda do Resultado
//     corrente; actions.responsibility_id DEVE estar vazio (herança nunca é
//     gravada no Avanço, nos logs ou no tempo).
//   * Avanço sem project_id: pode ter 0..1 vínculo DIRETO em
//     actions.responsibility_id.
//   * Avanço indo para Resultado com vínculo direto ainda enviado: rejeitado
//     (o mesmo patch deve remover o vínculo direto explicitamente).
//   * Avanço saindo de Resultado: o vínculo direto NÃO é preenchido
//     automaticamente (fica vazio ou recebe escolha explícita no mesmo patch).
// - Novo vínculo explícito (Resultado ou Avanço solto): destino existente,
//   mesmo dono, MESMO CONTEXTO e status 'ativa'. Responsabilidade arquivada
//   impede NOVO vínculo, não edição de title/description/status de registro
//   que mantém vínculo antigo; desvincular uma arquivada é permitido.
// - Arquivar a Responsabilidade muda SOMENTE status: nenhum Resultado é
//   encerrado, nenhum Avanço cancelado, nada em Hoje/progresso/tempo; a
//   Responsabilidade NÃO é bloqueador de elegibilidade/execução.
// - Coerência de contexto SEM reclassificação automática:
//   * Mudar context da Responsabilidade com QUALQUER vínculo (Resultado ou
//     Avanço direto, todos os estados) é rejeitado — desvincular antes.
//   * Mudar context/vínculo de Resultado/Avanço: os NOVOS vínculos não podem
//     ficar incompatíveis (verificação escopada; filhos não são regravados).
// - title/description/status da Responsabilidade mudam sem exigir desvincular.
// - Nenhuma varredura de dados históricos; campos omitidos em PATCH preservam
//   o valor anterior (o modelo compara com o original, não com payload vazio).
//
// NOTAS JSVM desta instância: lógica INLINE nos callbacks (sem declarações de
// topo); runInTransaction callback é void; http.* não existe (classes nativas
// BadRequestError/ForbiddenError/ApiError com códigos literais).
//
// Compatibilidade com a numeração (sequence-number.pb.js): estas guardas não
// leem nem escrevem sequence_number e não abrem transação própria — só
// consultam com a app corrente e chamam e.next().

// ---------- responsibilities: API comum ----------
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  // Proprietário sempre deriva da sessão; payload nunca decide o dono.
  e.record.set('user_id', e.auth.id)
  // Criação normal começa ativa quando o status é omitido/vazio.
  if (!e.record.getString('status')) e.record.set('status', 'ativa')
  return e.next()
}, 'responsibilities')

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  if (!e.auth) throw new UnauthorizedError()
  // Propriedade imutável pela API comum: payload nunca troca o dono.
  e.record.set('user_id', e.record.original().getString('user_id'))
  return e.next()
}, 'responsibilities')

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next()
  throw new ForbiddenError('Exclusão definitiva não é permitida pela API do app.')
}, 'responsibilities')

// ---------- responsibilities: modelo (dono/contexto/arquivamento) ----------
onRecordCreate((e) => {
  const rec = e.record
  // Status default também para criação programática (sem status → ativa).
  if (!rec.getString('status')) rec.set('status', 'ativa')

  const userId = rec.getString('user_id')
  if (!userId) throw new BadRequestError('Responsabilidade exige dono.')

  // Título só de espaços é inválido (nível modelo, além do pattern do campo).
  if (!rec.getString('title').trim()) {
    throw new BadRequestError('Título é obrigatório.')
  }

  const context = rec.getString('context')
  if (context !== 'vida' && context !== 'trabalho') {
    throw new BadRequestError('Contexto da responsabilidade é obrigatório (vida ou trabalho).')
  }
  const status = rec.getString('status')
  if (status !== 'ativa' && status !== 'arquivada') {
    throw new BadRequestError('Status da responsabilidade deve ser ativa ou arquivada.')
  }
  return e.next()
}, 'responsibilities')

onRecordUpdate((e) => {
  const rec = e.record
  const orig = rec.original()

  // Propriedade imutável em qualquer caminho de persistência.
  const persistedOwner = orig.getString('user_id')
  if (rec.getString('user_id') !== persistedOwner) {
    throw new BadRequestError('Propriedade da responsabilidade é imutável.')
  }

  // Mudar context com QUALQUER vínculo ainda atrelado é rejeitado
  // (considera Resultados e Avanços diretos, TODOS os estados).
  if (rec.getString('context') !== orig.getString('context')) {
    const boundProjects = e.app.countRecords('projects', 'responsibility_id = {:r}', { r: rec.id })
    if (boundProjects > 0) {
      throw new BadRequestError(
        'Existem Resultados vinculados a esta responsabilidade — desvincule-os antes de mudar o contexto.',
      )
    }
    const boundActions = e.app.countRecords('actions', 'responsibility_id = {:r}', { r: rec.id })
    if (boundActions > 0) {
      throw new BadRequestError(
        'Existem Avanços com vínculo direto a esta responsabilidade — desvincule-os antes de mudar o contexto.',
      )
    }
  }
  return e.next()
}, 'responsibilities')

// ---------- projects: vínculo com Responsabilidade (modelo) ----------
onRecordCreate((e) => {
  const rec = e.record
  const respId = rec.getString('responsibility_id')
  if (respId) {
    let resp
    try {
      resp = e.app.findRecordById('responsibilities', respId)
    } catch (_) {
      throw new BadRequestError('Responsabilidade vinculada não existe.')
    }
    if (resp.getString('user_id') !== rec.getString('user_id')) {
      throw new ForbiddenError('Responsabilidade vinculada pertence a outro usuário.')
    }
    if (resp.getString('context') !== rec.getString('context')) {
      throw new BadRequestError('Contexto da responsabilidade difere do contexto do Resultado.')
    }
    if (resp.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige responsabilidade ativa.')
    }
  }
  return e.next()
}, 'projects')

onRecordUpdate((e) => {
  const rec = e.record
  const orig = rec.original()

  // Vínculo NOVO ou TROCADO exige destino existente, mesmo dono, mesmo
  // contexto e status ativa. Desvincular/remover vínculo é sempre permitido;
  // campos omitidos preservam o anterior (comparação com o original).
  const respId = rec.getString('responsibility_id')
  const prevRespId = orig.getString('responsibility_id')
  if (respId && respId !== prevRespId) {
    let resp
    try {
      resp = e.app.findRecordById('responsibilities', respId)
    } catch (_) {
      throw new BadRequestError('Responsabilidade vinculada não existe.')
    }
    if (resp.getString('user_id') !== rec.getString('user_id')) {
      throw new ForbiddenError('Responsabilidade vinculada pertence a outro usuário.')
    }
    if (resp.getString('context') !== rec.getString('context')) {
      throw new BadRequestError('Contexto da responsabilidade difere do contexto do Resultado.')
    }
    if (resp.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige responsabilidade ativa.')
    }
  }

  // Mudança de contexto do Resultado: se ele TERÁ responsabilidade após o
  // patch, o novo vínculo precisa ser compatível com o novo contexto
  // (verificação escopada, sem regravar filhos — herança é resolvida na
  // leitura e nunca é gravada nos Avanços).
  const nextContext = rec.getString('context')
  const nextRespId = rec.getString('responsibility_id')
  if (nextRespId && nextContext) {
    let resp
    try {
      resp = e.app.findRecordById('responsibilities', nextRespId)
    } catch (_) {
      resp = null
    }
    if (resp && resp.getString('context') !== nextContext) {
      throw new BadRequestError(
        'Contexto novo do Resultado deixaria o vínculo de responsabilidade incompatível.',
      )
    }
  }
  return e.next()
}, 'projects')

// ---------- actions: vínculo DIRETO somente para Avanço SOLTO (modelo) ----------
onRecordCreate((e) => {
  const rec = e.record
  const respId = rec.getString('responsibility_id')
  if (respId) {
    if (rec.getString('project_id')) {
      throw new BadRequestError(
        'Avanço subordinado a Resultado não tem vínculo direto de responsabilidade — a efetiva é herdada do Resultado.',
      )
    }
    let resp
    try {
      resp = e.app.findRecordById('responsibilities', respId)
    } catch (_) {
      throw new BadRequestError('Responsabilidade vinculada não existe.')
    }
    if (resp.getString('user_id') !== rec.getString('user_id')) {
      throw new ForbiddenError('Responsabilidade vinculada pertence a outro usuário.')
    }
    if (resp.getString('context') !== rec.getString('context')) {
      throw new BadRequestError('Contexto da responsabilidade difere do contexto do Avanço.')
    }
    if (resp.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige responsabilidade ativa.')
    }
  }
  return e.next()
}, 'actions')

onRecordUpdate((e) => {
  const rec = e.record
  const orig = rec.original()
  const respId = rec.getString('responsibility_id')
  const prevRespId = orig.getString('responsibility_id')
  const goingToProject =
    rec.getString('project_id') && rec.getString('project_id') !== orig.getString('project_id')

  // Avanço passa a ter Resultado: o MESMO patch não pode manter vínculo
  // direto (deve removê-lo explicitamente — não limpar silenciosamente nem
  // escolher um dos pais). Herança é resolvida na leitura.
  if (goingToProject && respId) {
    throw new BadRequestError(
      'Remova explicitamente o vínculo direto de responsabilidade neste mesmo patch: Avanço subordinado herda a responsabilidade do Resultado.',
    )
  }

  // Avanço sai de Resultado: NÃO preencher vínculo direto automaticamente —
  // pode ficar solto sem responsabilidade ou receber uma escolhida
  // explicitamente no mesmo patch.
  const leavingProject = !rec.getString('project_id') && orig.getString('project_id') ? true : false
  if (leavingProject && respId && respId === prevRespId) {
    throw new BadRequestError(
      'Avanço saindo de Resultado não mantém vínculo direto automático — remova-o ou escolha outro explicitamente no mesmo patch.',
    )
  }

  // Avanço solto: vínculo novo/trocado exige destino existente, mesmo dono,
  // mesmo contexto e status ativa. Desvincular/remover é sempre permitido.
  if (respId && respId !== prevRespId) {
    if (rec.getString('project_id')) {
      throw new BadRequestError(
        'Avanço subordinado a Resultado não tem vínculo direto de responsabilidade — a efetiva é herdada do Resultado.',
      )
    }
    let resp
    try {
      resp = e.app.findRecordById('responsibilities', respId)
    } catch (_) {
      throw new BadRequestError('Responsabilidade vinculada não existe.')
    }
    if (resp.getString('user_id') !== rec.getString('user_id')) {
      throw new ForbiddenError('Responsabilidade vinculada pertence a outro usuário.')
    }
    if (resp.getString('context') !== rec.getString('context')) {
      throw new BadRequestError('Contexto da responsabilidade difere do contexto do Avanço.')
    }
    if (resp.getString('status') !== 'ativa') {
      throw new BadRequestError('Novo vínculo exige responsabilidade ativa.')
    }
  }

  // Mudança de contexto do Avanço: os NOVOS vínculos não podem ficar
  // incompatíveis (novo vínculo direto já é validado acima contra o contexto
  // novo do próprio Avanço; herança do Resultado nunca é gravada no Avanço).
  return e.next()
}, 'actions')
