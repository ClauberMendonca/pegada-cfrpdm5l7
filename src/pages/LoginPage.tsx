import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Lock, Mail, ArrowRight, AlertCircle } from 'lucide-react'
import { PegadaNome, PegadaSimbolo } from '@/components/PegadaSimbolo'

export const LoginPage: React.FC = () => {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha na autenticação'
      setError(msg.includes('Failed to authenticate') ? 'E-mail ou senha incorretos.' : msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 text-foreground">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <PegadaSimbolo className="mx-auto mb-3 h-14 w-14 text-foreground" />
          <h1 className="flex justify-center text-foreground">
            <PegadaNome className="h-9 w-auto" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Cada passo com o seu porquê</p>
        </div>

        <Card className="bg-card border-border text-card-foreground shadow-2xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg font-medium text-foreground">Acesso Privado</CardTitle>
            <CardDescription className="text-muted-foreground">
              Acesso exclusivo do dono. Use suas credenciais privadas.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert
                  variant="destructive"
                  className="bg-pegada-danger-bg border-destructive/30 text-destructive"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  E-mail do Dono
                </Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dono@exemplo.com"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Senha
                </Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full font-medium transition-colors"
              >
                {isLoading ? 'Verificando...' : 'Entrar no Sistema'}
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>

              <div className="text-xs text-center text-muted-foreground">
                Uso restrito. Sem cadastro público ou convites.
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
