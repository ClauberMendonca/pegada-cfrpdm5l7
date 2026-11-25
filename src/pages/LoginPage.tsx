import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { mensagemDe } from '@/lib/pegada/conta'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TelaDeEntrada, AvisoErro } from '@/components/conta/TelaDeEntrada'

/** Entrada do app. O cadastro é fechado: conta nova só por convite. */
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
      setError(mensagemDe(err, 'E-mail ou senha incorretos.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <TelaDeEntrada
      titulo="Entrar"
      rodape="Para ter uma conta, você precisa de um convite de quem já usa o Pegada."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AvisoErro>{error}</AvisoErro>}
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={isLoading} className="min-h-11 w-full font-medium">
          {isLoading ? 'Entrando...' : 'Entrar'}
          {!isLoading && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
        <p className="text-center text-sm">
          <Link to="/esqueci-a-senha" className="inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Esqueci a senha
          </Link>
        </p>
      </form>
    </TelaDeEntrada>
  )
}
