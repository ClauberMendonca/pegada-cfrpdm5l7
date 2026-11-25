// FATIA — REGISTRO DE TEMPO V1: rotas nativas /backend/v1/time/*.
//
// Toda escrita de time_entries passa aqui. O dono vem da sessão, os alvos e
// seus vínculos são revalidados no servidor, os títulos são snapshots, e cada
// intenção é registrada no mesmo registro antes do commit da transação.
//
// NOTA JSVM:
// - cada callback é isolado; helpers vivem dentro da rota que os usa;
// - runInTransaction tem callback VOID; a resposta só é montada depois do commit;
// - DateTime/Timezone/Time.in().format() são usados para o dia do dono;
// - não há chamadas externas, subprocessos, seeds ou mutações fora destas rotas.

routerAdd('POST', '/backend/v1/time/running', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id

  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const text = raw.string()
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    started_at: dateString(rec, 'started_at'),
    ended_at: dateString(rec, 'ended_at'),
    duration_seconds: rec.getInt('duration_seconds'),
    entry_date: rec.getString('entry_date'),
    origin: rec.getString('origin'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    correction_of: rec.getString('correction_of') || null,
    is_deleted: rec.getBool('is_deleted'),
    delete_reason: rec.getString('delete_reason') || null,
    previous_date: rec.getString('previous_date') || null,
    previous_duration_seconds: rec.getInt('previous_duration_seconds'),
    previous_note: rec.getString('previous_note') || null,
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    target_title: rec.getString('target_title') || null,
    updated: dateString(rec, 'updated'),
  })
  const titleAndStatus = (rec) => {
    let action = null
    let project = null
    const actionId = rec.getString('action_id')
    const projectId = rec.getString('project_id')
    if (actionId) {
      try {
        action = e.app.findRecordById('actions', actionId)
      } catch (_) {}
    }
    if (projectId) {
      try {
        project = e.app.findRecordById('projects', projectId)
      } catch (_) {}
    }
    const targetTitle =
      rec.getString('target_title') ||
      (action ? action.getString('title') : project ? project.getString('title') : '')
    const targetStatus = action
      ? action.getString('status')
      : project
        ? project.getString('status')
        : ''
    const parentStatus = action && project ? project.getString('status') : ''
    return { targetTitle: targetTitle, targetStatus: targetStatus, parentStatus: parentStatus }
  }

  let found = null
  let state = 'idle'
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const running = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s} && is_deleted = false',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (running.length > 0) {
        found = running[0]
        state = 'running'
        return
      }
      const paused = txApp.findRecordsByFilter(
        'time_entries',
        "user_id = {:u} && status = {:s} && is_deleted = false && resumed_by = ''",
        '-updated,-created',
        1,
        0,
        { u: userId, s: 'paused' },
      )
      if (paused.length > 0) {
        found = paused[0]
        state = 'paused'
      }
    })
  } catch (_) {
    txErr = new ApiError(500, 'Falha ao consultar o estado do cronômetro.')
  }
  if (txErr) throw txErr
  if (!found) return e.json(200, { running: null, state: 'idle', warning: null })

  const base = snapshot(found)
  const live = titleAndStatus(found)
  base.target_title = base.target_title || live.targetTitle || null
  base.target_status = live.targetStatus || null
  base.project_status = live.parentStatus || null
  return e.json(200, {
    running: base,
    state: state,
    warning: state === 'paused' ? 'paused-recoverable' : null,
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
  const opId = str(body.op_id)
  if (!targetId) throw new BadRequestError('target_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')

  const operation = 'start'
  const payload = { operation: operation, target_type: targetType, target_id: targetId }
  const payloadJson = JSON.stringify(payload)
  const allowedAction = ['pronta', 'em_andamento']
  const allowedProject = ['ativo', 'rascunho']

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    started_at: dateString(rec, 'started_at'),
    ended_at: dateString(rec, 'ended_at'),
    duration_seconds: rec.getInt('duration_seconds'),
    entry_date: rec.getString('entry_date'),
    origin: rec.getString('origin'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    target_title: rec.getString('target_title') || null,
    updated: dateString(rec, 'updated'),
  })
  const ownerDay = (instant, app) => {
    let zone = ''
    try {
      zone = app.findRecordById('_pb_users_auth_', userId).getString('timezone')
    } catch (_) {}
    if (zone && typeof DateTime === 'function' && typeof Timezone === 'function') {
      try {
        return new DateTime(instant).time().in(new Timezone(zone)).format('2006-01-02')
      } catch (_) {}
    }
    return instant.slice(0, 10)
  }
  const resolveTarget = (app, requireEligible) => {
    const collectionName = targetType === 'action' ? 'actions' : 'projects'
    let target = null
    try {
      target = app.findRecordById(collectionName, targetId)
    } catch (_) {
      throw new NotFoundError('Alvo não encontrado.')
    }
    if (target.getString('user_id') !== userId && !(targetType !== 'action' && target.getStringSlice('member_ids').indexOf(userId) >= 0)) {
      throw new ForbiddenError('Alvo pertence a outro usuário.')
    }
    let project = null
    let projectId = ''
    if (targetType === 'action') {
      projectId = target.getString('project_id') || ''
      if (projectId) {
        try {
          project = app.findRecordById('projects', projectId)
        } catch (_) {
          throw new NotFoundError('O projeto pai da ação não existe mais.')
        }
        if (project.getString('user_id') !== userId && project.getStringSlice('member_ids').indexOf(userId) < 0) {
          throw new ForbiddenError('O projeto pai da ação pertence a outro usuário.')
        }
        if (requireEligible && allowedProject.indexOf(project.getString('status')) === -1) {
          throw new ApiError(409, 'O projeto pai não está elegível para iniciar dedicação.')
        }
      }
      if (requireEligible && allowedAction.indexOf(target.getString('status')) === -1) {
        throw new ApiError(409, 'A ação não está elegível para iniciar dedicação.')
      }
    } else if (requireEligible && allowedProject.indexOf(target.getString('status')) === -1) {
      throw new ApiError(409, 'O projeto não está elegível para iniciar dedicação.')
    } else {
      project = target
      projectId = target.id
    }
    return {
      target: target,
      project: project,
      projectId: projectId,
      context: target.getString('context'),
      title: target.getString('title'),
    }
  }
  const legacyMatches = (rec) =>
    rec.getString('op_id') === opId &&
    rec.getString('target_type') === targetType &&
    rec.getString(targetType + '_id') === targetId &&
    rec.getString('origin') === 'timer'
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) {
        if (history.length === 0 && legacyMatches(rec)) return { record: rec, legacy: true }
        return { conflict: true }
      }
    }
    return null
  }
  const dateValue = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let runningId = null
  let runningTitle = ''
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict) {
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        } else {
          result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
        }
        return
      }

      let target = null
      try {
        target = resolveTarget(txApp, true)
      } catch (err) {
        txErr = err
        return
      }
      const running = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s} && is_deleted = false',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (running.length > 0) {
        runningId = running[0].id
        runningTitle = running[0].getString('target_title') || 'outro intervalo'
        txErr = new ApiError(409, 'already-running')
        return
      }

      const now = new Date().toISOString()
      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId)
      entry.set('target_type', targetType)
      entry.set('action_id', targetType === 'action' ? target.target.id : '')
      entry.set('project_id', target.projectId || '')
      entry.set('context', target.context)
      entry.set('started_at', now)
      entry.set('duration_seconds', 0)
      entry.set('entry_date', ownerDay(now, txApp))
      entry.set('origin', 'timer')
      entry.set('status', 'running')
      entry.set('op_id', opId)
      entry.set('target_title', target.title)
      entry.set('resumed_by', '')
      txApp.save(entry)
      const snap = {
        id: entry.id,
        target_type: targetType,
        action_id: targetType === 'action' ? target.target.id : null,
        project_id: target.projectId || null,
        context: target.context,
        started_at: dateValue(entry, 'started_at'),
        ended_at: null,
        duration_seconds: 0,
        entry_date: ownerDay(now, txApp),
        origin: 'timer',
        note: null,
        status: 'running',
        op_id: opId,
        target_title: target.title,
        updated: dateValue(entry, 'updated'),
      }
      appendEvent(entry, snap)
      txApp.save(entry)
      result = { duplicate: false, entry: entry }
    })
  } catch (_) {
    if (!txErr)
      txErr = new ApiError(500, 'Falha ao gravar o início do cronômetro; nada foi gravado.')
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

  const entry = result.snapshot || snapshot(result.entry)
  return e.json(200, { duplicate: result.duplicate, entry: entry })
})

routerAdd('POST', '/backend/v1/time/stop', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) throw new UnauthorizedError('Sessão ausente.')
  const userId = auth.id
  const info = e.requestInfo()
  const body = info.body || {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const entryId = str(body.entry_id)
  const opId = str(body.op_id)
  const action = body.action
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  if (action !== 'pause' && action !== 'end') {
    throw new BadRequestError('action deve ser "pause" ou "end".')
  }
  const operation = 'stop'
  const payload = { operation: operation, entry_id: entryId, action: action }
  const payloadJson = JSON.stringify(payload)

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    started_at: dateString(rec, 'started_at'),
    ended_at: dateString(rec, 'ended_at'),
    duration_seconds: rec.getInt('duration_seconds'),
    entry_date: rec.getString('entry_date'),
    origin: rec.getString('origin'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    is_deleted: rec.getBool('is_deleted'),
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    target_title: rec.getString('target_title') || null,
    updated: dateString(rec, 'updated'),
  })
  const legacyMatches = (rec) =>
    rec.id === entryId &&
    rec.getString('op_id') === opId &&
    rec.getString('status') === (action === 'pause' ? 'paused' : 'ended')
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) {
        if (history.length === 0 && legacyMatches(rec)) return { record: rec, legacy: true }
        return { conflict: true }
      }
    }
    return null
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict)
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        else result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
        return
      }
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
      if (rec.getBool('is_deleted')) {
        txErr = new ApiError(409, 'Intervalo anulado não é encerrado novamente.')
        return
      }
      if (
        rec.getString('status') === 'paused' &&
        action === 'end' &&
        !rec.getString('resumed_by')
      ) {
        // Encerrar a pausa não adiciona espera ao período já consolidado.
        rec.set('status', 'ended')
        rec.set('op_id', opId)
        txApp.save(rec)
        const snap = snapshot(rec)
        appendEvent(rec, snap)
        txApp.save(rec)
        result = { duplicate: false, entry: rec }
        return
      }
      if (rec.getString('status') !== 'running') {
        txErr = new ApiError(
          409,
          'Este intervalo não está mais correndo; recarregue o estado antes de repetir.',
        )
        return
      }
      const now = new Date().toISOString()
      const started = dateString(rec, 'started_at')
      const parsedStarted = started ? Date.parse(started.replace(' ', 'T')) : NaN
      const parsedNow = Date.parse(now)
      let seconds = Math.round((parsedNow - parsedStarted) / 1000)
      if (!isFinite(seconds) || seconds < 0) {
        txErr = new ApiError(400, 'Duração inválida derivada dos instantes persistidos.')
        return
      }
      // Zero é válido se início e encerramento ocorrerem no mesmo segundo.
      rec.set('ended_at', now)
      rec.set('duration_seconds', seconds)
      rec.set('status', action === 'pause' ? 'paused' : 'ended')
      rec.set('op_id', opId)
      txApp.save(rec)
      const snap = snapshot(rec)
      appendEvent(rec, snap)
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (_) {
    if (!txErr) txErr = new ApiError(500, 'Falha ao encerrar o intervalo; nada foi gravado.')
  }
  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao encerrar o intervalo.')
  return e.json(200, {
    duplicate: result.duplicate,
    entry: result.snapshot || snapshot(result.entry),
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
  const opId = str(body.op_id)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  const operation = 'resume'
  const payload = { operation: operation, entry_id: entryId }
  const payloadJson = JSON.stringify(payload)
  const allowedAction = ['pronta', 'em_andamento']
  const allowedProject = ['ativo', 'rascunho']

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    started_at: dateString(rec, 'started_at'),
    ended_at: dateString(rec, 'ended_at'),
    duration_seconds: rec.getInt('duration_seconds'),
    entry_date: rec.getString('entry_date'),
    origin: rec.getString('origin'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    target_title: rec.getString('target_title') || null,
    updated: dateString(rec, 'updated'),
  })
  const ownerDay = (instant, app) => {
    let zone = ''
    try {
      zone = app.findRecordById('_pb_users_auth_', userId).getString('timezone')
    } catch (_) {}
    if (zone && typeof DateTime === 'function' && typeof Timezone === 'function') {
      try {
        return new DateTime(instant).time().in(new Timezone(zone)).format('2006-01-02')
      } catch (_) {}
    }
    return instant.slice(0, 10)
  }
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) return { conflict: true }
    }
    return null
  }
  const resolveTarget = (app, paused) => {
    const targetType = paused.getString('target_type')
    const targetId = paused.getString(targetType + '_id')
    if (!targetId) throw new NotFoundError('Alvo do intervalo não existe mais.')
    const collectionName = targetType === 'action' ? 'actions' : 'projects'
    let target = null
    try {
      target = app.findRecordById(collectionName, targetId)
    } catch (_) {
      throw new NotFoundError('Alvo do intervalo não existe mais; revise o tempo registrado.')
    }
    if (target.getString('user_id') !== userId && !(targetType !== 'action' && target.getStringSlice('member_ids').indexOf(userId) >= 0))
      throw new ForbiddenError('Alvo pertence a outro usuário.')
    let projectId = ''
    let project = null
    if (targetType === 'action') {
      projectId = target.getString('project_id') || ''
      if (projectId) {
        try {
          project = app.findRecordById('projects', projectId)
        } catch (_) {
          throw new NotFoundError('O projeto pai da ação não existe mais.')
        }
        if (project.getString('user_id') !== userId && project.getStringSlice('member_ids').indexOf(userId) < 0)
          throw new ForbiddenError('O projeto pai da ação pertence a outro usuário.')
        if (allowedProject.indexOf(project.getString('status')) === -1)
          throw new ApiError(409, 'O projeto pai não está elegível para retomar dedicação.')
      }
      if (allowedAction.indexOf(target.getString('status')) === -1)
        throw new ApiError(409, 'A ação não está elegível para retomar dedicação.')
    } else {
      projectId = target.id
      project = target
      if (allowedProject.indexOf(target.getString('status')) === -1)
        throw new ApiError(409, 'O projeto não está elegível para retomar dedicação.')
    }
    if ((paused.getString('project_id') || '') !== projectId) {
      throw new ApiError(
        409,
        'O vínculo do alvo mudou durante a pausa; revise o intervalo antes de retomar.',
      )
    }
    return {
      target: target,
      projectId: projectId,
      context: paused.getString('context'),
      title: paused.getString('target_title') || target.getString('title'),
    }
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict)
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        else result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
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
      if (paused.getString('resumed_by')) {
        txErr = new ApiError(
          409,
          'Este intervalo pausado já foi retomado; use a nova entrada correndo.',
        )
        return
      }
      let target = null
      try {
        target = resolveTarget(txApp, paused)
      } catch (err) {
        txErr = err
        return
      }
      const running = txApp.findRecordsByFilter(
        'time_entries',
        'user_id = {:u} && status = {:s} && is_deleted = false',
        '-created',
        1,
        0,
        { u: userId, s: 'running' },
      )
      if (running.length > 0) {
        txErr = new ApiError(
          409,
          'Já existe outro cronômetro correndo. Encerre-o antes de retomar.',
        )
        return
      }

      const now = new Date().toISOString()
      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId)
      entry.set('target_type', paused.getString('target_type'))
      entry.set(
        'action_id',
        paused.getString('target_type') === 'action' ? paused.getString('action_id') : '',
      )
      entry.set('project_id', target.projectId || '')
      entry.set('context', target.context)
      entry.set('started_at', now)
      entry.set('duration_seconds', 0)
      entry.set('entry_date', ownerDay(now, txApp))
      entry.set('origin', 'timer')
      entry.set('status', 'running')
      entry.set('op_id', opId)
      entry.set('target_title', target.title)
      entry.set('resumed_by', '')
      txApp.save(entry)
      const snap = snapshot(entry)
      appendEvent(entry, snap)
      txApp.save(entry)

      // O marcador e o ledger da pausa são gravados na mesma transação que a
      // nova entrada. Assim a pausa não pode ser reutilizada com outro op_id.
      paused.set('resumed_by', entry.id)
      const pausedHistory = readHistory(paused)
      pausedHistory.push({
        op_id: opId,
        operation: operation,
        payload: payload,
        payload_json: payloadJson,
        result: { entry: snap },
        recorded_at: new Date().toISOString(),
      })
      paused.set('operation_history', pausedHistory)
      txApp.save(paused)
      result = { duplicate: false, entry: entry }
    })
  } catch (_) {
    if (!txErr) txErr = new ApiError(500, 'Falha ao retomar o cronômetro; nada foi gravado.')
  }
  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao retomar o cronômetro.')
  return e.json(200, {
    duplicate: result.duplicate,
    entry: result.snapshot || snapshot(result.entry),
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
  if (targetType !== 'action' && targetType !== 'project')
    throw new BadRequestError('target_type deve ser "action" ou "project".')
  const targetId = str(body.target_id)
  const opId = str(body.op_id)
  const entryDate = str(body.entry_date)
  if (!targetId) throw new BadRequestError('target_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate))
    throw new BadRequestError('entry_date deve ser dia-calendário YYYY-MM-DD.')
  const parts = entryDate.split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1])
    throw new BadRequestError('entry_date não é um dia-calendário válido.')
  const secsRaw = body.duration_seconds
  const secs = secsRaw
  if (typeof secs !== 'number' || !isFinite(secs) || Math.floor(secs) !== secs || secs <= 0)
    throw new BadRequestError('duration_seconds deve ser positivo.')
  const note = str(body.note).slice(0, 500)
  const operation = 'manual'
  const payload = {
    operation: operation,
    target_type: targetType,
    target_id: targetId,
    entry_date: entryDate,
    duration_seconds: secs,
    note: note,
  }
  const payloadJson = JSON.stringify(payload)

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    started_at: null,
    ended_at: null,
    duration_seconds: rec.getInt('duration_seconds'),
    entry_date: rec.getString('entry_date'),
    origin: rec.getString('origin'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    target_title: rec.getString('target_title') || null,
    updated: dateString(rec, 'updated'),
  })
  const ownerDay = (instant, app) => {
    let zone = ''
    try {
      zone = app.findRecordById('_pb_users_auth_', userId).getString('timezone')
    } catch (_) {}
    if (zone && typeof DateTime === 'function' && typeof Timezone === 'function') {
      try {
        return new DateTime(instant).time().in(new Timezone(zone)).format('2006-01-02')
      } catch (_) {}
    }
    return instant.slice(0, 10)
  }
  const resolveTarget = (app) => {
    const collectionName = targetType === 'action' ? 'actions' : 'projects'
    let target = null
    try {
      target = app.findRecordById(collectionName, targetId)
    } catch (_) {
      throw new NotFoundError('Alvo não encontrado.')
    }
    if (target.getString('user_id') !== userId && !(targetType !== 'action' && target.getStringSlice('member_ids').indexOf(userId) >= 0))
      throw new ForbiddenError('Alvo pertence a outro usuário.')
    let projectId = ''
    if (targetType === 'action') {
      projectId = target.getString('project_id') || ''
      if (projectId) {
        let project = null
        try {
          project = app.findRecordById('projects', projectId)
        } catch (_) {
          throw new NotFoundError('O projeto pai da ação não existe mais.')
        }
        if (project.getString('user_id') !== userId && project.getStringSlice('member_ids').indexOf(userId) < 0)
          throw new ForbiddenError('O projeto pai da ação pertence a outro usuário.')
      }
    } else {
      projectId = target.id
    }
    return {
      target: target,
      projectId: projectId,
      context: target.getString('context'),
      title: target.getString('title'),
    }
  }
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) {
        if (
          history.length === 0 &&
          rec.getString('target_type') === targetType &&
          rec.getString(targetType + '_id') === targetId &&
          rec.getString('origin') === 'manual' &&
          rec.getString('entry_date') === entryDate &&
          rec.getInt('duration_seconds') === secs &&
          rec.getString('note') === note
        )
          return { record: rec, legacy: true }
        return { conflict: true }
      }
    }
    return null
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict)
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        else result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
        return
      }
      let target = null
      try {
        target = resolveTarget(txApp)
        const today = ownerDay(new Date().toISOString(), txApp)
        if (entryDate > today)
          throw new BadRequestError('Data manual não pode ser futura no fuso do dono.')
      } catch (err) {
        txErr = err
        return
      }
      const col = txApp.findCollectionByNameOrId('time_entries')
      const entry = new Record(col)
      entry.set('user_id', userId)
      entry.set('target_type', targetType)
      entry.set('action_id', targetType === 'action' ? target.target.id : '')
      entry.set('project_id', target.projectId || '')
      entry.set('context', target.context)
      entry.set('duration_seconds', secs)
      entry.set('entry_date', entryDate)
      entry.set('origin', 'manual')
      entry.set('status', 'ended')
      entry.set('note', note)
      entry.set('op_id', opId)
      entry.set('target_title', target.title)
      entry.set('resumed_by', '')
      txApp.save(entry)
      const snap = snapshot(entry)
      appendEvent(entry, snap)
      txApp.save(entry)
      result = { duplicate: false, entry: entry }
    })
  } catch (_) {
    if (!txErr) txErr = new ApiError(500, 'Falha ao gravar o tempo manual; nada foi gravado.')
  }
  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao registrar tempo manual.')
  return e.json(200, {
    duplicate: result.duplicate,
    entry: result.snapshot || snapshot(result.entry),
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
  const opId = str(body.op_id)
  const entryDate = str(body.entry_date)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate))
    throw new BadRequestError('entry_date deve ser dia-calendário YYYY-MM-DD.')
  const dateParts = entryDate.split('-')
  const y = parseInt(dateParts[0], 10)
  const m = parseInt(dateParts[1], 10)
  const d = parseInt(dateParts[2], 10)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1])
    throw new BadRequestError('entry_date não é um dia-calendário válido.')
  const secsRaw = body.duration_seconds
  const secs = secsRaw
  if (typeof secs !== 'number' || !isFinite(secs) || Math.floor(secs) !== secs || secs <= 0)
    throw new BadRequestError('duration_seconds deve ser positivo.')
  const note = str(body.note).slice(0, 500)
  const expectedUpdated = str(body.expected_updated)
  const normalizeTimestamp = (value) => {
    const v = str(value)
    if (!v) return ''
    try {
      const n = Date.parse(v.replace(' ', 'T'))
      if (!isNaN(n)) return new Date(n).toISOString()
    } catch (_) {}
    return v
  }
  const expectedCanonical = normalizeTimestamp(expectedUpdated)
  const operation = 'update'
  const payload = {
    operation: operation,
    entry_id: entryId,
    entry_date: entryDate,
    duration_seconds: secs,
    note: note,
    expected_updated: expectedCanonical,
  }
  const payloadJson = JSON.stringify(payload)

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    target_type: rec.getString('target_type'),
    action_id: rec.getString('action_id') || null,
    project_id: rec.getString('project_id') || null,
    context: rec.getString('context'),
    entry_date: rec.getString('entry_date'),
    duration_seconds: rec.getInt('duration_seconds'),
    note: rec.getString('note') || null,
    status: rec.getString('status'),
    previous_date: rec.getString('previous_date') || null,
    previous_duration_seconds: rec.getInt('previous_duration_seconds'),
    previous_note: rec.getString('previous_note') || null,
    correction_of: rec.getString('correction_of') || null,
    target_title: rec.getString('target_title') || null,
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    updated: dateString(rec, 'updated'),
  })
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) {
        if (
          history.length === 0 &&
          rec.id === entryId &&
          rec.getString('entry_date') === entryDate &&
          rec.getInt('duration_seconds') === secs &&
          rec.getString('note') === note
        )
          return { record: rec, legacy: true }
        return { conflict: true }
      }
    }
    return null
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict)
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        else result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
        return
      }
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
      if (rec.getBool('is_deleted')) {
        txErr = new ApiError(409, 'Intervalo anulado não pode ser corrigido.')
        return
      }
      if (rec.getString('status') === 'running') {
        txErr = new ApiError(409, 'Intervalo correndo não é editado; pause ou encerre primeiro.')
        return
      }
      if (
        expectedCanonical &&
        normalizeTimestamp(dateString(rec, 'updated')) !== expectedCanonical
      ) {
        txErr = new ApiError(
          409,
          'O registro mudou desde a leitura; recarregue antes de confirmar.',
        )
        return
      }
      rec.set('previous_date', rec.getString('entry_date'))
      rec.set('previous_duration_seconds', rec.getInt('duration_seconds'))
      rec.set('previous_note', rec.getString('note') || '')
      rec.set('entry_date', entryDate)
      rec.set('duration_seconds', secs)
      rec.set('note', note)
      rec.set('status', 'ended')
      rec.set('correction_of', rec.getString('correction_of') || entryId)
      rec.set('op_id', opId)
      txApp.save(rec)
      const snap = snapshot(rec)
      appendEvent(rec, snap)
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (_) {
    if (!txErr) txErr = new ApiError(500, 'Falha ao corrigir o registro; nada foi gravado.')
  }
  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao corrigir o registro.')
  return e.json(200, {
    duplicate: result.duplicate,
    entry: result.snapshot || snapshot(result.entry),
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
  const opId = str(body.op_id)
  const reason = str(body.reason).slice(0, 200)
  if (!entryId) throw new BadRequestError('entry_id é obrigatório.')
  if (!opId) throw new BadRequestError('op_id é obrigatório.')
  const operation = 'delete'
  const payload = { operation: operation, entry_id: entryId, reason: reason }
  const payloadJson = JSON.stringify(payload)

  const readHistory = (rec) => {
    let raw = null
    try {
      raw = rec.get('operation_history')
    } catch (_) {}
    if (!raw) return []
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    if (raw && typeof raw.string === 'function') {
      try {
        const parsed = JSON.parse(raw.string())
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {}
    }
    if (Array.isArray(raw)) {
      if (raw.length === 0 || typeof raw[0] !== 'number') return raw
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : []
      } catch (_) {
        return []
      }
    }
    return []
  }
  const dateString = (rec, field) => {
    try {
      return rec.getDateTime(field).string() || null
    } catch (_) {
      return null
    }
  }
  const snapshot = (rec) => ({
    id: rec.id,
    is_deleted: rec.getBool('is_deleted'),
    delete_reason: rec.getString('delete_reason') || null,
    op_id: rec.getString('op_id'),
    resumed_by: rec.getString('resumed_by') || null,
    updated: dateString(rec, 'updated'),
  })
  const findOperation = (txApp) => {
    const rows = txApp.findRecordsByFilter('time_entries', 'user_id = {:u}', '-created', 0, 0, {
      u: userId,
    })
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i]
      const history = readHistory(rec)
      for (let j = 0; j < history.length; j += 1) {
        const item = history[j]
        if (item && item.op_id === opId) {
          const itemPayload =
            item.payload_json || (item.payload ? JSON.stringify(item.payload) : '')
          if (itemPayload !== payloadJson) return { conflict: true }
          return {
            record: rec,
            snapshot: item.result && item.result.entry ? item.result.entry : null,
          }
        }
      }
      if (rec.getString('op_id') === opId) {
        if (
          history.length === 0 &&
          rec.id === entryId &&
          rec.getBool('is_deleted') &&
          rec.getString('delete_reason') === reason
        )
          return { record: rec, legacy: true }
        return { conflict: true }
      }
    }
    return null
  }
  const appendEvent = (rec, snap) => {
    const history = readHistory(rec)
    history.push({
      op_id: opId,
      operation: operation,
      payload: payload,
      payload_json: payloadJson,
      result: { entry: snap },
      recorded_at: new Date().toISOString(),
    })
    rec.set('operation_history', history)
  }

  let result = null
  let txErr = null
  try {
    e.app.runInTransaction((txApp) => {
      const prior = findOperation(txApp)
      if (prior) {
        if (prior.conflict)
          txErr = new ApiError(409, 'op_id já usado com outra intenção; gere uma nova operação.')
        else result = { duplicate: true, entry: prior.record, snapshot: prior.snapshot }
        return
      }
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
        txErr = new ApiError(
          409,
          'Intervalo já está anulado; repita a operação original para idempotência.',
        )
        return
      }
      rec.set('is_deleted', true)
      rec.set('deleted_at', new Date().toISOString())
      rec.set('delete_reason', reason)
      rec.set('op_id', opId)
      txApp.save(rec)
      const snap = snapshot(rec)
      appendEvent(rec, snap)
      txApp.save(rec)
      result = { duplicate: false, entry: rec }
    })
  } catch (_) {
    if (!txErr) txErr = new ApiError(500, 'Falha ao anular o registro; nada foi gravado.')
  }
  if (txErr) throw txErr
  if (!result) throw new ApiError(500, 'Falha interna ao anular o registro.')
  return e.json(200, {
    duplicate: result.duplicate,
    entry: result.snapshot || snapshot(result.entry),
  })
})
