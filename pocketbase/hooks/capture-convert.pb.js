// FATIA P1B — Conversão idempotente de capturas (rota nativa autenticada).
//
// POST /backend/v1/pc/captures/{id}/convert   body: { target: 'project' | 'action', data: {...} }
//
// Esta instância Skip Cloud exige que rotas custom novas usem o prefixo
// /backend/v1/ (namespace /api/ é reservado ao PocketBase). O caminho
// registrado é o caminho exato servido — routerAdd não acrescenta prefixo.
//
// Garantias (backend nativo, dentro de UMA transação SQLite):
// - Sessão obrigatória; proprietário do destino é sempre derivado da sessão
//   (e.auth.id) — o payload nunca decide o dono (regra P0 preservada).
// - Valida estado da captura: precisa pertencer à sessão e estar 'pendente'.
//   Se já estiver convertida, retorna 200 com o destino EXISTENTE (idempotente
//   — retry/duplo clique não cria segundo destino). Se estiver em outro estado,
//   409.
// - Valida relações (project_id da ação: mesmo dono e mesmo contexto).
// - Responsabilidade opcional (3C2A): data.responsibility_id vai para
//   projects.responsibility_id (Resultado) ou actions.responsibility_id
//   (Avanço SOLTO — subordinado fica vazio, herança é do Resultado corrente).
//   Validada na MESMA transação: existe, dono da sessão, mesmo contexto e
//   ativa — antes de qualquer gravação. O caminho idempotente (já convertida)
//   roda ANTES dessas checagens e nunca toca a Responsabilidade do destino.
// - Estratégia opcional (4C1): data.strategy_id vai SOMENTE para
//   actions.strategy_id de um Avanço COM Resultado validado — 0..1 grupo,
//   NUNCA inferido por pai/título/Responsabilidade. Omitido ou string
//   exatamente vazia = nenhum vínculo (contrato opcional vigente); tipo
//   inválido é REJEITADO, não transformado em Nenhuma. Validada na MESMA
//   transação via txApp (existe, dono da sessão, project_id EXATAMENTE o pai
//   validado do novo Avanço, ativa — vínculo novo nunca usa grupo arquivado),
//   ANTES de qualquer gravação. Avanço SOLTO com strategy_id e novo Resultado
//   com strategy_id são rejeitados (projects não tem strategy_id). O caminho
//   idempotente (já convertida) roda ANTES dessas checagens e devolve o
//   destino EXISTENTE com duplicate:true — nunca lê nem ecoa a escolha da
//   repetição, nunca altera a Estratégia do destino.
// - Cria o destino e vincula a captura ATOMICAMENTE (mesma transação).
// - Texto original (raw_text) nunca é alterado.
//
// NOTA JSVM: hooks não acessam declarações de topo — toda a lógica fica
// inline dentro do callback (restrição conhecida desta instância).

routerAdd('POST', '/backend/v1/pc/captures/{captureId}/convert', (e) => {
  const info = e.requestInfo()
  const auth = e.auth
  if (!auth || !auth.id) {
    throw new UnauthorizedError('Sessão ausente.')
  }
  const userId = auth.id

  const body = info.body || {}
  const target = body.target
  if (target !== 'project' && target !== 'action') {
    throw new BadRequestError('target deve ser "project" ou "action".')
  }
  const data = body.data && typeof body.data === 'object' ? body.data : {}

  const captureId = e.request.pathValue('captureId')

  // ---------- validação de entrada do payload ----------
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  if (!title) throw new BadRequestError('Título é obrigatório.')

  const context = data.context === 'vida' ? 'vida' : 'trabalho'

  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  // Contrato nativo de runInTransaction: fn: (txApp) => void. O retorno do
  // callback NÃO pode ser um objeto (o lado Go tenta convertê-lo em erro —
  // "could not convert [object Object] to error" — e reverte a transação).
  // O resultado é carregado nesta variável LOCAL, por requisição, e a resposta
  // HTTP só é enviada DEPOIS do commit bem-sucedido.
  let result = null

  e.app.runInTransaction((txApp) => {
    // ---------- captura: dono + estado ----------
    let capture
    try {
      capture = txApp.findRecordById('captures', captureId)
    } catch (_) {
      throw new NotFoundError('Captura não encontrada.')
    }
    if (capture.getString('user_id') !== userId) {
      throw new ForbiddenError('Captura pertence a outro usuário.')
    }

    const status = capture.getString('status')

    // Idempotência: captura já convertida → devolve o destino real.
    if (status === 'convertida_projeto' || status === 'convertida_acao') {
      const existingProjectId = capture.getString('converted_project_id')
      const existingActionId = capture.getString('converted_action_id')
      let targetId = ''
      let targetType = ''
      if (status === 'convertida_projeto' && existingProjectId) {
        targetId = existingProjectId
        targetType = 'project'
      } else if (status === 'convertida_acao' && existingActionId) {
        targetId = existingActionId
        targetType = 'action'
      } else {
        throw new BadRequestError(
          'Captura em estado inconsistente: marcada como convertida sem destino válido.',
        )
      }
      let existing
      try {
        existing = txApp.findRecordById(targetType === 'project' ? 'projects' : 'actions', targetId)
      } catch (_) {
        throw new BadRequestError('Captura convertida aponta para um destino que não existe mais.')
      }
      if (existing.getString('user_id') !== userId) {
        throw new ForbiddenError('Destino da captura pertence a outro usuário.')
      }
      result = {
        duplicate: true,
        targetType: targetType,
        target: existing,
        capture: capture,
      }
      return
    }

    if (status === 'descartada') {
      throw new BadRequestError('Captura descartada não pode ser convertida.')
    }
    if (status !== 'pendente') {
      // 409 nativo da JSVM (não existe ConflictError nesta instância).
      throw new ApiError(409, 'Captura não está mais pendente.')
    }

    // ---------- Responsabilidade opcional (3C2A) ----------
    // OPCIONAL: omitido ou '' = nenhum vínculo direto novo. Quando informado,
    // DEVE ser string — tipo inválido é rejeitado, nunca convertido em Nenhuma.
    // Validação (existe/dono/contexto/ativa) aqui dentro da transação, ANTES
    // de qualquer gravação de destino/captura.
    const rawResponsibilityId = data.responsibility_id
    let responsibilityId = ''
    if (
      rawResponsibilityId !== undefined &&
      rawResponsibilityId !== null &&
      rawResponsibilityId !== ''
    ) {
      if (typeof rawResponsibilityId !== 'string') {
        throw new BadRequestError('Responsabilidade informada é inválida.')
      }
      responsibilityId = rawResponsibilityId.trim()
    }
    if (responsibilityId) {
      let responsibility
      try {
        responsibility = txApp.findRecordById('responsibilities', responsibilityId)
      } catch (_) {
        throw new BadRequestError('Responsabilidade informada não existe.')
      }
      if (responsibility.getString('user_id') !== userId) {
        throw new ForbiddenError('Responsabilidade pertence a outro usuário.')
      }
      if (responsibility.getString('context') !== context) {
        throw new BadRequestError('Responsabilidade está em contexto diferente do destino.')
      }
      if (responsibility.getString('status') !== 'ativa') {
        throw new BadRequestError('Responsabilidade arquivada não pode ser vinculada.')
      }
    }

    // ---------- Estratégia opcional (4C1) ----------
    // OPCIONAL e SEM inferência: omitido ou string EXATAMENTE vazia = nenhum
    // vínculo. Qualquer outro tipo (null/array/objeto/número) é REJEITADO —
    // nunca transformado em Nenhuma por trim/default; string só de espaços
    // também é rejeitada (apenas '' exato significa Nenhuma).
    const rawStrategyId = data.strategy_id
    let strategyId = ''
    if (rawStrategyId !== undefined) {
      if (rawStrategyId === '') {
        strategyId = ''
      } else if (typeof rawStrategyId !== 'string') {
        throw new BadRequestError('Estratégia informada é inválida.')
      } else {
        strategyId = rawStrategyId.trim()
        if (!strategyId) {
          throw new BadRequestError('Estratégia informada é inválida.')
        }
      }
    }
    if (target === 'project' && strategyId) {
      // Novo Resultado não pertence a Estratégia de outro Resultado e projects
      // NÃO tem strategy_id: não vazio é rejeitado, não ignorado nem copiado.
      // Nenhuma Estratégia automática é criada na conversão de Resultado.
      throw new BadRequestError(
        'Estratégia não pode ser atribuída a um novo Resultado — o vínculo de Estratégia pertence ao Avanço.',
      )
    }

    // ---------- criação do destino + vínculo (mesma transação) ----------
    if (target === 'project') {
      const project = new Record(txApp.findCollectionByNameOrId('projects'))
      project.set('user_id', userId) // derivado da sessão, nunca do payload
      project.set('title', title)
      project.set('context', context)
      project.set('status', 'rascunho')
      if (str(data.aspiration)) project.set('aspiration', str(data.aspiration))
      if (str(data.controllable_delivery)) {
        project.set('controllable_delivery', str(data.controllable_delivery))
      }
      if (str(data.completion_condition)) {
        project.set('completion_condition', str(data.completion_condition))
      }
      if (responsibilityId) project.set('responsibility_id', responsibilityId)
      txApp.save(project)

      capture.set('status', 'convertida_projeto')
      capture.set('converted_project_id', project.id)
      txApp.save(capture)

      result = { duplicate: false, targetType: 'project', target: project, capture: capture }
      return
    }

    // target === 'action'
    const projectId = str(data.project_id)
    if (projectId && responsibilityId) {
      // Avanço COM Resultado: campo direto fica VAZIO — herança é resolvida
      // pelo Resultado corrente (mesmo se a Responsabilidade dele estiver
      // arquivada). Rejeita explicitamente; não limpa nem modifica o Resultado.
      throw new BadRequestError(
        'Responsabilidade não pode ser definida diretamente em um Avanço com Resultado — a herança vem do Resultado.',
      )
    }
    if (projectId) {
      let project
      try {
        project = txApp.findRecordById('projects', projectId)
      } catch (_) {
        throw new BadRequestError('Projeto relacionado inválido.')
      }
      if (project.getString('user_id') !== userId) {
        throw new ForbiddenError('Projeto relacionado pertence a outro usuário.')
      }
      if (project.getString('context') !== context) {
        throw new BadRequestError('Contexto da ação difere do contexto do projeto.')
      }
    }

    // Estratégia (4C1): só Avanço COM Resultado, 0..1, SEM inferência por
    // pai/título/Responsabilidade/contexto. Avanço SOLTO com strategy_id é
    // rejeitado (inclusive com Responsabilidade direta).
    if (strategyId && !projectId) {
      throw new BadRequestError(
        'Avanço sem Resultado não recebe estratégia — a estratégia pertence a um Resultado-pai.',
      )
    }
    if (strategyId) {
      // Vínculo NOVO: registro existe, dono derivado da sessão, project_id
      // EXATAMENTE o pai validado do novo Avanço e status ativa — grupo
      // arquivado por vínculo antigo de outro Avanço NÃO serve. Consultas pela
      // MESMA txApp, ANTES de qualquer save de destino/captura (a guarda 4A de
      // modelo permanece ativa e também cobre txApp.save).
      let strategy
      try {
        strategy = txApp.findRecordById('strategies', strategyId)
      } catch (_) {
        throw new BadRequestError('Estratégia informada não existe.')
      }
      if (strategy.getString('user_id') !== userId) {
        throw new ForbiddenError('Estratégia pertence a outro usuário.')
      }
      if (strategy.getString('project_id') !== projectId) {
        throw new BadRequestError('Estratégia pertence a outro Resultado.')
      }
      if (strategy.getString('status') !== 'ativa') {
        throw new BadRequestError('Estratégia arquivada não pode ser vinculada a um novo Avanço.')
      }
    }

    const action = new Record(txApp.findCollectionByNameOrId('actions'))
    action.set('user_id', userId) // derivado da sessão, nunca do payload
    action.set('title', title)
    action.set('context', context)
    action.set('status', 'pronta')
    action.set('is_next_step', false)
    action.set('is_today_selected', false)
    if (projectId) action.set('project_id', projectId)
    if (responsibilityId) action.set('responsibility_id', responsibilityId) // só Avanço solto
    if (strategyId) action.set('strategy_id', strategyId) // só Avanço com Resultado validado
    txApp.save(action)

    capture.set('status', 'convertida_acao')
    capture.set('converted_action_id', action.id)
    txApp.save(capture)

    result = { duplicate: false, targetType: 'action', target: action, capture: capture }
  })

  // Transação commitada com sucesso: `result` obrigatoriamente foi definido
  // por uma das saídas acima. Se não foi, é falha interna — o erro sobe para
  // o handler global (nunca enviar sucesso antes do commit, nem em finally).
  if (!result) {
    throw new ApiError(500, 'Falha interna na conversão da captura.')
  }
  // Sem wrapper try/catch no bloco da transação: erros de rota (ApiError 4xx,
  // UnauthorizedError, BadRequestError, ...) e falhas internas seguem direto
  // para o handler global de erros do PocketBase, que responde com o
  // status/message do ApiError e registra o erro original nos logs — sem
  // mascaramento nem concatenação de err.message bruto numa resposta ao
  // usuário. (Antes: cadeia instanceof com ConflictError — classe inexistente
  // na JSVM — estourava ReferenceError e ocultava o erro da transação.)

  const targetObj = result.target
  const targetId = targetObj.id
  const targetCol = result.targetType === 'project' ? 'projects' : 'actions'
  let expanded
  try {
    expanded = e.app.findRecordById(targetCol, targetId, { expand: 'project_id' })
  } catch (_) {
    expanded = targetObj
  }

  const cap = result.capture
  const capturePayload = {
    id: cap.id,
    user_id: cap.getString('user_id'),
    raw_text: cap.getString('raw_text'),
    status: cap.getString('status'),
    converted_project_id: cap.getString('converted_project_id') || undefined,
    converted_action_id: cap.getString('converted_action_id') || undefined,
    created: cap.getString('created'),
    updated: cap.getString('updated'),
  }

  const targetPayload =
    result.targetType === 'project'
      ? {
          id: expanded.id,
          user_id: expanded.getString('user_id'),
          title: expanded.getString('title'),
          context: expanded.getString('context'),
          status: expanded.getString('status'),
          sequence_number: expanded.getInt('sequence_number'),
          aspiration: expanded.getString('aspiration'),
          controllable_delivery: expanded.getString('controllable_delivery'),
          completion_condition: expanded.getString('completion_condition'),
          responsibility_id: expanded.getString('responsibility_id') || undefined,
          created: expanded.getString('created'),
          updated: expanded.getString('updated'),
        }
      : {
          id: expanded.id,
          user_id: expanded.getString('user_id'),
          project_id: expanded.getString('project_id') || undefined,
          responsibility_id: expanded.getString('responsibility_id') || undefined,
          strategy_id: expanded.getString('strategy_id') || undefined,
          title: expanded.getString('title'),
          context: expanded.getString('context'),
          status: expanded.getString('status'),
          sequence_number: expanded.getInt('sequence_number'),
          deadline: expanded.getString('deadline'),
          is_next_step: expanded.getBool('is_next_step'),
          is_today_selected: expanded.getBool('is_today_selected'),
          waiting_for: expanded.getString('waiting_for'),
          description: expanded.getString('description'),
          expand: expanded.expand('project_id')
            ? { project_id: expanded.expand('project_id') }
            : undefined,
        }

  return e.json(200, {
    duplicate: result.duplicate,
    target_type: result.targetType,
    target: targetPayload,
    capture: capturePayload,
  })
})
