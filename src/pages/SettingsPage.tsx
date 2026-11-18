import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CheckCircle2, Clock, Loader2, RefreshCw, Settings, User } from 'lucide-react'

const MAX_PURPOSE_LENGTH = 500

type LoadState = 'carregando' | 'pronto' | 'falha'

/**
 * FATIA 2A — Configurações do perfil (/configuracoes).
 *
 * Seções: Perfil (identificação e fuso, somente leitura) e Propósito de vida
 * (campo opcional, máx. 500, salvo no perfil autenticado via updateLifePurpose).
 * Sem editor de conta, sem fuso editável aqui (TimezoneModal/onboarding intactos).
 */
export default function SettingsPage() {
  const { user, updateLifePurpose } = useAuth()

  const [loadState, setLoadState] = useState<LoadState>('carregando')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [freshProfile, setFreshProfile] = useState<{ timezone?: string } | null>(null)

  // Último valor CONFIRMADO pelo servidor (snapshot de salvamento).
  const [savedText, setSavedText] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Identidade da sessão capturada no mount: respostas/estado de outra sessão
  // (logout + login de outro dono) não são aplicados.
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = user?.id ?? null

  // Leitura fresca UMA vez por entrada na página (não por render/digitação).
  useEffect(() => {
    let active = true
    setLoadState('carregando')
    setLoadError(null)

    const sessionId = user?.id ?? null
    if (!sessionId || !pb.authStore.isValid) {
      setLoadState('falha')
      setLoadError('Sem sessão ativa.')
      return
    }

    pb.collection('users')
      .getOne(sessionId)
      .then((fresh) => {
        if (!active || sessionRef.current !== sessionId) return
        setFreshProfile({ timezone: fresh.timezone || '' })
        // Confere com o perfil compartilhado: backend é a fonte canônica.
        const canonical = (fresh.life_purpose || '') as string
        setSavedText(canonical)
        setDraft(canonical)
        setLoadState('pronto')
      })
      .catch((err: unknown) => {
        if (!active || sessionRef.current !== sessionId) return
        setLoadState('falha')
        setLoadError(err instanceof Error ? err.message : 'Falha ao carregar o perfil.')
      })

    return () => {
      active = false
    }
  }, [user?.id])

  const isDirty = draft !== null && draft !== savedText

  const handleRetry = () => {
    setLoadState('carregando')
    setLoadError(null)
    // Reexecuta a mesma leitura fresca do mount.
    const sessionId = user?.id ?? null
    if (!sessionId) return
    pb.collection('users')
      .getOne(sessionId)
      .then((fresh) => {
        if (sessionRef.current !== sessionId) return
        setFreshProfile({ timezone: fresh.timezone || '' })
        const canonical = (fresh.life_purpose || '') as string
        setSavedText(canonical)
        setDraft(canonical)
        setLoadState('pronto')
      })
      .catch((err: unknown) => {
        if (sessionRef.current !== sessionId) return
        setLoadState('falha')
        setLoadError(err instanceof Error ? err.message : 'Falha ao carregar o perfil.')
      })
  }

  // Descartar restaura o último valor CONFIRMADO; não escreve no banco.
  const handleDiscard = () => {
    setDraft(savedText ?? '')
    setSaveError(null)
  }

  const handleSave = async () => {
    if (isSaving || loadState !== 'pronto') return
    const sessionId = sessionRef.current
    if (!sessionId) return

    const textToSave = draft ?? ''
    // Entrada somente de espaços é tratada como vazio; fora disso preserva o texto.
    const effective = textToSave.trim() === '' ? '' : textToSave

    setIsSaving(true)
    setSaveError(null)
    try {
      await updateLifePurpose(effective)
      // Confirmação do servidor chegou e a sessão não mudou: atualiza o snapshot.
      if (sessionRef.current !== sessionId) return
      setSavedText(effective)
      setSavedAt(Date.now())
    } catch (err: unknown) {
      if (sessionRef.current !== sessionId) return
      // Falha preserva o texto em edição e mostra erro visível — sem inventar salvo.
      const msg =
        err instanceof Error ? err.message : 'Não foi possível salvar o propósito. Tente novamente.'
      setSaveError(msg)
    } finally {
      // Só limpa a trava da MESMA sessão; resposta atrasada de outra não interfere.
      if (sessionRef.current === sessionId) setIsSaving(false)
    }
  }

  if (!user) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary ring-1 ring-primary/20"
        >
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">Preferências do seu perfil.</p>
        </div>
      </header>

      {/* Seção Perfil — somente leitura, sem editor de conta */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Perfil
          </CardTitle>
          <CardDescription>
            Identificação e fuso da sua conta. Somente leitura aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Nome</span>
            <p className="text-base font-medium text-foreground">{user.name || '—'}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">E-mail</span>
            <p className="text-base text-foreground">{user.email}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Fuso</span>
            <p className="flex items-center gap-2 text-base text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {(freshProfile?.timezone || user.timezone || '—').replace('_', ' ')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Seção Propósito de vida */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-foreground">Propósito de vida</CardTitle>
          <CardDescription>
            Uma frase para orientar suas escolhas na vida e no trabalho. Não é uma meta nem uma
            tarefa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadState === 'carregando' && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando perfil...
            </div>
          )}

          {loadState === 'falha' && (
            <Alert variant="destructive" className="border-destructive/30 text-destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{loadError ?? 'Não foi possível carregar o perfil.'}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  className="min-h-11 gap-2"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {loadState === 'pronto' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSave()
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="life-purpose" className="text-sm font-medium text-foreground">
                  Propósito de vida
                </Label>
                <Textarea
                  id="life-purpose"
                  aria-describedby="life-purpose-help life-purpose-counter"
                  value={draft ?? ''}
                  maxLength={MAX_PURPOSE_LENGTH}
                  disabled={isSaving}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ex.: Viver com presença e construir trabalho que sirva a outras pessoas."
                  className="min-h-[120px] resize-y text-base"
                />
                <div className="flex items-center justify-between gap-3">
                  <p id="life-purpose-help" className="text-xs text-muted-foreground">
                    Opcional. Pode ficar vazio. Salvar vazio remove o propósito do perfil.
                  </p>
                  <p
                    id="life-purpose-counter"
                    aria-live="polite"
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      (draft?.length ?? 0) >= MAX_PURPOSE_LENGTH
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {draft?.length ?? 0}/{MAX_PURPOSE_LENGTH}
                  </p>
                </div>
              </div>

              {saveError && (
                <Alert variant="destructive" className="border-destructive/30 text-destructive">
                  <AlertDescription role="alert">{saveError}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {savedAt !== null && !isDirty && !saveError && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1.5 text-sm font-medium text-primary"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Propósito salvo no perfil
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={isSaving || !isDirty}
                  className="min-h-11 gap-2 font-medium"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isSaving ? 'Salvando...' : 'Salvar propósito'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving || !isDirty}
                  onClick={handleDiscard}
                  className="min-h-11"
                >
                  Descartar alterações
                </Button>
                {savedText !== null && savedText !== '' && !isDirty && (
                  <Badge variant="secondary" className="font-normal">
                    Salvo no perfil
                  </Badge>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
