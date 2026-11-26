import { PrivacidadeIA } from '@/components/PrivacidadeIA'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Clock, Settings, User } from 'lucide-react'

/**
 * Configurações da conta (/configuracoes): perfil e fuso, somente leitura, e a
 * privacidade da IA. O Propósito saiu daqui: ele é o topo do Mapa
 * (/mapa/proposito), e não uma preferência da conta.
 */
export default function SettingsPage() {
  const { user } = useAuth()
  const [freshProfile, setFreshProfile] = useState<{ timezone?: string } | null>(null)

  // Leitura fresca do fuso, uma vez por entrada na página.
  useEffect(() => {
    let active = true
    const sessionId = user?.id ?? null
    if (!sessionId || !pb.authStore.isValid) return
    pb.collection('users')
      .getOne(sessionId)
      .then((fresh) => {
        if (active) setFreshProfile({ timezone: fresh.timezone || '' })
      })
      .catch(() => {
        // Sem leitura fresca, vale o fuso da sessão.
      })
    return () => {
      active = false
    }
  }, [user?.id])

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
          <p className="text-sm text-muted-foreground">Sua conta e a privacidade da IA.</p>
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

      <Card className="bg-card border-border">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">O seu propósito agora fica no topo do Mapa.</p>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/mapa/proposito">Abrir o propósito</Link>
          </Button>
        </CardContent>
      </Card>

      <PrivacidadeIA />
    </div>
  )
}
