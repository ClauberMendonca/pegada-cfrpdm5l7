// BLOCO 8B — rascunho local opcional da entrada rápida de Capturas.
// Guarda SOMENTE o texto ainda não enviado, por dono, neste navegador, e a
// preferência booleana que o liga. Não é captura, backup, sincronização entre
// aparelhos nem criptografia: a separação por chave de dono não protege contra
// quem tem acesso ao navegador. Todas as operações de armazenamento são
// validadas e protegidas por try/catch.

export type DraftStorageResult = 'ok' | 'unavailable' | 'failed'

export interface CaptureDraftSnapshot {
  text: string
  rev: string
}

const PREF_PREFIX = 'ginga.captureDraft.enabled:'
const TEXT_PREFIX = 'ginga.captureDraft:'
const DRAFT_VERSION = 1
const MAX_DRAFT_CHARS = 100000
const OWNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isValidOwner(ownerId: string): boolean {
  return OWNER_ID_PATTERN.test(ownerId)
}

function getStorage(): Storage | null {
  try {
    const storage = window.localStorage
    const probe = '__ginga_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/** Token local de revisão: serve só para comparar snapshots de envio. */
export function newDraftRev(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Preferência do dono; ausente, inválida ou indisponível → desligada. */
export function readCapturePreference(ownerId: string): boolean {
  if (!isValidOwner(ownerId)) return false
  const storage = getStorage()
  if (!storage) return false
  try {
    return storage.getItem(PREF_PREFIX + ownerId) === '1'
  } catch {
    return false
  }
}

export function writeCapturePreference(ownerId: string, enabled: boolean): DraftStorageResult {
  if (!isValidOwner(ownerId)) return 'failed'
  const storage = getStorage()
  if (!storage) return 'unavailable'
  const key = PREF_PREFIX + ownerId
  try {
    if (enabled) {
      storage.setItem(key, '1')
      return storage.getItem(key) === '1' ? 'ok' : 'failed'
    }
    storage.removeItem(key)
    return storage.getItem(key) === null ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Lê o rascunho do dono. Formato inválido → null (nunca texto inventado). */
export function readCaptureDraft(ownerId: string): CaptureDraftSnapshot | null {
  if (!isValidOwner(ownerId)) return null
  const storage = getStorage()
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(TEXT_PREFIX + ownerId)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (record.v !== DRAFT_VERSION) return null
    if (typeof record.text !== 'string' || typeof record.rev !== 'string') return null
    if (record.text === '' || record.text.length > MAX_DRAFT_CHARS) return null
    return { text: record.text, rev: record.rev }
  } catch {
    return null
  }
}

/** Grava o texto exato (sem trim). Texto vazio remove a cópia. */
export function writeCaptureDraft(ownerId: string, text: string, rev: string): DraftStorageResult {
  if (!isValidOwner(ownerId)) return 'failed'
  if (text === '') return clearCaptureDraft(ownerId)
  if (text.length > MAX_DRAFT_CHARS) return 'failed'
  const storage = getStorage()
  if (!storage) return 'unavailable'
  const key = TEXT_PREFIX + ownerId
  const payload = JSON.stringify({ v: DRAFT_VERSION, text, rev })
  try {
    storage.setItem(key, payload)
    return storage.getItem(key) === payload ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Remove a cópia local do dono (nunca toca em capturas do banco). */
export function clearCaptureDraft(ownerId: string): DraftStorageResult {
  if (!isValidOwner(ownerId)) return 'failed'
  const storage = getStorage()
  if (!storage) return 'unavailable'
  const key = TEXT_PREFIX + ownerId
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Aviso curto para o resultado de uma operação local; null quando concluiu. */
export function draftNoticeFor(
  result: DraftStorageResult,
  action: 'salvar' | 'remover',
): string | null {
  if (result === 'ok') return null
  if (result === 'unavailable') {
    return 'Armazenamento deste navegador indisponível: o rascunho não está salvo neste dispositivo.'
  }
  return action === 'salvar'
    ? 'Não foi possível salvar o rascunho neste dispositivo. O texto continua apenas nesta tela.'
    : 'Não foi possível remover a cópia local deste dispositivo. Tente de novo.'
}
