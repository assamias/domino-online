import { useState, useEffect } from 'react';
import { socket } from './services/socket';
import './App.css';

export type GameMode = 'CLASSIC' | 'PONTA_DE_CINCO';

interface Piece {
  id: string;
  left: number;
  right: number;
}

interface PlayedPiece {
  piece: Piece;
  side: 'left' | 'right';
}

interface GameState {
  roomId: string;
  hand: Piece[];
  boneyardCount: number;
  isBotGame: boolean;
  gameMode: GameMode;
  scores: { [socketId: string]: number };
  boardLeft: number | null;
  boardRight: number | null;
  playedPieces: PlayedPiece[];
  currentTurnPlayerId: string;
}

// COMPONENTE: Pedra de Dominó Visual
const DominoPieceVisual = ({ left, right, isHorizontal = false }: { left: number, right: number, isHorizontal?: boolean }) => {
  const renderPips = (value: number) => {
    const colorClass = `pip-color-${value}`;
    const pips = [];
    
    if (value === 1) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-center`}></div>);
    } else if (value === 2) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-top-right`}></div>);
      pips.push(<div key="2" className={`pip ${colorClass} pos-bot-left`}></div>);
    } else if (value === 3) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-top-right`}></div>);
      pips.push(<div key="2" className={`pip ${colorClass} pos-center`}></div>);
      pips.push(<div key="3" className={`pip ${colorClass} pos-bot-left`}></div>);
    } else if (value === 4) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-top-left`}></div>);
      pips.push(<div key="2" className={`pip ${colorClass} pos-top-right`}></div>);
      pips.push(<div key="3" className={`pip ${colorClass} pos-bot-left`}></div>);
      pips.push(<div key="4" className={`pip ${colorClass} pos-bot-right`}></div>);
    } else if (value === 5) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-top-left`}></div>);
      pips.push(<div key="2" className={`pip ${colorClass} pos-top-right`}></div>);
      pips.push(<div key="3" className={`pip ${colorClass} pos-center`}></div>);
      pips.push(<div key="4" className={`pip ${colorClass} pos-bot-left`}></div>);
      pips.push(<div key="5" className={`pip ${colorClass} pos-bot-right`}></div>);
    } else if (value === 6) {
      pips.push(<div key="1" className={`pip ${colorClass} pos-top-left`}></div>);
      pips.push(<div key="2" className={`pip ${colorClass} pos-top-right`}></div>);
      pips.push(<div key="3" className={`pip ${colorClass} pos-mid-left`}></div>);
      pips.push(<div key="4" className={`pip ${colorClass} pos-mid-right`}></div>);
      pips.push(<div key="5" className={`pip ${colorClass} pos-bot-left`}></div>);
      pips.push(<div key="6" className={`pip ${colorClass} pos-bot-right`}></div>);
    }
    return <div className="domino-face" data-value={value}>{pips}</div>;
  };

  return (
    <div className={`domino-piece ${isHorizontal ? 'horizontal' : ''}`}>
      {renderPips(left)}
      <div className={isHorizontal ? 'domino-divider-vertical' : 'domino-divider-horizontal'}></div>
      {renderPips(right)}
    </div>
  );
};

export function App() {
  const [selectedMode, setSelectedMode] = useState<GameMode>('PONTA_DE_CINCO');
  const [opponentType, setOpponentType] = useState<'CPU' | 'MULTIPLAYER' | 'PRIVATE'>('CPU');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);

  useEffect(() => {
    socket.on('game_started', (data: any) => {
      setGameState({
        roomId: data.roomId,
        hand: data.hand,
        boneyardCount: data.boneyardCount,
        isBotGame: data.isBotGame,
        gameMode: data.gameMode,
        scores: data.scores || {},
        boardLeft: null,
        boardRight: null,
        playedPieces: [],
        currentTurnPlayerId: socket.id || ''
      });
    });

    socket.on('game_updated', (data: any) => {
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              boardLeft: data.boardLeft,
              boardRight: data.boardRight,
              playedPieces: data.playedPieces,
              boneyardCount: data.boneyardCount,
              currentTurnPlayerId: data.currentTurnPlayerId,
              scores: data.scores || prev.scores
            }
          : null
      );
      setSelectedPiece(null);
    });

    socket.on('your_hand_updated', ({ hand }: { hand: Piece[] }) => {
      setGameState((prev) => (prev ? { ...prev, hand } : null));
    });

    socket.on('game_over', ({ winner, reason }: { winner: string; reason: string }) => {
      alert(`Fim de jogo! ${reason}`);
      setGameState(null);
    });

    socket.on('error_message', ({ message }: { message: string }) => {
      alert(message);
    });

    return () => {
      socket.off('game_started');
      socket.off('game_updated');
      socket.off('your_hand_updated');
      socket.off('game_over');
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
      socket.emit('join_random_game');
    }
  };

  const handlePlayPiece = (side: 'left' | 'right') => {
    if (!selectedPiece || !gameState) return;
    socket.emit('play_piece', { roomId: gameState.roomId, piece: selectedPiece, side });
  };

  const isMyTurn = gameState?.currentTurnPlayerId === socket.id;
  const botHandCount = 7 - (gameState?.playedPieces.length ? Math.floor(gameState.playedPieces.length / 2) : 0);

  return (
    <div className="app-container">
      {!gameState ? (
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
              <select className="menu-select" value={opponentType} onChange={(e) => setOpponentType(e.target.value as any)}>
                <option value="CPU">🤖 CPU</option>
                <option value="MULTIPLAYER">⚡ Fila Online</option>
                <option value="PRIVATE">🔒 Sala Privada</option>
              </select>
            </div>
            
            {opponentType === 'PRIVATE' && (
              <div className="menu-row" style={{ marginTop: '10px' }}>
                <span className="menu-label" style={{ fontSize: '0.8rem' }}>CÓDIGO (Opcional)</span>
                <input 
                  type="text" 
                  className="menu-select" 
                  placeholder="Deixar vazio para Criar"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                />
              </div>
            )}
          </div>

          <button className="btn-jogar" onClick={handlePlayGame}>JOGAR</button>
        </div>
      ) : (
        <div className="game-screen">
          {/* TOP HUD (Oponente) */}
          <div className="hud-bar">
             <div className="player-info">
                <span className="player-score">{gameState.scores['BOT_CPU'] || gameState.scores[Object.keys(gameState.scores).find(id => id !== socket.id) || ''] || 0}</span>
                <span className="score-label">PONTOS</span>
             </div>
             <div className="hand-container">
               {Array.from({ length: Math.max(botHandCount, 0) }).map((_, i) => (
                 <div key={i} className="domino-back"></div>
               ))}
             </div>
          </div>

          {/* TABULEIRO CENTRAL */}
          <div className="board">
            {gameState.playedPieces.length === 0 ? (
               <h2 style={{ color: 'rgba(255,255,255,0.5)' }}>Faz a tua jogada</h2>
            ) : (
               gameState.playedPieces.map((item, idx) => (
                 <DominoPieceVisual key={idx} left={item.piece.left} right={item.piece.right} isHorizontal={item.piece.left !== item.piece.right} />
               ))
            )}
          </div>

          {/* AÇÕES (Jogar Esq/Dir) */}
          {selectedPiece && isMyTurn && (
             <div className="action-buttons">
                <button className="btn-action" onClick={() => handlePlayPiece('left')}>⬅️ Esquerda</button>
                <button className="btn-action" onClick={() => handlePlayPiece('right')}>Direita ➡️</button>
             </div>
          )}

          {/* COMPRAR / PASSAR */}
          {!selectedPiece && isMyTurn && (
            <div className="action-buttons">
              <button className="btn-action" style={{ backgroundColor: '#23558d' }} onClick={() => socket.emit('draw_piece', { roomId: gameState.roomId })}>🃏 Comprar (Dorme: {gameState.boneyardCount})</button>
              <button className="btn-action" style={{ backgroundColor: '#e24f33' }} onClick={() => socket.emit('pass_turn', { roomId: gameState.roomId })}>🛑 Passar a Vez</button>
            </div>
          )}

          {/* BOTTOM HUD (Jogador) */}
          <div className="hud-bar" style={{ marginTop: '15px' }}>
             <div className="hand-container">
               {gameState.hand.map((piece) => (
                 <button 
                    key={piece.id} 
                    className={`domino-wrapper ${selectedPiece?.id === piece.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPiece(piece)}
                 >
                   <DominoPieceVisual left={piece.left} right={piece.right} />
                 </button>
               ))}
             </div>
             <div className="player-info" style={{ borderColor: isMyTurn ? '#3ca936' : 'transparent', borderWidth: '2px', borderStyle: 'solid' }}>
                <span className="player-score">{gameState.scores[socket.id || ''] || 0}</span>
                <span className="score-label">PONTOS</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;