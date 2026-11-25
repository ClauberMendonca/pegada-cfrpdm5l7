// Marca do Pegada: "Por quê? Ação." Um ponto de interrogação cujo ponto é o
// triângulo de dar partida. O gancho segue a cor do texto (escuro no tema
// claro, claro no tema escuro) e o triângulo é a única peça laranja.
// Sobre fundo laranja, use sobreLaranja: gancho areia e triângulo terra.

/** O símbolo. Abaixo de 24 px, passe `pequeno`: o desenho é mais compacto. */
export function PegadaSimbolo({
  className,
  pequeno = false,
  sobreLaranja = false,
}: {
  className?: string
  pequeno?: boolean
  sobreLaranja?: boolean
}) {
  const gancho = sobreLaranja ? '#F4EEE6' : 'currentColor'
  const triangulo = sobreLaranja ? '#17130F' : '#D2551E'
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <path
        d={
          pequeno
            ? 'M33 27A17 17 0 1 1 62.63 38.38C56.38 45.32 50 38.59 50 47V47'
            : 'M31.5 30A18.5 18.5 0 1 1 63.75 42.38C56.94 49.94 50 43.34 50 52.5V54.5'
        }
        fill="none"
        stroke={gancho}
        strokeWidth={pequeno ? 18.5 : 16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={pequeno ? 'M44.75 71.65L44.75 86.85L61.15 79.25Z' : 'M46 75.9L46 90.1L59.4 83Z'}
        fill={triangulo}
        stroke={triangulo}
        strokeWidth="8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** O nome "pegada", nas letras próprias da marca. A altura vem da classe. */
export function PegadaNome({ className }: { className?: string }) {
  return (
    <svg viewBox="-10 -63.5 378 127" className={className} role="img" aria-label="pegada" focusable="false">
      <path
        d="M6.5 -20V47 M6.5 0A20 20 0 1 1 46.5 0A20 20 0 1 1 6.5 0Z M67.5 0H107.5A20 20 0 1 0 100.88 14.86 M168.5 -20V27A20 20 0 0 1 133.64 40.38 M128.5 0A20 20 0 1 1 168.5 0A20 20 0 1 1 128.5 0Z M229.5 -20V20 M189.5 0A20 20 0 1 1 229.5 0A20 20 0 1 1 189.5 0Z M290.5 -47V20 M250.5 0A20 20 0 1 1 290.5 0A20 20 0 1 1 250.5 0Z M351.5 -20V20 M311.5 0A20 20 0 1 1 351.5 0A20 20 0 1 1 311.5 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default PegadaSimbolo
