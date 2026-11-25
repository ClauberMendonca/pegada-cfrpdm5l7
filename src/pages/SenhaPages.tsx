import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/contexts/AuthContext'
import { conta, mensagemDe, senhaCurta } from '@/lib/pegada/conta'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { TelaDeEntrada, AvisoErro, AvisoCerto } from '@/components/conta/TelaDeEntrada'

const voltar = (
  <Link className="underline underline-offset-4" to="/">
    Voltar para a entrada
  </Link>
)

/** /esqueci-a-senha — pede o link de nova senha por e-mail. */
export const EsqueciSenhaPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [temEmail, setTemEmail] = useState<boolean | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    conta
      .config()
      .then((c) => setTemEmail(c.email))
      .catch(() => setTemEmail(true))
  }, [])

  const pedir = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      await pb.collection('users').requestPasswordReset(email.trim())
      setEnviado(true)
    } catch (err) {
      setErro(mensagemDe(err))
    } finally {
      setEnviando(false)
    }
  }

  if (temEmail === false) {
    return (
      <TelaDeEntrada titulo="Esqueci a senha" rodape={voltar}>
        <p className="text-sm text-muted-foreground">
          Este servidor ainda não envia e-mails. Fale com quem convidou você para receber um caminho de
          nova senha.
        </p>
      </TelaDeEntrada>
    )
  }

  if (enviado) {
    return (
      <TelaDeEntrada titulo="Confira o seu e-mail" rodape={voltar}>
        <AvisoCerto>
          Se existe uma conta com esse e-mail, enviamos um link para criar uma senha nova. Ele vale por 30
          minutos.
        </AvisoCerto>
      </TelaDeEntrada>
    )
  }

  return (
    <TelaDeEntrada
      titulo="Esqueci a senha"
      descricao="Informe o e-mail da sua conta. Enviamos um link para você criar uma senha nova."
      rodape={voltar}
    >
      <form onSubmit={pedir} className="space-y-4">
        {erro && <AvisoErro>{erro}</AvisoErro>}
        <div className="space-y-2">
          <Label htmlFor="esqueci-email">E-mail</Label>
          <Input
            id="esqueci-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={enviando} className="min-h-11 w-full font-medium">
          {enviando ? 'Enviando...' : 'Enviar o link'}
        </Button>
      </form>
    </TelaDeEntrada>
  )
}

/** /nova-senha/:token — cria a senha nova a partir do link do e-mail. */
export const NovaSenhaPage: React.FC = () => {
  const { token = '' } = useParams()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    const curta = senhaCurta(senha)
    if (curta) return setErro(curta)
    setEnviando(true)
    try {
      await pb.collection('users').confirmPasswordReset(token, senha, senha)
      logout()
      setPronto(true)
    } catch (err) {
      setErro(mensagemDe(err, 'Este link venceu ou já foi usado. Peça um novo em "Esqueci a senha".'))
    } finally {
      setEnviando(false)
    }
  }

  if (pronto) {
    return (
      <TelaDeEntrada titulo="Senha nova salva">
        <AvisoCerto>Tudo certo. As sessões antigas foram encerradas.</AvisoCerto>
        <Button className="min-h-11 w-full font-medium" onClick={() => navigate('/', { replace: true })}>
          Entrar com a senha nova
        </Button>
      </TelaDeEntrada>
    )
  }

  return (
    <TelaDeEntrada titulo="Criar uma senha nova" rodape={voltar}>
      <form onSubmit={salvar} className="space-y-4">
        {erro && <AvisoErro>{erro}</AvisoErro>}
        <div className="space-y-2">
          <Label htmlFor="nova-senha">Senha nova</Label>
          <Input
            id="nova-senha"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            aria-describedby="nova-senha-dica"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <p id="nova-senha-dica" className="text-xs text-muted-foreground">
            Pelo menos 10 caracteres. Uma frase curta funciona bem.
          </p>
        </div>
        <Button type="submit" disabled={enviando} className="min-h-11 w-full font-medium">
          {enviando ? 'Salvando...' : 'Salvar a senha nova'}
        </Button>
      </form>
    </TelaDeEntrada>
  )
}

/** /confirmar-email/:token — confirma o e-mail novo com a senha da conta. */
export const ConfirmarEmailPage: React.FC = () => {
  const { token = '' } = useParams()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const confirmar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      await pb.collection('users').confirmEmailChange(token, senha)
      logout()
      setPronto(true)
    } catch (err) {
      setErro(mensagemDe(err, 'Não deu certo. Confira a senha, ou peça a troca de e-mail de novo.'))
    } finally {
      setEnviando(false)
    }
  }

  if (pronto) {
    return (
      <TelaDeEntrada titulo="E-mail trocado">
        <AvisoCerto>O e-mail novo já vale para entrar.</AvisoCerto>
        <Button className="min-h-11 w-full font-medium" onClick={() => navigate('/', { replace: true })}>
          Entrar
        </Button>
      </TelaDeEntrada>
    )
  }

  return (
    <TelaDeEntrada
      titulo="Confirmar o e-mail novo"
      descricao="Digite a senha da sua conta para concluir a troca."
      rodape={voltar}
    >
      <form onSubmit={confirmar} className="space-y-4">
        {erro && <AvisoErro>{erro}</AvisoErro>}
        <div className="space-y-2">
          <Label htmlFor="confirmar-senha">Senha</Label>
          <Input
            id="confirmar-senha"
            type="password"
            required
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={enviando} className="min-h-11 w-full font-medium">
          {enviando ? 'Confirmando...' : 'Confirmar'}
        </Button>
      </form>
    </TelaDeEntrada>
  )
}
