import { Link } from 'react-router-dom'
import { Settings, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PrivacidadeIA } from '@/components/PrivacidadeIA'
import { PerfilCard } from '@/components/conta/PerfilCard'
import { EntradaCard } from '@/components/conta/EntradaCard'
import { SegurancaCard } from '@/components/conta/SegurancaCard'
import { AvisoPrivacidade } from '@/components/conta/AvisoPrivacidade'

/**
 * Configurações (/configuracoes), aberta pelo avatar: quem sou (nome, foto e
 * fuso), entrada (e-mail e senha), privacidade e segurança da conta. O
 * Propósito não mora aqui: ele é o topo do Mapa (/mapa/proposito).
 */
export default function SettingsPage() {
  const { user } = useAuth()
  if (!user) return null

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
          <p className="text-sm text-muted-foreground">Sua conta, a entrada e a privacidade.</p>
        </div>
      </header>

      <PerfilCard />
      <EntradaCard />

      <Card className="border-border bg-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">O seu propósito fica no topo do Mapa.</p>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/mapa/proposito">Abrir o propósito</Link>
          </Button>
        </CardContent>
      </Card>

      <PrivacidadeIA />

      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Privacidade
          </CardTitle>
          <CardDescription>O que o Pegada guarda e quem pode ver.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvisoPrivacidade />
        </CardContent>
      </Card>

      <SegurancaCard />
    </div>
  )
}
