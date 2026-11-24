// Símbolo do Pegada: a pegada laranja e o ponto. O ponto segue a cor do texto
// (escuro no tema claro, claro no tema escuro).
export function PegadaSimbolo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <rect
        x="30"
        y="34"
        width="30"
        height="52"
        rx="15"
        transform="rotate(28 45 60)"
        fill="#D2551E"
      />
      <circle cx="65" cy="23" r="8" fill="currentColor" />
    </svg>
  )
}

export default PegadaSimbolo
