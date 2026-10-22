// Layout da mesa em "cobrinha".
//
// A primeira peça jogada fica no centro. A partir dela, a cadeia cresce em DOIS braços:
// o direito (peças jogadas na direita) e o esquerdo (peças jogadas na esquerda).
// Cada braço anda na horizontal até bater na borda da mesa, vira com uma peça em pé,
// e volta na fileira de baixo (braço direito) ou de cima (braço esquerdo, espelhado em 180°).
// Assim, adicionar uma peça nunca muda a posição das que já estão na mesa.
//
// Unidade: u = largura de uma peça em pé. Peça deitada = 2u x u. Dupla fica em pé (u x 2u).

export interface PieceLike {
  id: string;
  left: number;
  right: number;
}

export interface PlayedLike {
  piece: PieceLike;
  side: 'left' | 'right';
}

export interface PlacedTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Valor da primeira face (esquerda se deitada, topo se em pé) */
  a: number;
  /** Valor da segunda face (direita se deitada, base se em pé) */
  b: number;
  horizontal: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardLayout {
  u: number;
  tiles: PlacedTile[];
  /** Onde a próxima peça de cada ponta vai entrar (para os botões de jogar) */
  zones: { left: Box; right: Box } | null;
  /** Slot da primeira peça (mesa vazia) */
  firstZone: Box;
  fits: boolean;
}

interface ArmTile {
  id: string;
  inner: number; // face que encosta na peça anterior (lado do centro)
  outer: number; // face voltada para a ponta
  isDouble: boolean;
  ghost?: boolean;
}

interface LocalTile extends PlacedTile {
  ghost: boolean;
}

// Distância entre o eixo de uma fileira e o da próxima. 1.5u dá folga para as duplas em pé.
const ROW_PITCH = 1.5;

function layoutArm(tiles: ArmTile[], u: number, startX: number, xmax: number): LocalTile[] {
  const out: LocalTile[] = [];
  let x = startX;
  let y = 0;
  let s = 1; // sentido da fileira: +1 para a direita, -1 para a esquerda

  for (const t of tiles) {
    const len = t.isDouble ? u : 2 * u;
    // Só segue reto se sobrar espaço para uma peça de virada depois dela.
    const fits = s > 0 ? x + len + u <= xmax : x - len - u >= -xmax;

    if (fits) {
      if (t.isDouble) {
        out.push({ id: t.id, x: s > 0 ? x : x - u, y: y - u, w: u, h: 2 * u, a: t.outer, b: t.outer, horizontal: false, ghost: !!t.ghost });
        x += s * u;
      } else {
        out.push({
          id: t.id,
          x: s > 0 ? x : x - 2 * u,
          y: y - u / 2,
          w: 2 * u,
          h: u,
          a: s > 0 ? t.inner : t.outer,
          b: s > 0 ? t.outer : t.inner,
          horizontal: true,
          ghost: !!t.ghost
        });
        x += s * 2 * u;
      }
    } else {
      // Peça de virada: em pé, metade de cima encosta na fileira, metade de baixo encosta na próxima.
      out.push({ id: t.id, x: s > 0 ? x : x - u, y: y - 0.25 * u, w: u, h: 2 * u, a: t.inner, b: t.outer, horizontal: false, ghost: !!t.ghost });
      y += ROW_PITCH * u;
      s = -s;
    }
  }
  return out;
}

const ghostTile = (id: string): ArmTile => ({ id, inner: 0, outer: 0, isDouble: false, ghost: true });

function overlaps(p: Box, q: Box, eps: number): boolean {
  return p.x + p.w - eps > q.x && q.x + q.w - eps > p.x && p.y + p.h - eps > q.y && q.y + q.h - eps > p.y;
}

function build(played: PlayedLike[], u: number, W: number, H: number) {
  const center = played[0].piece;
  const centerDouble = center.left === center.right;
  const cw = centerDouble ? u : 2 * u;
  const ch = centerDouble ? 2 * u : u;
  const cx = W / 2;
  const cy = H / 2;

  const rightArm: ArmTile[] = [];
  const leftArm: ArmTile[] = [];
  for (const p of played.slice(1)) {
    const isDouble = p.piece.left === p.piece.right;
    if (p.side === 'right') rightArm.push({ id: p.piece.id, inner: p.piece.left, outer: p.piece.right, isDouble });
    else leftArm.push({ id: p.piece.id, inner: p.piece.right, outer: p.piece.left, isDouble });
  }
  // peça-fantasma no fim de cada braço: reserva o espaço (e dá a posição) da próxima jogada
  rightArm.push(ghostTile('ghost-right'));
  leftArm.push(ghostTile('ghost-left'));

  const xmax = W / 2;
  const R = layoutArm(rightArm, u, cw / 2, xmax);
  const L = layoutArm(leftArm, u, cw / 2, xmax);

  // braço esquerdo = braço direito girado 180° em torno do centro (e com as faces trocadas)
  const toGlobalR = (t: LocalTile): LocalTile => ({ ...t, x: cx + t.x, y: cy + t.y });
  const toGlobalL = (t: LocalTile): LocalTile => ({ ...t, x: cx - (t.x + t.w), y: cy - (t.y + t.h), a: t.b, b: t.a });

  const centerTile: LocalTile = { id: center.id, x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch, a: center.left, b: center.right, horizontal: !centerDouble, ghost: false };
  const all = [centerTile, ...R.map(toGlobalR), ...L.map(toGlobalL)];
  return all;
}

export function computeBoardLayout(played: PlayedLike[], W: number, H: number, maxU: number): BoardLayout {
  const minU = 12;
  const u0 = Math.max(minU, Math.min(maxU, W / 7));

  if (played.length === 0 || W <= 0 || H <= 0) {
    const w = 2 * u0;
    return { u: u0, tiles: [], zones: null, fits: true, firstZone: { x: W / 2 - w / 2, y: H / 2 - u0 / 2, w, h: u0 } };
  }

  let u = u0;
  let all = build(played, u, W, H);
  let fits = false;

  for (let i = 0; i < 40; i++) {
    all = build(played, u, W, H);
    const inside = all.every((t) => t.x >= -0.5 && t.y >= -0.5 && t.x + t.w <= W + 0.5 && t.y + t.h <= H + 0.5);
    let clear = true;
    for (let a = 0; a < all.length && clear; a++) {
      for (let b = a + 1; b < all.length; b++) {
        if (overlaps(all[a], all[b], 1)) { clear = false; break; }
      }
    }
    if (inside && clear) { fits = true; break; }
    if (u <= minU) break;
    u = Math.max(minU, u * 0.93);
  }

  const real = all.filter((t) => !t.ghost);
  const gl = all.find((t) => t.ghost && t.id === 'ghost-left')!;
  const gr = all.find((t) => t.ghost && t.id === 'ghost-right')!;

  return {
    u,
    tiles: real.map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, a: t.a, b: t.b, horizontal: t.horizontal })),
    zones: { left: { x: gl.x, y: gl.y, w: gl.w, h: gl.h }, right: { x: gr.x, y: gr.y, w: gr.w, h: gr.h } },
    firstZone: { x: W / 2 - u, y: H / 2 - u / 2, w: 2 * u, h: u },
    fits
  };
}
