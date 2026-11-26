import React from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { PegadaSimbolo } from '@/components/PegadaSimbolo'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** Moldura das telas de fora do app: entrar, convite, nova senha. */
export const TelaDeEntrada: React.FC<{
  titulo: string
  descricao?: string
  children: React.ReactNode
  rodape?: React.ReactNode
}> = ({ titulo, descricao, children, rodape }) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground">
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <PegadaSimbolo className="mx-auto mb-3 h-14 w-14 text-foreground" />
        <p className="text-2xl font-semibold tracking-tight text-foreground">Pegada</p>
        <p className="mt-1 text-sm text-muted-foreground">Cada passo com o seu porquê</p>
      </div>
      <Card className="border-border bg-card text-card-foreground shadow-2xl">
        <CardHeader className="space-y-1">
          <h1 className="text-lg font-medium leading-tight tracking-tight text-foreground">{titulo}</h1>
          {descricao && <CardDescription className="text-muted-foreground">{descricao}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
      {rodape && <div className="mt-4 text-center text-sm text-muted-foreground">{rodape}</div>}
    </div>
  </div>
)

export const AvisoErro: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Alert variant="destructive" className="border-destructive/30 bg-pegada-danger-bg text-destructive">
    <AlertCircle className="h-4 w-4" />
    <AlertDescription>{children}</AlertDescription>
  </Alert>
)

export const AvisoCerto: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Alert className="border-border bg-accent text-foreground">
    <CheckCircle2 className="h-4 w-4" />
    <AlertDescription>{children}</AlertDescription>
  </Alert>
)
