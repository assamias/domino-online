import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DominoTile } from './DominoTile';
import { computeBoardLayout } from '../game/boardLayout';
import { SPRING } from '../game/motion';
import type { PlayedLike } from '../game/boardLayout';

type Side = 'left' | 'right';

interface BoardProps {
  playedPieces: PlayedLike[];
  boardLeft: number | null;
  boardRight: number | null;
  /** Pontas onde a peça selecionada pode ser jogada (mostram o botão) */
  canDropLeft: boolean;
  canDropRight: boolean;
  canDropFirst: boolean;
  /** Mensagem quando a mesa está vazia e não há peça selecionada */
  emptyHint: string;
  /** Ids das peças que já estiveram na minha mão (elas deslizam da mão até a mesa) */
  myPieceIds: ReadonlySet<string>;
  onPlay: (side: Side) => void;
}

export function Board({ playedPieces, boardLeft, boardRight, canDropLeft, canDropRight, canDropFirst, emptyHint, myPieceIds, onPlay }: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => computeBoardLayout(playedPieces, size.w, size.h, 58), [playedPieces, size.w, size.h]);

  const boxStyle = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({
    left: b.x,
    top: b.y,
    width: b.w,
    height: b.h,
  });

  return (
    <div ref={ref} className="chain" style={{ '--u': `${layout.u}px` } as CSSProperties}>
      {size.w > 0 && (
        <>
          {playedPieces.length === 0 && !canDropFirst && <p className="table-hint">{emptyHint}</p>}

          {canDropFirst && (
            <button className="drop-zone" style={boxStyle(layout.firstZone)} onClick={() => onPlay('left')}>
              Jogue aqui
            </button>
          )}

          {layout.tiles.map((t) => {
            const mine = myPieceIds.has(t.id);
            return (
              <DominoTile
                key={t.id}
                layoutId={t.id}
                data-piece={t.id}
                left={t.a}
                right={t.b}
                horizontal={t.horizontal}
                className="on-board"
                style={{ left: t.x, top: t.y }}
                // peças do oponente caem do alto; as minhas deslizam da mão (layoutId compartilhado)
                initial={mine ? false : { opacity: 0, y: -70, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={SPRING}
              />
            );
          })}

          {layout.zones && canDropLeft && (
            <button
              className="drop-zone"
              style={boxStyle(layout.zones.left)}
              onClick={() => onPlay('left')}
              aria-label="Jogar na ponta esquerda"
            >
              {layout.zones.left.w >= layout.zones.left.h ? `◀ ${boardLeft}` : boardLeft}
            </button>
          )}

          {layout.zones && canDropRight && (
            <button
              className="drop-zone"
              style={boxStyle(layout.zones.right)}
              onClick={() => onPlay('right')}
              aria-label="Jogar na ponta direita"
            >
              {layout.zones.right.w >= layout.zones.right.h ? `${boardRight} ▶` : boardRight}
            </button>
          )}
        </>
      )}
    </div>
  );
}
