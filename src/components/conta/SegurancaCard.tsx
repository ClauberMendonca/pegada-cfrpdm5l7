import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Acesso, meusAcessos, mensagemDe, navegadorCurto, nomeDoAcesso, quandoCurto } from '@/lib/pegada/conta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/** Segurança: os últimos acessos e o botão de encerrar as outras sessões. */
export const SegurancaCard: React.FC = () => {
  const { signOutEverywhere } = useAuth()
  const [acessos, setAcessos] = useState<Acesso[] | null>(null)
  const [saindo, setSaindo] = useState(false)

  const carregar = useCallback(() => {
    meusAcessos()
      .then(setAcessos)
      .catch(() => setAcessos([]))
  }, [])
  useEffect(carregar, [carregar])

  const sair = async () => {
    setSaindo(true)
    try {
      await signOutEverywhere()
      toast.success('Pronto. Só este aparelho continua com a sessão aberta.')
      carregar()
    } catch (err) {
      toast.error(mensagemDe(err))
    } finally {
      setSaindo(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Segurança
        </CardTitle>
        <CardDescription>
          Os últimos acessos à sua conta. O registro guarda 180 dias e nunca guarda senha nem conteúdo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {acessos === null ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : acessos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum acesso registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Últimos acessos">
            {acessos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="text-sm text-foreground">{nomeDoAcesso(a.o_que)}</span>
                <span className="text-xs text-muted-foreground">
                  {[quandoCurto(a.quando), navegadorCurto(a.navegador), a.ip].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="max-w-sm text-sm text-muted-foreground">
            Perdeu um aparelho ou viu um acesso estranho? Encerre as outras sessões e troque a senha.
          </p>
          <Button type="button" variant="outline" className="min-h-11" onClick={sair} disabled={saindo}>
            {saindo ? 'Encerrando...' : 'Sair de todos os outros aparelhos'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
