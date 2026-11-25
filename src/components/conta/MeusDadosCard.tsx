import React, { useState } from 'react'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { conta, mensagemDe } from '@/lib/pegada/conta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Meus dados: baixar tudo o que é meu e excluir a conta. */
export const MeusDadosCard: React.FC = () => {
  const { user, logout } = useAuth()
  const [baixando, setBaixando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [senha, setSenha] = useState('')
  const [palavra, setPalavra] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState('')
  if (!user) return null

  const baixar = async () => {
    setBaixando(true)
    try {
      const dados = await conta.exportar()
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pegada-meus-dados-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Arquivo baixado.')
    } catch (err) {
      toast.error(mensagemDe(err))
    } finally {
      setBaixando(false)
    }
  }

  const excluir = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro('')
    setExcluindo(true)
    try {
      await conta.excluir(senha, palavra.trim().toUpperCase())
      logout()
    } catch (err) {
      setErro(mensagemDe(err))
      setExcluindo(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
          <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Meus dados
        </CardTitle>
        <CardDescription>O que você escreveu no Pegada é seu. Leve com você ou apague quando quiser.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-muted-foreground">
            Um arquivo com tudo: propósito, vontades, responsabilidades, resultados, estratégias, avanços,
            capturas, tempo e histórico.
          </p>
          <Button type="button" variant="outline" className="min-h-11" onClick={baixar} disabled={baixando}>
            {baixando ? 'Preparando...' : 'Baixar meus dados'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="max-w-sm text-sm text-muted-foreground">
            Excluir a conta apaga tudo o que é seu, de vez. Não dá para desfazer.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 text-destructive hover:text-destructive"
            onClick={() => {
              setSenha('')
              setPalavra('')
              setErro('')
              setAberto(true)
            }}
          >
            Excluir a minha conta
          </Button>
        </div>
      </CardContent>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <form onSubmit={excluir} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Excluir a conta de vez?</DialogTitle>
              <DialogDescription>
                Tudo o que você escreveu no Pegada será apagado e não volta. Se quiser guardar uma cópia,
                baixe os seus dados antes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="excluir-senha">Sua senha</Label>
              <Input
                id="excluir-senha"
                type="password"
                required
                autoComplete="current-password"
                className="min-h-11"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="excluir-palavra">Digite EXCLUIR para confirmar</Label>
              <Input
                id="excluir-palavra"
                required
                autoComplete="off"
                className="min-h-11"
                value={palavra}
                onChange={(e) => setPalavra(e.target.value)}
              />
            </div>
            {erro && (
              <p className="text-sm text-destructive" role="alert">
                {erro}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setAberto(false)}>
                Manter a conta
              </Button>
              <Button type="submit" variant="destructive" className="min-h-11" disabled={excluindo}>
                {excluindo ? 'Excluindo...' : 'Excluir de vez'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
