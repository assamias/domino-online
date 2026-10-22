import { useState, useEffect, useRef } from 'react';
import { socket } from './services/socket';
import { DominoTile, DominoBack } from './components/DominoTile';
import { Board } from './components/Board';
import { SPRING } from './game/motion';
import { playSound, isMuted, setMuted } from "./sound";
import './App.css';

export type GameMode = 'CLASSIC' | 'PONTA_DE_CINCO';
type Side = 'left' | 'right';
type Scores = Record<string, number>;

interface Piece {
  id: string;
  left: number;
  right: number;
}

interface PlayedPiece {
  piece: Piece;
  side: Side;
}

interface GameState {
  roomId: string;
  hand: Piece[];
  boneyardCount: number;
  isBotGame: boolean;
  gameMode: GameMode;
  scores: Scores;
  boardLeft: number | null;
  boardRight: number | null;
  playedPieces: PlayedPiece[];
  currentTurnPlayerId: string;
  opponentHandCount: number;
  /** Todas as peças que já estiveram na minha mão (para animar mão -> mesa) */
  myPieceIds: string[];
}

interface GameStartedPayload {
  roomId: string;
  hand: Piece[];
  boneyardCount: number;
  isBotGame: boolean;
  gameMode: GameMode;
  scores?: Scores;
  currentTurnPlayerId?: string;
}

interface GameUpdatedPayload {
  boardLeft: number | null;
  boardRight: number | null;
  playedPieces: PlayedPiece[];
  boneyardCount: number;
  currentTurnPlayerId: string;
  opponentHandCount?: number;
  scores?: Scores;
  hand?: Piece[];
}

interface GameOverPayload {
  winner: string;
  reason: string;
}

interface Result {
  outcome: 'win' | 'lose' | 'draw';
  reason: string;
}

type Lobby = { kind: 'queue' } | { kind: 'private'; code: string };

const MODE_LABEL: Record<GameMode, string> = {
  PONTA_DE_CINCO: 'Ponta de 5',
  CLASSIC: 'Clássico',
};

const union = (ids: string[], hand: Piece[]) => Array.from(new Set([...ids, ...hand.map((p) => p.id)]));

// A peça encaixa nesse lado da mesa? (mesa vazia: qualquer peça serve)
function fitsSide(piece: Piece, side: Side, boardLeft: number | null, boardRight: number | null): boolean {
  if (boardLeft === null || boardRight === null) return true;
  const end = side === 'left' ? boardLeft : boardRight;
  return piece.left === end || piece.right === end;
}

function PlayerBadge({ name, score, active }: { name: string; score: number; active: boolean }) {
  return (
    <div className={`player-badge ${active ? 'active' : ''}`}>
      <span className="player-name">{name}</span>
      <span className="player-score">{score}</span>
    </div>
  );
}

function SoundButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button className="sound-btn" onClick={onToggle} aria-label={muted ? 'Ativar som' : 'Silenciar'} aria-pressed={muted}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
        {muted ? (
          <>
            <path d="M17 9l5 6" />
            <path d="M22 9l-5 6" />
          </>
        ) : (
          <>
            <path d="M16.5 8.5a5 5 0 010 7" />
            <path d="M19 6a8.5 8.5 0 010 12" />
          </>
        )}
      </svg>
    </button>
  );
}

export function App() {
  const [selectedMode, setSelectedMode] = useState<GameMode>('PONTA_DE_CINCO');
  const [opponentType, setOpponentType] = useState<'CPU' | 'MULTIPLAYER' | 'PRIVATE'>('CPU');
  const [roomCodeInput, setRoomCodeInput] = useState('');

  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [copied, setCopied] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  const [fx, setFx] = useState<{ key: number; who: 'me' | 'opp'; value: number } | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Guardam o estado anterior para saber o que mudou (quem pontuou, se entrou peça na mesa, se comprei)
  const scoresRef = useRef<Scores>({});
  const playedCountRef = useRef(0);
  const handCountRef = useRef(0);

  useEffect(() => {
    socket.on('waiting_for_opponent', () => setLobby({ kind: 'queue' }));

    socket.on('private_room_created', ({ roomCode }: { roomCode: string }) => {
      setCopied(false);
      setLobby({ kind: 'private', code: roomCode });
    });

    socket.on('game_started', (data: GameStartedPayload) => {
      scoresRef.current = data.scores ?? {};
      playedCountRef.current = 0;
      handCountRef.current = data.hand.length;
      setLobby(null);
      setResult(null);
      setSelectedPiece(null);
      setGameState({
        roomId: data.roomId,
        hand: data.hand,
        boneyardCount: data.boneyardCount,
        isBotGame: data.isBotGame,
        gameMode: data.gameMode,
        scores: data.scores ?? {},
        boardLeft: null,
        boardRight: null,
        playedPieces: [],
        currentTurnPlayerId: data.currentTurnPlayerId ?? socket.id ?? '',
        opponentHandCount: data.hand.length,
        myPieceIds: data.hand.map((p) => p.id),
      });
    });

    socket.on('game_updated', (data: GameUpdatedPayload) => {
      const nextScores = data.scores ?? scoresRef.current;
      let someoneScored = false;
      for (const id of Object.keys(nextScores)) {
        const delta = (nextScores[id] ?? 0) - (scoresRef.current[id] ?? 0);
        if (delta > 0) {
          someoneScored = true;
          setFx({ key: Date.now(), who: id === socket.id ? 'me' : 'opp', value: delta });
        }
      }
      scoresRef.current = nextScores;

      if (data.playedPieces.length > playedCountRef.current) playSound('clack');
      else if (data.hand && data.hand.length > handCountRef.current) playSound('draw');
      if (someoneScored) setTimeout(() => playSound('score'), 160);
      playedCountRef.current = data.playedPieces.length;
      if (data.hand) handCountRef.current = data.hand.length;

      setGameState((prev) =>
        prev
          ? {
              ...prev,
              boardLeft: data.boardLeft,
              boardRight: data.boardRight,
              playedPieces: data.playedPieces,
              boneyardCount: data.boneyardCount,
              currentTurnPlayerId: data.currentTurnPlayerId,
              scores: nextScores,
              hand: data.hand ?? prev.hand,
              myPieceIds: data.hand ? union(prev.myPieceIds, data.hand) : prev.myPieceIds,
              opponentHandCount: data.opponentHandCount ?? prev.opponentHandCount,
            }
          : null
      );
      setSelectedPiece(null);
    });

    socket.on('your_hand_updated', ({ hand }: { hand: Piece[] }) => {
      handCountRef.current = hand.length;
      setGameState((prev) => (prev ? { ...prev, hand, myPieceIds: union(prev.myPieceIds, hand) } : null));
    });

    socket.on('game_over', ({ winner, reason }: GameOverPayload) => {
      const outcome = winner === 'DRAW' ? 'draw' : winner === socket.id ? 'win' : 'lose';
      setResult({ outcome, reason });
      setTimeout(() => playSound(outcome === 'lose' ? 'lose' : 'win'), 350);
    });

    socket.on('opponent_left', ({ reason }: { reason: string }) => {
      setResult({ outcome: 'win', reason });
      playSound('win');
    });

    socket.on('error_message', ({ message }: { message: string }) => {
      setToast({ key: Date.now(), text: message });
    });

    return () => {
      socket.off('waiting_for_opponent');
      socket.off('private_room_created');
      socket.off('game_started');
      socket.off('game_updated');
      socket.off('your_hand_updated');
      socket.off('game_over');
      socket.off('opponent_left');
      socket.off('error_message');
    };
  }, []);

  const handlePlayGame = () => {
    if (opponentType === 'CPU') {
      socket.emit('start_bot_game', { gameMode: selectedMode });
    } else if (opponentType === 'PRIVATE') {
      if (roomCodeInput.trim()) {
        socket.emit('join_private_room', { roomCode: roomCodeInput });
      } else {
        socket.emit('create_private_room', { gameMode: selectedMode });
      }
    } else {
      socket.emit('join_random_game', { gameMode: selectedMode });
    }
  };

  const cancelWaiting = () => {
    socket.emit('cancel_waiting');
    setLobby(null);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setToast({ key: Date.now(), text: `Código da sala: ${code}` });
    }
  };

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const playOn = (side: Side) => {
    if (!selectedPiece || !gameState) return;
    socket.emit('play_piece', { roomId: gameState.roomId, piece: selectedPiece, side });
  };

  const backToMenu = () => {
    setResult(null);
    setSelectedPiece(null);
    setGameState(null);
  };

  let screen;

  if (!gameState && lobby) {
    // ---------- SALA DE ESPERA ----------
    screen = (
      <div className="menu-screen">
        <div className="lobby-card">
          {lobby.kind === 'queue' ? (
            <>
              <div className="spinner" />
              <h2>Procurando oponente…</h2>
              <p>Assim que alguém entrar na fila, a partida começa.</p>
            </>
          ) : (
            <>
              <p className="lobby-label">Código da sala</p>
              <div className="room-code">{lobby.code}</div>
              <button className="btn-action btn-buy" onClick={() => copyCode(lobby.code)}>
                {copied ? 'Copiado!' : 'Copiar código'}
              </button>
              <p>Passe o código para o seu amigo. A partida começa quando ele entrar.</p>
            </>
          )}
          <button className="btn-action btn-pass" onClick={cancelWaiting}>
            Cancelar
          </button>
        </div>
      </div>
    );
  } else if (!gameState) {
    // ---------- MENU ----------
    screen = (
      <div className="menu-screen">
        <div className="title-banner">
          <h1>DOMINÓ</h1>
        </div>

        <div className="menu-options">
          <div className="menu-row">
            <span className="menu-label">JOGO</span>
            <select className="menu-select" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value as GameMode)}>
              <option value="PONTA_DE_CINCO">Ponta de 5</option>
              <option value="CLASSIC">Clássico</option>
            </select>
          </div>
          <div className="menu-row">
            <span className="menu-label">OPONENTES</span>
            <select
              className="menu-select"
              value={opponentType}
              onChange={(e) => setOpponentType(e.target.value as 'CPU' | 'MULTIPLAYER' | 'PRIVATE')}
            >
              <option value="CPU">CPU</option>
              <option value="MULTIPLAYER">Fila Online</option>
              <option value="PRIVATE">Sala Privada</option>
            </select>
          </div>

          {opponentType === 'PRIVATE' && (
            <div className="menu-row">
              <span className="menu-label menu-label-small">CÓDIGO</span>
              <input
                type="text"
                className="menu-select"
                placeholder="Vazio para criar sala"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
              />
            </div>
          )}
        </div>

        <button className="btn-jogar" onClick={handlePlayGame}>JOGAR</button>
      </div>
    );
  } else {
    // ---------- JOGO ----------
    const { hand, boardLeft, boardRight, boneyardCount } = gameState;
    const isMyTurn = gameState.currentTurnPlayerId === socket.id;
    const myScore = gameState.scores[socket.id || ''] ?? 0;
    const oppId = gameState.isBotGame ? 'BOT_CPU' : Object.keys(gameState.scores).find((id) => id !== socket.id) ?? '';
    const oppScore = gameState.scores[oppId] ?? 0;
    const oppName = gameState.isBotGame ? 'CPU' : 'Oponente';
    const empty = gameState.playedPieces.length === 0;

    const canPlay = (p: Piece) => fitsSide(p, 'left', boardLeft, boardRight) || fitsSide(p, 'right', boardLeft, boardRight);
    const hasPlayable = hand.some(canPlay);
    const armed = isMyTurn && !!selectedPiece;

    screen = (
      <div className="game-screen">
        {/* Oponente */}
        <div className="opp-row">
          <PlayerBadge name={oppName} score={oppScore} active={!isMyTurn} />
          <div className="opp-hand">
            {Array.from({ length: Math.max(gameState.opponentHandCount, 0) }).map((_, i) => (
              <DominoBack key={i} />
            ))}
          </div>
        </div>

        {/* Mesa */}
        <div className="table">
          <div className="table-top">
            <span className={`turn-chip ${isMyTurn ? 'mine' : ''}`}>
              <i className="turn-dot" />
              {isMyTurn ? 'Sua vez' : `Vez de: ${oppName}…`}
            </span>
            <span className="table-meta">
              {MODE_LABEL[gameState.gameMode]} · Dorme: {boneyardCount}
            </span>
          </div>

          <Board
            playedPieces={gameState.playedPieces}
            boardLeft={boardLeft}
            boardRight={boardRight}
            canDropLeft={armed && !empty && fitsSide(selectedPiece, 'left', boardLeft, boardRight)}
            canDropRight={armed && !empty && fitsSide(selectedPiece, 'right', boardLeft, boardRight)}
            canDropFirst={armed && empty}
            emptyHint={isMyTurn ? 'Escolha uma peça para começar' : 'Aguardando a primeira jogada…'}
            myPieceIds={new Set(gameState.myPieceIds)}
            onPlay={playOn}
          />

          {fx && (
            <div key={fx.key} className={`score-fx ${fx.who}`} onAnimationEnd={() => setFx(null)}>
              +{fx.value}
            </div>
          )}
        </div>

        {/* Jogador */}
        <div className="me-row">
          <PlayerBadge name="Você" score={myScore} active={isMyTurn} />
          <div className="actions">
            <button
              className="btn-action btn-buy"
              disabled={!isMyTurn || hasPlayable || boneyardCount === 0}
              onClick={() => socket.emit('draw_piece', { roomId: gameState.roomId })}
            >
              Comprar
            </button>
            <button
              className="btn-action btn-pass"
              disabled={!isMyTurn || hasPlayable || boneyardCount > 0}
              onClick={() => socket.emit('pass_turn', { roomId: gameState.roomId })}
            >
              Passar
            </button>
          </div>
        </div>

        <div className="hand">
          {hand.map((piece, i) => {
            const playable = canPlay(piece);
            const selected = selectedPiece?.id === piece.id;
            return (
              <button
                key={piece.id}
                className={`hand-tile ${selected ? 'selected' : ''} ${isMyTurn && !playable ? 'dim' : ''}`}
                disabled={!isMyTurn || !playable}
                aria-pressed={selected}
                aria-label={`Peça ${piece.left} e ${piece.right}`}
                onClick={() => setSelectedPiece(selected ? null : piece)}
              >
                <DominoTile
                  layoutId={piece.id}
                  left={piece.left}
                  right={piece.right}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: i * 0.03 }}
                />
              </button>
            );
          })}
        </div>

        {result && (
          <div className="overlay">
            <div className={`result-card ${result.outcome}`}>
              <h2>{result.outcome === 'win' ? 'Você venceu!' : result.outcome === 'lose' ? 'Você perdeu' : 'Empate'}</h2>
              <p>{result.reason}</p>
              <div className="result-scores">
                <span>Você: <b>{myScore}</b></span>
                <span>{oppName}: <b>{oppScore}</b></span>
              </div>
              <button className="btn-jogar btn-result" onClick={backToMenu}>MENU</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      {screen}
      <SoundButton muted={muted} onToggle={toggleMute} />
      {toast && (
        <div key={toast.key} className="toast" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default App;
