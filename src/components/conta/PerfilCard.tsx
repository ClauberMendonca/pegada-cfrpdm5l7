import React, { useRef, useState } from 'react'
import { toast } from 'sonner'
import { User } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { mensagemDe } from '@/lib/pegada/conta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { reduzirFoto } from '@/lib/reduzirFoto'
import { COMMON_TIMEZONES } from '@/components/TimezoneModal'

/** Quem sou: nome, foto e fuso. É assim que os outros veem você. */
export const PerfilCard: React.FC = () => {
  const { user, avatarUrl, updateProfile, updateTimezone } = useAuth()
  const [nome, setNome] = useState(user?.name || '')
  const [salvando, setSalvando] = useState(false)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)
  if (!user) return null

  const inicial = (user.name || user.email).trim().charAt(0).toUpperCase()
  const fusos = COMMON_TIMEZONES.some((f) => f.value === user.timezone) || !user.timezone
    ? COMMON_TIMEZONES
    : [{ value: user.timezone, label: user.timezone.replace('_', ' ') }, ...COMMON_TIMEZONES]

  const salvarNome = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setSalvando(true)
    try {
      await updateProfile({ nome })
      toast.success('Nome salvo.')
    } catch (err) {
      toast.error(mensagemDe(err))
    } finally {
      setSalvando(false)
    }
  }

  const trocarFoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    if (f.type && !f.type.startsWith('image/')) return void toast.error('Escolha um arquivo de imagem.')
    setEnviandoFoto(true)
    try {
      // A foto é cortada e reduzida aqui mesmo, então o tamanho original não importa.
      const pronta = await reduzirFoto(f)
      await updateProfile({ foto: pronta })
      toast.success('Foto salva.')
    } catch (err) {
      toast.error(mensagemDe(err, 'Não deu para salvar a foto. Tente de novo.'))
    } finally {
      setEnviandoFoto(false)
    }
  }

  const tirarFoto = async () => {
    try {
      await updateProfile({ foto: null })
      toast.success('Foto removida.')
    } catch (err) {
      toast.error(mensagemDe(err))
    }
  }

  const trocarFuso = async (valor: string) => {
    try {
      await updateTimezone(valor)
      toast.success('Fuso salvo.')
    } catch (err) {
      toast.error(mensagemDe(err))
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-medium text-foreground">
          <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Perfil
        </CardTitle>
        <CardDescription>O seu nome e a sua foto aparecem para quem trabalha com você.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold"
            style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}
          >
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-16 w-16 object-cover" /> : inicial}
          </span>
          <input
            ref={arquivo}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Escolher foto"
            onChange={trocarFoto}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={enviandoFoto} onClick={() => arquivo.current?.click()}>
              {enviandoFoto ? 'Salvando...' : avatarUrl ? 'Trocar foto' : 'Escolher foto'}
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={tirarFoto}>
                Remover
              </Button>
            )}
          </div>
        </div>

        <form onSubmit={salvarNome} className="space-y-2">
          <Label htmlFor="perfil-nome">Nome</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="perfil-nome"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              className="min-h-11 flex-1 basis-56"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <Button type="submit" className="min-h-11" disabled={salvando || nome.trim() === (user.name || '')}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>

        <div className="space-y-2">
          <Label htmlFor="perfil-fuso">Fuso horário</Label>
          <Select value={user.timezone || ''} onValueChange={trocarFuso}>
            <SelectTrigger id="perfil-fuso" className="min-h-11">
              <SelectValue placeholder="Escolha o fuso" />
            </SelectTrigger>
            <SelectContent>
              {fusos.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
