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

  let result
  try {
    result = e.app.runInTransaction((txApp) => {
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
          existing = txApp.findRecordById(
            targetType === 'project' ? 'projects' : 'actions',
            targetId,
          )
        } catch (_) {
          throw new BadRequestError(
            'Captura convertida aponta para um destino que não existe mais.',
          )
        }
        if (existing.getString('user_id') !== userId) {
          throw new ForbiddenError('Destino da captura pertence a outro usuário.')
        }
        return {
          duplicate: true,
          targetType: targetType,
          target: existing,
          capture: capture,
        }
      }

      if (status === 'descartada') {
        throw new BadRequestError('Captura descartada não pode ser convertida.')
      }
      if (status !== 'pendente') {
        throw new ConflictError('Captura não está mais pendente.')
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
        txApp.save(project)

        capture.set('status', 'convertida_projeto')
        capture.set('converted_project_id', project.id)
        txApp.save(capture)

        return { duplicate: false, targetType: 'project', target: project, capture: capture }
      }

      // target === 'action'
      const projectId = str(data.project_id)
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

      const action = new Record(txApp.findCollectionByNameOrId('actions'))
      action.set('user_id', userId) // derivado da sessão, nunca do payload
      action.set('title', title)
      action.set('context', context)
      action.set('status', 'pronta')
      action.set('is_next_step', false)
      action.set('is_today_selected', false)
      if (projectId) action.set('project_id', projectId)
      txApp.save(action)

      capture.set('status', 'convertida_acao')
      capture.set('converted_action_id', action.id)
      txApp.save(capture)

      return { duplicate: false, targetType: 'action', target: action, capture: capture }
    })
  } catch (err) {
    if (
      err instanceof BadRequestError ||
      err instanceof ForbiddenError ||
      err instanceof UnauthorizedError ||
      err instanceof NotFoundError ||
      err instanceof ConflictError
    ) {
      throw err
    }
    throw new BadRequestError('Falha na conversão: ' + (err && err.message ? err.message : err))
  }

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
          aspiration: expanded.getString('aspiration'),
          controllable_delivery: expanded.getString('controllable_delivery'),
          completion_condition: expanded.getString('completion_condition'),
          created: expanded.getString('created'),
          updated: expanded.getString('updated'),
        }
      : {
          id: expanded.id,
          user_id: expanded.getString('user_id'),
          project_id: expanded.getString('project_id') || undefined,
          title: expanded.getString('title'),
          context: expanded.getString('context'),
          status: expanded.getString('status'),
          deadline: expanded.getString('deadline'),
          is_next_step: expanded.getBool('is_next_step'),
          is_today_selected: expanded.getBool('is_today_selected'),
          waiting_for: expanded.getString('waiting_for'),
          expand: expanded.expand('project_id')
            ? { project_id: expanded.expand('project_id') }
            : undefined,
        }

  return e.json(http.StatusOK, {
    duplicate: result.duplicate,
    target_type: result.targetType,
    target: targetPayload,
    capture: capturePayload,
  })
})
