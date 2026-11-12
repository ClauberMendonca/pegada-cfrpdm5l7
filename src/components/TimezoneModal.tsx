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
      <DialogContent className="max-w-[min(680px,calc(100vw-16px))] rounded-[20px] bg-card text-foreground sm:rounded-[20px]">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-accent text-primary">
            <Globe className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Defina seu Fuso Horário
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Para que o cálculo de "Hoje", os prazos e os registros de progresso fiquem sincronizados
            com o seu dia local.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Fuso Horário Local
            </Label>
            <Select value={selectedTz} onValueChange={setSelectedTz}>
              <SelectTrigger className="min-h-11 border-input bg-card text-base text-foreground sm:text-sm">
                <SelectValue placeholder="Selecione o fuso" />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover text-popover-foreground">
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
          <p className="text-sm text-muted-foreground">
            Detectado automaticamente no navegador:{' '}
            <span className="font-medium text-foreground tabular-nums">{detectedTz}</span>
          </p>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving} className="min-h-11 w-full rounded-xl">
            {isSaving ? 'Salvando...' : 'Confirmar e Iniciar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
