import React, { useState } from 'react'
import { ActionItem, ActionStatus } from '@/types/execution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CheckCircle2,
  Clock,
  MoreVertical,
  Star,
  StarOff,
  AlertTriangle,
  FolderKanban,
  MinusCircle,
  Play,
  RotateCcw,
  Plus,
} from 'lucide-react'

interface ActionRowProps {
  action: ActionItem
  isNextAdvance?: boolean
  onToggleNextStep?: (id: string, current: boolean) => void
  onToggleTodaySelected?: (id: string, current: boolean) => void
  onStatusChange?: (id: string, status: ActionStatus, reason?: string) => void
  onOpenLogModal?: (action: ActionItem) => void
  onEdit?: (action: ActionItem) => void
}

export const ActionRow: React.FC<ActionRowProps> = ({
  action,
  isNextAdvance = false,
  onToggleNextStep,
  onToggleTodaySelected,
  onStatusChange,
  onOpenLogModal,
  onEdit,
}) => {
  const [waitingReason, setWaitingReason] = useState('')
  const [showReasonInput, setShowReasonInput] = useState(false)
  const [targetStatus, setTargetStatus] = useState<ActionStatus | null>(null)

  const getStatusBadge = (status: ActionStatus) => {
    switch (status) {
      case 'pronta':
        return (
          <Badge
            variant="outline"
            className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
          >
            Pronta
          </Badge>
        )
      case 'em_andamento':
        return (
          <Badge variant="outline" className="border-blue-500/40 text-blue-300 bg-blue-500/10">
            Em andamento
          </Badge>
        )
      case 'aguardando':
        return (
          <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">
            Aguardando
          </Badge>
        )
      case 'bloqueada':
        return (
          <Badge variant="outline" className="border-rose-500/40 text-rose-300 bg-rose-500/10">
            Bloqueada
          </Badge>
        )
      case 'feita':
        return (
          <Badge variant="outline" className="border-slate-600 text-slate-400 bg-slate-800">
            Feita
          </Badge>
        )
      case 'cancelada':
        return (
          <Badge variant="outline" className="border-slate-700 text-slate-500 line-through">
            Cancelada
          </Badge>
        )
    }
  }

  const handleSelectStatus = (newStatus: ActionStatus) => {
    if (newStatus === 'aguardando' || newStatus === 'bloqueada') {
      setTargetStatus(newStatus)
      setShowReasonInput(true)
    } else {
      onStatusChange?.(action.id, newStatus)
    }
  }

  const confirmReasonStatus = () => {
    if (targetStatus) {
      onStatusChange?.(action.id, targetStatus, waitingReason)
      setShowReasonInput(false)
      setWaitingReason('')
      setTargetStatus(null)
    }
  }

  const isDone = action.status === 'feita'
  const isCanceled = action.status === 'cancelada'

  return (
    <div
      className={`group relative rounded-xl border p-4 transition-all ${
        isNextAdvance
          ? 'bg-gradient-to-r from-emerald-950/40 to-slate-900 border-emerald-500/50 ring-1 ring-emerald-500/20 shadow-lg'
          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
      } ${isDone || isCanceled ? 'opacity-60 bg-slate-950/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left main info */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Quick complete / status toggle button */}
          <button
            onClick={() => onStatusChange?.(action.id, isDone ? 'pronta' : 'feita')}
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
              isDone
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'border-slate-700 hover:border-emerald-500 text-transparent hover:text-emerald-500'
            }`}
            title={isDone ? 'Reabrir como pronta' : 'Marcar como concluída'}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {getStatusBadge(action.status)}
              <span
                className={`text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                  action.context === 'trabalho'
                    ? 'bg-sky-950/60 text-sky-400 border border-sky-800/40'
                    : 'bg-amber-950/60 text-amber-400 border border-amber-800/40'
                }`}
              >
                {action.context}
              </span>

              {action.expand?.project_id && (
                <span
                  className="flex items-center gap-1 text-xs text-slate-400 truncate max-w-xs"
                  title={action.expand.project_id.title}
                >
                  <FolderKanban className="w-3 h-3 text-slate-500" />
                  <span className="truncate">{action.expand.project_id.title}</span>
                </span>
              )}

              {action.deadline && (
                <span className="flex items-center gap-1 text-xs font-mono text-slate-400">
                  <Clock className="w-3 h-3 text-slate-500" />
                  {action.deadline}
                </span>
              )}
            </div>

            <h4
              className={`text-sm sm:text-base font-medium break-words ${
                isDone
                  ? 'line-through text-slate-500'
                  : isNextAdvance
                    ? 'text-white font-semibold'
                    : 'text-slate-200'
              }`}
            >
              {action.title}
            </h4>

            {action.waiting_for && (
              <p className="text-xs text-amber-300/90 mt-1 bg-amber-950/30 border border-amber-900/40 px-2 py-1 rounded inline-block">
                Motivo: {action.waiting_for}
              </p>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Action Log button */}
          {onOpenLogModal && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenLogModal(action)}
              className="h-8 px-2 text-xs text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
              title="Registrar progresso nesta ação"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">Progresso</span>
            </Button>
          )}

          {/* Next Advance star toggle */}
          {onToggleNextStep && !isDone && (
            <button
              onClick={() => onToggleNextStep(action.id, action.is_next_step)}
              className={`p-1.5 rounded-lg border transition-all ${
                action.is_next_step
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'text-slate-500 hover:text-amber-300 border-transparent hover:border-slate-800'
              }`}
              title={
                action.is_next_step
                  ? 'Remover de Próximo Avanço'
                  : 'Definir como Próximo Avanço Único'
              }
            >
              <Star className="w-4 h-4 fill-current" />
            </button>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-white"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-slate-900 border-slate-800 text-slate-200"
            >
              {onToggleTodaySelected && !isDone && (
                <DropdownMenuItem
                  onClick={() => onToggleTodaySelected(action.id, action.is_today_selected)}
                  className="gap-2 cursor-pointer"
                >
                  {action.is_today_selected ? (
                    <>
                      <MinusCircle className="w-4 h-4 text-slate-400" />
                      <span>Tirar de Hoje</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 text-emerald-400" />
                      <span>Selecionar para Hoje</span>
                    </>
                  )}
                </DropdownMenuItem>
              )}

              {onToggleNextStep && !isDone && (
                <DropdownMenuItem
                  onClick={() => onToggleNextStep(action.id, action.is_next_step)}
                  className="gap-2 cursor-pointer"
                >
                  {action.is_next_step ? (
                    <>
                      <StarOff className="w-4 h-4 text-amber-400" />
                      <span>Desmarcar Próximo Avanço</span>
                    </>
                  ) : (
                    <>
                      <Star className="w-4 h-4 text-amber-400" />
                      <span>Definir como Próximo Avanço</span>
                    </>
                  )}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="bg-slate-800" />

              <DropdownMenuItem
                onClick={() => handleSelectStatus('pronta')}
                className="cursor-pointer"
              >
                Marcar como Pronta
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('em_andamento')}
                className="cursor-pointer"
              >
                Marcar em Andamento
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('aguardando')}
                className="cursor-pointer"
              >
                Marcar como Aguardando...
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('bloqueada')}
                className="cursor-pointer"
              >
                Marcar como Bloqueada...
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('feita')}
                className="cursor-pointer"
              >
                Concluir ação (Feita)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleSelectStatus('cancelada')}
                className="cursor-pointer text-slate-400"
              >
                Cancelar ação
              </DropdownMenuItem>

              {onEdit && (
                <>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem onClick={() => onEdit(action)} className="cursor-pointer">
                    Editar Detalhes
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Sub-form when selecting waiting/blocked */}
      {showReasonInput && (
        <div className="mt-3 p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
          <p className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Descreva o que está impedindo ou pelo que está aguardando:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={waitingReason}
              onChange={(e) => setWaitingReason(e.target.value)}
              placeholder="Ex: Aguardando retorno do e-mail / Falta aprovação"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <Button
              size="sm"
              onClick={confirmReasonStatus}
              className="bg-emerald-600 hover:bg-emerald-500 text-white h-7 text-xs"
            >
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowReasonInput(false)}
              className="h-7 text-xs text-slate-400"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
