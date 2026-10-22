import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';

// Posições dos pontos na grade 3x3 de cada face.
// tl/tr = topo esq/dir, ml/mr = meio esq/dir, c = centro, bl/br = base esq/dir
const PIP_LAYOUT: Record<number, string[]> = {
  0: [],
  1: ['c'],
  2: ['tr', 'bl'],
  3: ['tr', 'c', 'bl'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};

function Face({ value }: { value: number }) {
  return (
    <div className="tile-face">
      {(PIP_LAYOUT[value] ?? []).map((pos) => (
        <span key={pos} className={`pip pip-${value} at-${pos}`} />
      ))}
    </div>
  );
}

type DominoTileProps = {
  left: number;
  right: number;
  horizontal?: boolean;
} & HTMLMotionProps<'div'>;

// O tamanho vem da variável CSS --u (largura da peça em pé).
// Quem usa o componente define --u no pai, e tudo escala junto.
// Aceita props do Framer Motion (layoutId, initial, animate...) para animar a peça.
export function DominoTile({ left, right, horizontal = false, className = '', ...motionProps }: DominoTileProps) {
  return (
    <motion.div className={`tile ${horizontal ? 'horizontal' : ''} ${className}`} {...motionProps}>
      <Face value={left} />
      <div className="tile-divider" />
      <Face value={right} />
    </motion.div>
  );
}

export function DominoBack() {
  return <div className="tile tile-back" />;
}
