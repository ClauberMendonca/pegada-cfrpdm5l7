import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearCaptureDraft,
  draftNoticeFor,
  newDraftRev,
  readCaptureDraft,
  readCapturePreference,
  writeCaptureDraft,
  writeCapturePreference,
} from '@/lib/captureDraft'

// BLOCO 8B — estado do rascunho local opcional da entrada rápida de Capturas.
// Escopo: um único rascunho por dono nesta área. Troca de dono, logout e
// desmontagem incrementam o escopo, invalidando retornos antigos de envio.

export interface CaptureDraftSend {
  owner: string
  scope: number
  version: number
  rev: string | null
}

export function useCaptureDraft(ownerId: string | undefined) {
  const owner = ownerId ?? ''
  const [text, setTextState] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [restored, setRestored] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // scope: muda ao trocar dono/desmontar; version: muda a cada alteração do texto;
  // rev: identidade local da cópia gravada (não é ID de banco).
  const scopeRef = useRef(0)
  const versionRef = useRef(0)
  const revRef = useRef<string | null>(null)

  // Troca de dono (ou desmontagem): limpa o texto visível em memória e restaura
  // somente a cópia local do próprio dono, se a preferência estiver ligada.
  useEffect(() => {
    ++scopeRef.current
    versionRef.current += 1
    revRef.current = null
    setTextState('')
    setRestored(false)
    setNotice(null)
    const on = owner !== '' && readCapturePreference(owner)
    setEnabled(on)
    if (on) {
      const draft = readCaptureDraft(owner)
      if (draft) {
        revRef.current = draft.rev
        setTextState(draft.text)
        setRestored(true)
      }
    }
    return () => {
      ++scopeRef.current
    }
  }, [owner])

  const replaceText = useCallback((value: string) => {
    setTextState(value)
    versionRef.current += 1
  }, [])

  const onTextChange = useCallback(
    (value: string) => {
      replaceText(value)
      setRestored(false)
      if (!enabled || owner === '') return
      if (value === '') {
        revRef.current = null
        setRestored(false)
        setNotice(draftNoticeFor(clearCaptureDraft(owner), 'remover'))
        return
      }
      revRef.current = revRef.current ?? newDraftRev()
      setNotice(draftNoticeFor(writeCaptureDraft(owner, value, revRef.current), 'salvar'))
    },
    [enabled, owner, replaceText],
  )

  const toggleEnabled = useCallback(() => {
    if (owner === '') return
    if (!enabled) {
      const saved = writeCapturePreference(owner, true)
      if (saved !== 'ok') {
        setNotice(draftNoticeFor(saved, 'salvar'))
        return
      }
      setEnabled(true)
      setNotice(null)
      if (text !== '') {
        revRef.current = revRef.current ?? newDraftRev()
        setNotice(draftNoticeFor(writeCaptureDraft(owner, text, revRef.current), 'salvar'))
      }
      return
    }
    // Desligar: remove a cópia local e impede gravações futuras; o texto atual
    // continua no campo para não perder a ideia.
    const removed = clearCaptureDraft(owner)
    const prefOff = writeCapturePreference(owner, false)
    setEnabled(false)
    revRef.current = null
    setRestored(false)
    const failure = removed !== 'ok' ? removed : prefOff
    setNotice(failure === 'ok' ? null : draftNoticeFor(failure, 'remover'))
  }, [enabled, owner, text])

  // Limpar rascunho: escolha explícita; apaga só a cópia local do dono atual.
  // Em falha de remoção o texto fica no campo para nova tentativa.
  const clearDraft = useCallback(() => {
    const result = owner === '' ? 'ok' : clearCaptureDraft(owner)
    setRestored(false)
    setNotice(draftNoticeFor(result, 'remover'))
    if (result === 'failed') return
    replaceText('')
    revRef.current = null
  }, [owner, replaceText])

  // Snapshot de envio: identifica dono, escopo, versão do texto e rascunho.
  const beginSend = useCallback(
    (): CaptureDraftSend => ({
      owner,
      scope: scopeRef.current,
      version: versionRef.current,
      rev: revRef.current,
    }),
    [owner],
  )

  const isCurrent = useCallback(
    (snap: CaptureDraftSend): boolean =>
      snap.scope === scopeRef.current && snap.version === versionRef.current,
    [],
  )

  // Sucesso confirmado: limpa o campo e a cópia local SOMENTE se ainda for o
  // mesmo rascunho/versão enviados. Edição nova ou rascunho mais novo é preservado.
  const settleSuccess = useCallback(
    (snap: CaptureDraftSend) => {
      if (!isCurrent(snap)) return
      replaceText('')
      revRef.current = null
      setRestored(false)
      setNotice(null)
      if (snap.owner && snap.rev) {
        const stored = readCaptureDraft(snap.owner)
        if (stored && stored.rev === snap.rev) {
          setNotice(draftNoticeFor(clearCaptureDraft(snap.owner), 'remover'))
        }
      }
    },
    [isCurrent, replaceText],
  )

  return {
    text,
    onTextChange,
    enabled,
    restored,
    notice,
    toggleEnabled,
    clearDraft,
    beginSend,
    isCurrent,
    settleSuccess,
  }
}
