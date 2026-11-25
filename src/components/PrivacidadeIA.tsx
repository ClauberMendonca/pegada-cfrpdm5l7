// PEGADA — Privacidade da IA em Configurações: o que é enviado e a chave
// para desligar. Desligada, nenhuma tela envia texto à IA.
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { gravarEstadoIA, lerEstadoIA, type EstadoIA } from '@/lib/pegada/api'

export function PrivacidadeIA() {
  const [estado, setEstado] = useState<EstadoIA | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    lerEstadoIA(true)
      .then(setEstado)
      .catch(() => setErro('Não foi possível ler a preferência da IA.'))
  }, [])

  const alternar = async (ligada: boolean) => {
    setOcupado(true)
    setErro(null)
    try {
      setEstado(await gravarEstadoIA({ desligada: !ligada }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Card className="border-border bg-card text-card-foreground" data-privacidade-ia>
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-foreground">IA e privacidade</CardTitle>
        <CardDescription className="text-muted-foreground">
          A IA do Pegada sugere, e você decide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="ia-ligada" className="text-base font-medium text-foreground">
            Usar sugestões da IA
          </label>
          <Switch
            id="ia-ligada"
            checked={estado ? !estado.desligada : false}
            disabled={!estado || ocupado}
            onCheckedChange={(v) => void alternar(v)}
          />
        </div>
        {estado && !estado.disponivel && (
          <p className="text-sm text-muted-foreground">A IA não está configurada neste servidor.</p>
        )}
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            A cada pedido, o Pegada envia à Anthropic, que fornece a IA, só o texto daquele pedido: o que você
            escreveu ou o título do item que está desdobrando.
          </li>
          <li>O restante dos seus dados não é enviado, e nada é enviado sem um pedido.</li>
          <li>Com a chave desligada, nenhuma tela envia texto à IA e os botões de sugestão avisam isso.</li>
        </ul>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </CardContent>
    </Card>
  )
}

export default PrivacidadeIA
