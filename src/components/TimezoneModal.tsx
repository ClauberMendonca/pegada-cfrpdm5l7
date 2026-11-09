import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Globe, Clock } from 'lucide-react'

const COMMON_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Belem', label: 'Belém / Norte (GMT-3)' },
  { value: 'America/Fortaleza', label: 'Nordeste (GMT-3)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Acre (GMT-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
  { value: 'Europe/Lisbon', label: 'Lisboa / Porto (GMT+0 / GMT+1)' },
  { value: 'UTC', label: 'UTC Universal' },
]

export const TimezoneModal: React.FC = () => {
  const { needsTimezoneSetup, updateTimezone } = useAuth()
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  const [selectedTz, setSelectedTz] = useState(detectedTz)
  const [isSaving, setIsSaving] = useState(false)

  if (!needsTimezoneSetup) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateTimezone(selectedTz)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={needsTimezoneSetup}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-md sm:rounded-xl">
        <DialogHeader>
          <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400 mb-2">
            <Globe className="w-5 h-5" />
          </div>
          <DialogTitle className="text-xl font-bold text-white">
            Defina seu Fuso Horário
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            Para que o cálculo de "Hoje", os prazos e os registros de progresso fiquem sincronizados
            com o seu dia local.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-slate-300 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Fuso Horário Local
            </Label>
            <Select value={selectedTz} onValueChange={setSelectedTz}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="Selecione o fuso" />
              </SelectTrigger>
              <SelectContent className="bg-slate-850 border-slate-700 text-slate-200">
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
                {!COMMON_TIMEZONES.find((t) => t.value === detectedTz) && (
                  <SelectItem value={detectedTz}>{detectedTz}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-slate-500">
            Detectado automaticamente no navegador:{' '}
            <span className="text-slate-400 font-mono">{detectedTz}</span>
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {isSaving ? 'Salvando...' : 'Confirmar e Iniciar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
