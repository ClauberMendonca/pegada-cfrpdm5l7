import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { FilterProvider } from '@/contexts/FilterContext'
import { TimeProvider } from '@/contexts/TimeContext'
import Layout from '@/components/Layout'
import { TodayPage } from '@/pages/TodayPage'
import { CapturesPage } from '@/pages/CapturesPage'
import { FichaAvancoPage } from '@/pages/FichaAvancoPage'
import { FichaResultadoPage } from '@/pages/FichaResultadoPage'
import { FichaResponsabilidadePage } from '@/pages/FichaResponsabilidadePage'
import { FichaVontadePage } from '@/pages/FichaVontadePage'
import { fichaDe, type Degrau } from '@/lib/pegada/enderecos'
import { MapPage } from '@/pages/MapPage'
import { ReviewPage } from '@/pages/ReviewPage'
import SettingsPage from '@/pages/SettingsPage'
import { ActivityPage } from '@/pages/ActivityPage'
import { LoginPage } from '@/pages/LoginPage'
import { PropositoPage } from '@/pages/PropositoPage'
import NotFound from '@/pages/NotFound'

// Endereços antigos continuam valendo: levam ao lugar novo, com o que vinha depois do "?".
const Redireciona = ({ para }: { para: string }) => {
  const { search } = useLocation()
  return <Navigate to={para + search} replace />
}

// Um link antigo de catálogo com "?id=" abre a ficha do item; sem id, abre o Mapa.
const RedirecionaFicha = ({ degrau }: { degrau: Degrau }) => {
  const [params] = useSearchParams()
  const id = params.get('id')?.trim()
  return <Navigate to={id ? fichaDe(degrau, id) : '/mapa'} replace />
}

const ProtectedRoutes = () => {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Iniciando sistema...</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <FilterProvider>
      <TimeProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<TodayPage />} />
            {/* A Caixa recebe o que foi capturado e espera decisão. */}
            <Route path="/caixa" element={<CapturesPage />} />
            <Route path="/capturas" element={<Redireciona para="/caixa" />} />
            {/* Histórico com desfazer e o cadastro de agentes. */}
            <Route path="/historico" element={<ActivityPage />} />
            <Route path="/atividade" element={<Redireciona para="/historico" />} />
            {/* O Mapa é a casa dos cinco elementos: toda ficha mora embaixo dele. */}
            <Route path="/mapa" element={<MapPage />}>
              <Route path="proposito" element={<PropositoPage />} />
              <Route path="vontade/:id" element={<FichaVontadePage />} />
              <Route path="responsabilidade/:id" element={<FichaResponsabilidadePage />} />
              <Route path="resultado/:id" element={<FichaResultadoPage />} />
              <Route path="avanco/:id" element={<FichaAvancoPage />} />
            </Route>
            {/* Os catálogos antigos saíram: os endereços levam ao Mapa ou à ficha. */}
            <Route path="/resultados" element={<RedirecionaFicha degrau="resultado" />} />
            <Route path="/projetos" element={<RedirecionaFicha degrau="resultado" />} />
            <Route path="/responsabilidades" element={<RedirecionaFicha degrau="responsabilidade" />} />
            <Route path="/avancos" element={<RedirecionaFicha degrau="avanco" />} />
            <Route path="/acoes" element={<RedirecionaFicha degrau="avanco" />} />
            <Route path="/revisao" element={<ReviewPage />} />
            {/* Configurações da conta: perfil, fuso e privacidade da IA. */}
            <Route path="/configuracoes" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </TimeProvider>
    </FilterProvider>
  )
}

const App = () => (
  <BrowserRouter>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <ProtectedRoutes />
      </AuthProvider>
    </TooltipProvider>
  </BrowserRouter>
)

export default App
