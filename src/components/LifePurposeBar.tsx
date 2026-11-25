import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Compass } from 'lucide-react'

/**
 * ENTREGA 2B — Faixa global do propósito de vida.
 *
 * Montada UMA vez no Layout autenticado (fora do Outlet), lê SOMENTE
 * useAuth().user.life_purpose — sem provider, campo, serviço, cache local ou
 * consulta novos. Atualização confirmada nas Configurações reflete aqui
 * automaticamente (o perfil compartilhado muda o estado do AuthContext).
 *
 * Estados:
 * - Frase salva: rótulo + frase truncada em linha + "Ver propósito" (Dialog
 *   com o texto INTEGRAL, texto puro React, sem HTML/Markdown/link).
 * - Vazio confirmado (inclui apenas espaços): convite discreto para
 *   /configuracoes. Sem onboarding automático.
 * - Sem usuário/sessão válida: nada é renderizado (nada é afirmado).
 *
 * Obs.: o contrato atual do AuthContext não expõe estado de erro de perfil
 * (a leitura fresca falha em silêncio e o perfil vem do authStore mapeado) —
 * portanto não há como distinguir "falha conhecida" aqui; o estado de
 * carregamento é tratado pelo gate do App (Layout só monta autenticado).
 */
export function LifePurposeBar() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  // Sem usuário/sessão válida: nenhuma frase, nenhum convite.
  if (!user) return null

  const raw = user.life_purpose ?? ''
  // Apenas espaços é visualmente vazio. Verificação só de apresentação:
  // nenhuma normalização é gravada no backend.
  const hasPurpose = raw.trim() !== ''

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-2 lg:px-8">
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5">
        <Compass className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-sm font-medium text-foreground">Meu propósito</span>

        {hasPurpose ? (
          <>
            {/* min-w-0 + truncate: frase longa não aumenta a altura da
               pilha no celular; a leitura integral fica no Dialog. */}
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{raw}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="min-h-11 shrink-0 px-3 text-sm"
            >
              Ver propósito
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Propósito de vida</DialogTitle>
                  <DialogDescription>
                    Texto integral salvo no seu perfil. A edição continua exclusivamente em
                    Configurações.
                  </DialogDescription>
                </DialogHeader>
                {/* Texto puro React: quebras/espaços preservados, word-break
                   e rolagem interna. Sem HTML, Markdown, link ou truncamento. */}
                <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border bg-card p-4">
                  <p className="break-words whitespace-pre-wrap text-base leading-relaxed text-foreground">
                    {raw}
                  </p>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" asChild className="min-h-11">
                    {/* Navegar fecha a leitura: nenhum overlay órfão. */}
                    <Link to="/mapa/proposito" onClick={() => setOpen(false)}>
                      Editar nas Configurações
                    </Link>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          // Propósito vazio confirmado: convite discreto, como link —
          // nunca diálogo automático nem onboarding obrigatório.
          <Link
            to="/mapa/proposito"
            className="min-w-0 flex-1 truncate text-sm text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Defina seu propósito
          </Link>
        )}
      </div>
    </div>
  )
}
