import { Howl } from 'howler';

export type SoundName = 'clack' | 'draw' | 'score' | 'win' | 'lose';

const FILES: Record<SoundName, { src: string; volume: number }> = {
  clack: { src: '/sounds/clack.wav', volume: 0.8 },
  draw: { src: '/sounds/draw.wav', volume: 0.7 },
  score: { src: '/sounds/score.wav', volume: 0.6 },
  win: { src: '/sounds/win.wav', volume: 0.7 },
  lose: { src: '/sounds/lose.wav', volume: 0.6 },
};

const STORAGE_KEY = 'domino:muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // modo privado / storage bloqueado
  }
}

let muted = readMuted();
const cache: Partial<Record<SoundName, Howl>> = {};

// Cada som só é carregado na primeira vez que toca (e o Howler destrava o áudio
// do iOS/Safari no primeiro toque do usuário).
function get(name: SoundName): Howl {
  let h = cache[name];
  if (!h) {
    h = new Howl({ src: [FILES[name].src], volume: FILES[name].volume, preload: true });
    cache[name] = h;
  }
  return h;
}

export function playSound(name: SoundName) {
  if (muted) return;
  const h = get(name);
  // pequena variação de tom no "clack" para não soar repetido
  if (name === 'clack') h.rate(0.94 + Math.random() * 0.14);
  h.play();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* sem persistência, tudo bem */
  }
}
