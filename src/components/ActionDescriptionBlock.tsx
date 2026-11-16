import React, { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActionDescriptionBlockProps {
  description?: string
  idPrefix: string
}

/**
 * FATIA — DESCRIÇÃO OPCIONAL NAS AÇÕES.
 *
 * Bloco compartilhado de leitura da descrição de uma ação, reutilizado em
 * Ações, Hoje e detalhe do Projeto (todas as telas usam ActionRow). Renderiza
 * SEMPRE como texto puro do React (nunca HTML nem dangerouslySetInnerHTML);
 * quebras de linha preservadas com whitespace-pre-line, URLs/palavras longas
 * quebradas com break-words/break-all. Ações sem descrição não ganham bloco
 * vazio nem botão sem função.
 */
export const ActionDescriptionBlock: React.FC<ActionDescriptionBlockProps> = ({
  description,
  idPrefix,
}) => {
  const [expanded, setExpanded] = useState(false)
  const text = typeof description === 'string' ? description : ''
  if (!text.trim()) return null

  const bodyId = `${idPrefix}-description-body`
  const controlText = expanded ? 'Recolher descrição' : 'Ler descrição'

  return (
    <div className="mt-2 space-y-1.5">
      <p
        id={bodyId}
        className={cn(
          'whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground',
          // Prévia compacta de até duas linhas quando recolhida
          !expanded && 'line-clamp-2',
        )}
      >
        {text}
      </p>
      {!expanded && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(true)}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
          <span>{controlText}</span>
        </button>
      )}
      {expanded && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(false)}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
          <span>{controlText}</span>
        </button>
      )}
    </div>
  )
}
