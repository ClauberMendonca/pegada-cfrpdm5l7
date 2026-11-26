import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { conta, mensagemDe, senhaCurta } from '@/lib/pegada/conta'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TelaDeEntrada, AvisoErro } from '@/components/conta/TelaDeEntrada'
import { AvisoPrivacidade } from '@/components/conta/AvisoPrivacidade'

/** /convite/:token — a pessoa convidada cria a própria conta. */
export const ConvitePage: React.FC = () => {
  const { token = '' } = useParams()
  const { login, logout, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [estado, setEstado] = useState<'lendo' | 'valido' | 'invalido'>('lendo')
  const [email, setEmail] = useState('')
  const [motivo, setMotivo] = useState('')
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [aceito, setAceito] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    conta
      .verConvite(token)
      .then((r) => {
        if (!vivo) return
        if (r.valido && r.email) {
          setEmail(r.email)
          setEstado('valido')
        } else {
          setMotivo(r.motivo || 'Este convite não vale mais.')
          setEstado('invalido')
        }
      })
      .catch((err) => {
        if (!vivo) return
        setMotivo(mensagemDe(err, 'Não consegui conferir o convite. Tente abrir o link de novo.'))
        setEstado('invalido')
      })
    return () => {
      vivo = false
    }
  }, [token])

  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    const curta = senhaCurta(senha)
    if (curta) return setErro(curta)
    if (!aceito) return setErro('Leia e aceite o aviso de privacidade para criar a conta.')
    setEnviando(true)
    try {
      const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
      await conta.aceitarConvite(token, { nome: nome.trim(), senha, fuso, aceito_aviso: true })
      if (isAuthenticated) logout()
      await login(email, senha)
      navigate('/', { replace: true })
    } catch (err) {
      setErro(mensagemDe(err))
    } finally {
      setEnviando(false)
    }
  }

  if (estado === 'lendo') {
    return (
      <TelaDeEntrada titulo="Conferindo o convite">
        <p className="text-sm text-muted-foreground">Só um instante.</p>
      </TelaDeEntrada>
    )
  }

  if (estado === 'invalido') {
    return (
      <TelaDeEntrada titulo="Convite indisponível" rodape={<Link className="underline underline-offset-4" to="/">Ir para a entrada</Link>}>
        <AvisoErro>{motivo}</AvisoErro>
      </TelaDeEntrada>
    )
  }

  return (
    <TelaDeEntrada
      titulo="Criar a sua conta"
      descricao={`Você foi convidado(a) para o Pegada. A conta será criada para ${email}.`}
    >
      <form onSubmit={criar} className="space-y-4">
        {erro && <AvisoErro>{erro}</AvisoErro>}
        <div className="space-y-2">
          <Label htmlFor="convite-nome">Como quer ser chamado(a)</Label>
          <Input
            id="convite-nome"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="convite-senha">Crie uma senha</Label>
          <Input
            id="convite-senha"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            aria-describedby="convite-senha-dica"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <p id="convite-senha-dica" className="text-xs text-muted-foreground">
            Pelo menos 10 caracteres. Uma frase curta é mais fácil de lembrar e mais difícil de adivinhar.
          </p>
        </div>
        <details className="rounded-lg border border-border p-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-foreground">
            Aviso de privacidade
          </summary>
          <AvisoPrivacidade className="pt-2" />
        </details>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="convite-aceito" checked={aceito} onCheckedChange={(v) => setAceito(v === true)} />
          <Label htmlFor="convite-aceito" className="text-sm font-normal leading-snug">
            Li o aviso de privacidade e concordo.
          </Label>
        </div>
        <Button type="submit" disabled={enviando} className="min-h-11 w-full font-medium">
          {enviando ? 'Criando...' : 'Criar conta e entrar'}
          {!enviando && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </form>
    </TelaDeEntrada>
  )
}
