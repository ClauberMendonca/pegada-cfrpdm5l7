import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import { conta, mensagemDe, senhaCurta } from '@/lib/pegada/conta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

/** Entrada: o e-mail e a senha com que a pessoa entra. */
export const EntradaCard: React.FC = () => {
  const { user, changePassword } = useAuth()
  const [temEmail, setTemEmail] = useState(false)
  const [novoEmail, setNovoEmail] = useState('')
  const [pedindo, setPedindo] = useState(false)
  const [pedido, setPedido] = useState('')
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [trocando, setTrocando] = useState(false)
  const [erroSenha, setErroSenha] = useState('')

  useEffect(() => {
    conta
      .config()
      .then((c) => setTemEmail(c.email))
      .catch(() => setTemEmail(false))
  }, [])

  if (!user) return null

  const pedirTroca = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setPedindo(true)
    try {
      await pb.collection('users').requestEmailChange(novoEmail.trim())
      setPedido(novoEmail.trim())
      setNovoEmail('')
    } catch (err) {
      toast.error(mensagemDe(err, 'Não consegui pedir a troca. Confira o e-mail e tente de novo.'))
    } finally {
      setPedindo(false)
    }
  }

  const trocarSenha = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErroSenha('')
    const curta = senhaCurta(nova)
    if (curta) return setErroSenha(curta)
    setTrocando(true)
    try {
      await changePassword(atual, nova)
      setAtual('')
      setNova('')
      toast.success('Senha trocada. As sessões em outros aparelhos foram encerradas.')
    } catch (err) {
      setErroSenha(mensagemDe(err, 'Não deu certo. Confira a senha atual.'))
    } finally {
      setTrocando(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Entrada
        </CardTitle>
        <CardDescription>O e-mail e a senha com que você entra no Pegada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">E-mail</span>
          <p className="break-all text-base text-foreground">{user.email}</p>
          {pedido && (
            <p className="text-sm text-muted-foreground" role="status">
              Enviamos um link para {pedido}. A troca só vale depois que você abrir esse link.
            </p>
          )}
          {temEmail ? (
            <form onSubmit={pedirTroca} className="flex flex-wrap items-end gap-2 pt-1">
              <div className="flex-1 basis-56 space-y-2">
                <Label htmlFor="entrada-email">Trocar para outro e-mail</Label>
                <Input
                  id="entrada-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="min-h-11"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" className="min-h-11" disabled={pedindo}>
                {pedindo ? 'Enviando...' : 'Enviar confirmação'}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              A troca de e-mail fica disponível quando o servidor passar a enviar e-mails.
            </p>
          )}
        </div>

        <form onSubmit={trocarSenha} className="space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-medium text-foreground">Trocar a senha</h3>
          {/* Campo oculto: ajuda o gerenciador de senhas a saber de qual conta é. */}
          <input type="email" autoComplete="username" value={user.email} readOnly hidden />
          <div className="space-y-2">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-11"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="senha-nova">Senha nova</Label>
            <Input
              id="senha-nova"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              aria-describedby="senha-nova-dica"
              className="min-h-11"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
            />
            <p id="senha-nova-dica" className="text-xs text-muted-foreground">
              Pelo menos 10 caracteres. Uma frase curta funciona bem.
            </p>
          </div>
          {erroSenha && (
            <p className="text-sm text-destructive" role="alert">
              {erroSenha}
            </p>
          )}
          <Button type="submit" className="min-h-11" disabled={trocando}>
            {trocando ? 'Trocando...' : 'Trocar a senha'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
