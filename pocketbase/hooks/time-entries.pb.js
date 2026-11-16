// FATIA — REGISTRO DE TEMPO V1: rotas nativas /backend/v1/time/*.
//
// Toda escrita de time_entries passa AQUI (createRule/updateRule/deleteRule
// = null no schema): dono sempre derivado da sessão (e.auth.id), nunca do
// payload; validação server-side de alvo, estado, datas e duração; apenas UM
// intervalo corringo por dono (índice único + verificação transacional);
// idempotência por op_id (identidade estável da operação); anulação/correção
// apenas LÓGICAS.
//
// NOTA JSVM (restrições duráveis desta instância):
// - hooks não acessam declarações de topo — TODA a lógica fica inline dentro
//   de cada callback (helpers são duplicados por rota, como em capture-convert);
// - http.StatusOK etc. NÃO existem — literais numéricos (200, 400, 409, 500);
// - runInTransaction: callback contrato VOID — resultado em variável local e
//   resposta HTTP só DEPOIS do commit.

routerAdd('POST', '/backend/v1/time/running', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  let found = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const rows = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s}',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (rows.length > 0) found = rows[0]
    })
  } catch (_) {
    txErr = new ApiError(500, 'Falha ao consultar o intervalo correndo.')
  }
  if (txErr) throw txErr
  if (!found) return e.json(200, { running: null })

  let a = null
  let p = null
  if (found.getString('action_id')) {
    try {
      a = e.app.findRecordById('actions', found.getString('action_id'))
    } catch (_) {}
  }
  if (found.getString('project_id')) {
    try {
      p = e.app.findRecordById('projects', found.getString('project_id'))
    } catch (_) {}
  }
  return e.json(200, {
    running: {
      id: found.id,
      target_type: found.getString('target_type'),
      action_id: found.getString('action_id') || null,
      project_id: found.getString('project_id') || null,
      context: found.getString('context'),
      started_at: found.getDateTime('started_at').string() || null,
      duration_seconds: found.getInt('duration_seconds'),
      entry_date: found.getString('entry_date'),
      status: found.getString('status'),
      op_id: found.getString('op_id'),
      target_title: a ? a.getString('title') : p ? p.getString('title') : '',
      target_status: a ? a.getString('status') : p ? p.getString('status') : '',
    },
  })
})

routerAdd('POST', '/backend/v1/time/start', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const targetType = body.target_type
  if (targetType !== 'action' && targetType !== 'project') {
    throw new BadRequestError('target_type deve ser "action" ou "project".')
  }
  const targetId = str(body.target_id)
  if (!targetId) throw new BadRequestError('target_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')

  const allowed = targetType === 'action' ? ['pronta', 'em_andamento'] : ['ativo', 'rascunho']

  let result = null
  let runningId = null
  let runningTitle = ''
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      // ---------- idempotência por op_id ----------
      const sameOp = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && op_id = {:o}',
        '-created',
        1,
        0,
        { u: userId, o: opId },
      )
      if (sameOp.length > 0) {
        const exOp = sameOp[0]
        const exTarget = exOp.getString('target_type')
        if (exTarget === targetType && exOp.getString(targetType + '_id') === targetId) {
          result = { duplicate: true, entry: exOp }
        } else {
          txErr = new ApiError(409, 'op_id já usado com outro alvo; recarregue a página.')
        }
        return
      }

      // ---------- alvo: mesmo dono + estado ----------
      let rec = null
      try {
        rec = txApp.findRecordById(targetType === 'action' ? 'actions' : 'projects', targetId)
      } catch (_) {
        txErr = new NotFoundError('Alvo não encontrado.')
        return
      }
      if (rec.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Alvo pertence a outro usuário.')
        return
      }
      const st = rec.getString('status')
      if (allowed.indexOf(st) === -1) {
        txErr = new ApiError(
          409,
          'Alvo em estado "' +
            st +
            '" não inicia novo cronômetro; mude o status pelos comandos já existentes.',
        )
        return
      }

      // ---------- apenas UM correndo por dono ----------
      const running = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s}',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (running.length > 0) {
        runningId = running[0].id
        const rt = running[0].getString('target_type')
        try {
          const tgt = txApp.findRecordById(
            rt === 'action' ? 'actions' : 'projects',
            running[0].getString(rt + '_id'),
          )
          runningTitle = tgt.getString('title')
        } catch (_) {
          runningTitle = 'outro intervalo'
        }
        txErr = new ApiError(409, 'already-running')
        return
      }

      // ---------- cria o período ----------
      const now = new Date().toISOString()
      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId) // derivado da sessão, nunca do payload
      entry.set('target_type', targetType)
      entry.set(targetType + '_id', targetId)
      entry.set('context', rec.getString('context'))
      entry.set('started_at', now)
      entry.set('duration_seconds', 0)
      entry.set('entry_date', now.slice(0, 10))
      entry.set('origin', 'timer')
      entry.set('status', 'running')
      entry.set('op_id', opId)
      txApp.save(entry)
      result = { duplicate: false, entry: entry }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao gravar o início do cronômetro; nada foi gravado.')
    }
  }

  if (txErr) {
    if (txErr.message === 'already-running') {
      return e.json(409, {
        error: 'already-running',
        message: 'Já existe um cronômetro correndo. Pause ou encerre antes de iniciar outro.',
        running: runningId ? { id: runningId, target_title: runningTitle } : null,
      })
    }
    throw txErr
  }
  if (!result) throw new ApiError(500, 'Falha interna ao iniciar o cronômetro.')

  const entry = result.entry
  let title = ''
  if (entry.getString('action_id')) {
    try {
      title = e.app.findRecordById('actions', entry.getString('action_id')).getString('title')
    } catch (_) {}
  } else if (entry.getString('project_id')) {
    try {
      title = e.app.findRecordById('projects', entry.getString('project_id')).getString('title')
    } catch (_) {}
  }

  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      target_type: entry.getString('target_type'),
      action_id: entry.getString('action_id') || null,
      project_id: entry.getString('project_id') || null,
      context: entry.getString('context'),
      started_at: entry.getDateTime('started_at').string() || null,
      duration_seconds: entry.getInt('duration_seconds'),
      entry_date: entry.getString('entry_date'),
      status: entry.getString('status'),
      op_id: entry.getString('op_id'),
      target_title: title,
    },
  })
})

routerAdd('POST', '/backend/v1/time/stop', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const entryId = str(body.entry_id)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  const action = body.action // 'pause' | 'end'
  if (action !== 'pause' && action !== 'end') {
    throw new BadRequestError('action deve ser "pause" ou "end".')
  }

  let result = null
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      // ---------- idempotência por op_id ----------
      const sameOp = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && op_id = {:o}',
        '-created',
        1,
        0,
        { u: userId, o: opId },
      )
      if (sameOp.length > 0) {
        result = { duplicate: true, entry: sameOp[0] }
        return
      }

      // ---------- intervalo ESPECÍFICO (não encerra o de outra aba) ----------
      let rec = null
      try {
        rec = txApp.findRecordById('time_entries', entryId)
      } catch (_) {
        txErr = new NotFoundError('Intervalo não encontrado.')
        return
      }
      if (rec.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Intervalo pertence a outro usuário.')
        return
      }
      if (rec.getString('status') !== 'running') {
        txErr = new ApiError(
          409,
          'Este intervalo não está mais correndo (outra aba encerrou ou ele já foi pausado); recarregue o estado antes de repetir.',
        )
        return
      }

      // ---------- duração derivada dos instantes persistidos ----------
      const now = new Date().toISOString()
      const started = rec.getDateTime('started_at').string()
      const secs = Math.round((Date.parse(now) - Date.parse(started)) / 1000)
      if (!isFinite(secs) || secs < 0) {
        txErr = new ApiError(400, 'Duração inválida derivada dos instantes persistidos.')
        return
      }

      rec.set('ended_at', now)
      rec.set('duration_seconds', secs) // instantes persistidos; nunca ticks
      rec.set('status', action === 'pause' ? 'paused' : 'ended')
      rec.set('op_id', opId) // identidade da operação de encerramento
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao encerrar o intervalo; nada foi gravado.')
    }
  }

  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao encerrar o intervalo.')

  const entry = result.entry
  let title = ''
  if (entry.getString('action_id')) {
    try {
      title = e.app.findRecordById('actions', entry.getString('action_id')).getString('title')
    } catch (_) {}
  } else if (entry.getString('project_id')) {
    try {
      title = e.app.findRecordById('projects', entry.getString('project_id')).getString('title')
    } catch (_) {}
  }

  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      target_type: entry.getString('target_type'),
      action_id: entry.getString('action_id') || null,
      project_id: entry.getString('project_id') || null,
      context: entry.getString('context'),
      started_at: entry.getDateTime('started_at').string() || null,
      ended_at: entry.getDateTime('ended_at').string() || null,
      duration_seconds: entry.getInt('duration_seconds'),
      entry_date: entry.getString('entry_date'),
      origin: entry.getString('origin'),
      note: entry.getString('note') || null,
      status: entry.getString('status'),
      op_id: entry.getString('op_id'),
      target_title: title,
    },
  })
})

routerAdd('POST', '/backend/v1/time/resume', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const entryId = str(body.entry_id)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')

  let result = null
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      // ---------- idempotência por op_id ----------
      const sameOp = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && op_id = {:o}',
        '-created',
        1,
        0,
        { u: userId, o: opId },
      )
      if (sameOp.length > 0) {
        result = { duplicate: true, entry: sameOp[0] }
        return
      }

      let paused = null
      try {
        paused = txApp.findRecordById('time_entries', entryId)
      } catch (_) {
        txErr = new NotFoundError('Intervalo pausado não encontrado.')
        return
      }
      if (paused.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Intervalo pertence a outro usuário.')
        return
      }
      if (paused.getString('status') !== 'paused') {
        txErr = new ApiError(409, 'Só intervalo pausado pode ser retomado.')
        return
      }

      // ---------- revalidar elegibilidade ATUAL do alvo ----------
      const targetType = paused.getString('target_type')
      const allowed = targetType === 'action' ? ['pronta', 'em_andamento'] : ['ativo', 'rascunho']
      let target = null
      try {
        target = txApp.findRecordById(
          targetType === 'action' ? 'actions' : 'projects',
          paused.getString(targetType + '_id'),
        )
      } catch (_) {
        txErr = new NotFoundError('Alvo do intervalo não existe mais; revise o tempo registrado.')
        return
      }
      if (target.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Alvo pertence a outro usuário.')
        return
      }
      if (allowed.indexOf(target.getString('status')) === -1) {
        txErr = new ApiError(
          409,
          'O alvo mudou de estado ("' +
            target.getString('status') +
            '") durante a pausa; revise o tempo antes de retomar.',
        )
        return
      }

      // ---------- apenas UM correndo por dono ----------
      const running = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s}',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (running.length > 0) {
        txErr = new ApiError(
          409,
          'Já existe outro cronômetro correndo (outra aba/dispositivo). Encerre-o antes de retomar.',
        )
        return
      }

      // ---------- novo período no MESMO alvo (pausa não soma minutos) ----------
      const now = new Date().toISOString()
      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId)
      entry.set('target_type', targetType)
      entry.set(targetType + '_id', paused.getString(targetType + '_id'))
      entry.set('context', paused.getString('context'))
      entry.set('started_at', now)
      entry.set('duration_seconds', 0)
      entry.set('entry_date', now.slice(0, 10))
      entry.set('origin', 'timer')
      entry.set('status', 'running')
      entry.set('op_id', opId)
      txApp.save(entry)
      result = { duplicate: false, entry: entry }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao retomar o cronômetro; nada foi gravado.')
    }
  }

  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao retomar o cronômetro.')

  const entry = result.entry
  let title = ''
  if (entry.getString('action_id')) {
    try {
      title = e.app.findRecordById('actions', entry.getString('action_id')).getString('title')
    } catch (_) {}
  } else if (entry.getString('project_id')) {
    try {
      title = e.app.findRecordById('projects', entry.getString('project_id')).getString('title')
    } catch (_) {}
  }

  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      target_type: entry.getString('target_type'),
      action_id: entry.getString('action_id') || null,
      project_id: entry.getString('project_id') || null,
      context: entry.getString('context'),
      started_at: entry.getDateTime('started_at').string() || null,
      duration_seconds: entry.getInt('duration_seconds'),
      entry_date: entry.getString('entry_date'),
      status: entry.getString('status'),
      op_id: entry.getString('op_id'),
      target_title: title,
    },
  })
})

routerAdd('POST', '/backend/v1/time/manual', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const targetType = body.target_type
  if (targetType !== 'action' && targetType !== 'project') {
    throw new BadRequestError('target_type deve ser "action" ou "project".')
  }
  const targetId = str(body.target_id)
  if (!targetId) throw new BadRequestError('target_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')

  const dateText = str(body.entry_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new BadRequestError('entry_date deve ser dia-calendário YYYY-MM-DD.')
  }
  const secsRaw = body.duration_seconds
  const secs = typeof secsRaw === 'number' ? Math.round(secsRaw) : parseInt(String(secsRaw), 10)
  if (isNaN(secs) || secs <= 0) {
    throw new BadRequestError('duration_seconds deve ser positivo.')
  }
  const note = str(body.note).slice(0, 500)

  let result = null
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      // ---------- idempotência por op_id ----------
      const sameOp = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && op_id = {:o}',
        '-created',
        1,
        0,
        { u: userId, o: opId },
      )
      if (sameOp.length > 0) {
        result = { duplicate: true, entry: sameOp[0] }
        return
      }

      // ---------- alvo: mesmo dono (dedicação passada em qualquer estado) ----------
      let rec = null
      try {
        rec = txApp.findRecordById(targetType === 'action' ? 'actions' : 'projects', targetId)
      } catch (_) {
        txErr = new NotFoundError('Alvo não encontrado.')
        return
      }
      if (rec.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Alvo pertence a outro usuário.')
        return
      }

      // data manual futura não é aceita
      const todayUtc = new Date().toISOString().slice(0, 10)
      if (dateText > todayUtc) {
        txErr = new BadRequestError('Data manual não pode ser futura.')
        return
      }

      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId) // derivado da sessão
      entry.set('target_type', targetType)
      entry.set(targetType + '_id', targetId)
      entry.set('context', rec.getString('context'))
      // manual: SEM horário inventado — só dia + duração explícita
      entry.set('duration_seconds', secs)
      entry.set('entry_date', dateText)
      entry.set('origin', 'manual')
      entry.set('status', 'ended')
      entry.set('note', note)
      entry.set('op_id', opId)
      txApp.save(entry)
      result = { duplicate: false, entry: entry }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao gravar o tempo manual; nada foi gravado.')
    }
  }

  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao registrar tempo manual.')

  const entry = result.entry
  let title = ''
  if (entry.getString('action_id')) {
    try {
      title = e.app.findRecordById('actions', entry.getString('action_id')).getString('title')
    } catch (_) {}
  } else if (entry.getString('project_id')) {
    try {
      title = e.app.findRecordById('projects', entry.getString('project_id')).getString('title')
    } catch (_) {}
  }

  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      target_type: entry.getString('target_type'),
      action_id: entry.getString('action_id') || null,
      project_id: entry.getString('project_id') || null,
      context: entry.getString('context'),
      duration_seconds: entry.getInt('duration_seconds'),
      entry_date: entry.getString('entry_date'),
      origin: entry.getString('origin'),
      note: entry.getString('note') || null,
      status: entry.getString('status'),
      op_id: entry.getString('op_id'),
      target_title: title,
    },
  })
})

routerAdd('POST', '/backend/v1/time/update', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const entryId = str(body.entry_id)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  const dateText = str(body.entry_date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new BadRequestError('entry_date deve ser dia-calendário YYYY-MM-DD.')
  }
  const secsRaw = body.duration_seconds
  const secs = typeof secsRaw === 'number' ? Math.round(secsRaw) : parseInt(String(secsRaw), 10)
  if (isNaN(secs) || secs <= 0) {
    throw new BadRequestError('duration_seconds deve ser positivo.')
  }
  const note = str(body.note).slice(0, 500)
  const expectedUpdated = str(body.expected_updated) // correção concorrente

  let result = null
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      let rec = null
      try {
        rec = txApp.findRecordById('time_entries', entryId)
      } catch (_) {
        txErr = new NotFoundError('Intervalo não encontrado.')
        return
      }
      if (rec.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Intervalo pertence a outro usuário.')
        return
      }
      if (rec.getString('status') === 'running') {
        txErr = new ApiError(409, 'Intervalo correndo não é editado; pause ou encerre primeiro.')
        return
      }

      // correção concorrente: recarregar antes de confirmar
      if (expectedUpdated && rec.getDateTime('updated').string() !== expectedUpdated) {
        txErr = new ApiError(
          409,
          'O registro mudou desde a leitura; recarregue antes de confirmar.',
        )
        return
      }

      // valores mínimos ANTERIORES preservados p/ conferir a correção
      rec.set('previous_date', rec.getString('entry_date'))
      rec.set('previous_duration_seconds', rec.getInt('duration_seconds'))
      rec.set('previous_note', rec.getString('note') || '')
      rec.set('entry_date', dateText)
      rec.set('duration_seconds', secs)
      rec.set('note', note)
      rec.set('status', 'ended')
      rec.set('correction_of', rec.getString('correction_of') || entryId)
      rec.set('op_id', opId)
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao corrigir o registro; nada foi gravado.')
    }
  }

  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao corrigir o registro.')

  const entry = result.entry
  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      entry_date: entry.getString('entry_date'),
      duration_seconds: entry.getInt('duration_seconds'),
      note: entry.getString('note') || null,
      status: entry.getString('status'),
      previous_date: entry.getString('previous_date') || null,
      previous_duration_seconds: entry.getInt('previous_duration_seconds'),
      previous_note: entry.getString('previous_note') || null,
      correction_of: entry.getString('correction_of') || null,
      op_id: entry.getString('op_id'),
      updated: entry.getDateTime('updated').string() || null,
    },
  })
})

routerAdd('POST', '/backend/v1/time/delete', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const entryId = str(body.entry_id)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  const opId = str(body.op_id)
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  const reason = str(body.reason).slice(0, 200)

  let result = null
  let txErr = null

  try {
    e.app.runInTransaction((txApp) => {
      let rec = null
      try {
        rec = txApp.findRecordById('time_entries', entryId)
      } catch (_) {
        txErr = new NotFoundError('Intervalo não encontrado.')
        return
      }
      if (rec.getString('user_id') !== userId) {
        txErr = new ForbiddenError('Intervalo pertence a outro usuário.')
        return
      }
      if (rec.getString('status') === 'running') {
        txErr = new ApiError(409, 'Intervalo correndo não é anulado; pause ou encerre primeiro.')
        return
      }
      if (rec.getBool('is_deleted')) {
        result = { duplicate: true, entry: rec }
        return
      }

      // anulação LÓGICA — nunca apagar fisicamente tempo
      rec.set('is_deleted', true)
      rec.set('deleted_at', new Date().toISOString())
      rec.set('delete_reason', reason)
      rec.set('op_id', opId)
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (err) {
    if (!txErr) {
      txErr = new ApiError(500, 'Falha ao anular o registro; nada foi gravado.')
    }
  }

  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao anular o registro.')

  const entry = result.entry
  return e.json(200, {
    duplicate: result.duplicate,
    entry: {
      id: entry.id,
      is_deleted: entry.getBool('is_deleted'),
      delete_reason: entry.getString('delete_reason') || null,
      op_id: entry.getString('op_id'),
      updated: entry.getDateTime('updated').string() || null,
    },
  })
})
