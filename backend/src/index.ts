import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { DominoEngine, Piece, GameMode } from './game/DominoEngine';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor rodando com suporte a Ponta de 5!' });
});

interface Room {
  id: string;
  players: string[];
  isPrivate: boolean;
  isBotGame: boolean;
  gameMode: GameMode;
  scores: { [socketId: string]: number };
  boneyard: Piece[];
  hands: { [socketId: string]: Piece[] };
  boardLeft: number | null;
  boardRight: number | null;
  playedPieces: { piece: Piece; side: 'left' | 'right' }[];
  currentTurn: number;
  passesCount: number;
}

const rooms: Map<string, Room> = new Map();

function startGame(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const fullDeck = DominoEngine.generateDeck();
  const shuffled = DominoEngine.shuffle(fullDeck);
  const { hands, boneyard } = DominoEngine.deal(shuffled, room.players.length);

  room.boneyard = boneyard;
  room.hands = {};
  room.scores = {};
  
  room.players.forEach((playerId, index) => {
    room.hands[playerId] = hands[index];
    room.scores[playerId] = 0;
  });

  room.boardLeft = null;
  room.boardRight = null;
  room.playedPieces = [];
  room.currentTurn = 0;
  room.passesCount = 0;

  io.to(room.players[0]).emit('game_started', {
    roomId: room.id,
    playerIndex: 0,
    hand: room.hands[room.players[0]],
    boneyardCount: boneyard.length,
    opponentId: room.players[1],
    isBotGame: room.isBotGame,
    gameMode: room.gameMode,
    scores: room.scores
  });

  if (!room.isBotGame && room.players[1]) {
    io.to(room.players[1]).emit('game_started', {
      roomId: room.id,
      playerIndex: 1,
      hand: room.hands[room.players[1]],
      boneyardCount: boneyard.length,
      opponentId: room.players[0],
      isBotGame: false,
      gameMode: room.gameMode,
      scores: room.scores
    });
  }

  console.log(`[Game] Partida iniciada na sala ${room.id} - Modo: ${room.gameMode}`);
}

function handleBotTurn(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.isBotGame) return;

  setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.players[currentRoom.currentTurn] !== 'BOT_CPU') return;

    const botHand = currentRoom.hands['BOT_CPU'] || [];
    let botMove = DominoEngine.findBotMove(botHand, currentRoom.boardLeft, currentRoom.boardRight);

    while (!botMove && currentRoom.boneyard.length > 0) {
      const drawnPiece = currentRoom.boneyard.pop();
      if (drawnPiece) {
        botHand.push(drawnPiece);
        botMove = DominoEngine.findBotMove(botHand, currentRoom.boardLeft, currentRoom.boardRight);
      }
    }

    if (botMove) {
      const validation = DominoEngine.validateMove(
        botMove.piece,
        botMove.side,
        currentRoom.boardLeft,
        currentRoom.boardRight
      );

      if (validation.valid && validation.rotatedPiece) {
        currentRoom.boardLeft = validation.newBoardLeft!;
        currentRoom.boardRight = validation.newBoardRight!;
        currentRoom.playedPieces.push({ piece: validation.rotatedPiece, side: botMove.side });
        currentRoom.hands['BOT_CPU'] = botHand.filter(p => p.id !== botMove!.piece.id);
        currentRoom.passesCount = 0;

        // Se for Ponta de 5, verifica se a CPU pontuou
        if (currentRoom.gameMode === 'PONTA_DE_CINCO') {
          const pointsScored = DominoEngine.calculatePontaDeCincoPoints(
            currentRoom.playedPieces,
            currentRoom.boardLeft,
            currentRoom.boardRight
          );
          if (pointsScored > 0) {
            currentRoom.scores['BOT_CPU'] = (currentRoom.scores['BOT_CPU'] || 0) + pointsScored;
          }
        }

        if (currentRoom.hands['BOT_CPU'].length === 0) {
          io.to(currentRoom.id).emit('game_over', {
            winner: 'BOT_CPU',
            reason: 'A CPU bateu e venceu!',
            scores: currentRoom.scores
          });
          rooms.delete(roomId);
          return;
        }
      }
    } else {
      currentRoom.passesCount++;
      if (currentRoom.passesCount >= 2) {
        checkBlockedGameWinner(currentRoom);
        return;
      }
    }

    currentRoom.currentTurn = 0;

    io.to(currentRoom.id).emit('game_updated', {
      boardLeft: currentRoom.boardLeft,
      boardRight: currentRoom.boardRight,
      playedPieces: currentRoom.playedPieces,
      boneyardCount: currentRoom.boneyard.length,
      currentTurnPlayerId: currentRoom.players[0],
      opponentHandCount: currentRoom.hands['BOT_CPU'].length,
      scores: currentRoom.scores
    });
  }, 1200);
}

function checkBlockedGameWinner(room: Room) {
  const p1Hand = room.hands[room.players[0]] || [];
  const p2Hand = room.hands[room.players[1]] || [];

  const p1Points = DominoEngine.calculateHandPoints(p1Hand);
  const p2Points = DominoEngine.calculateHandPoints(p2Hand);

  let winner = 'DRAW';
  let reason = `Jogo trancado! P1: ${p1Points} pts em mão vs P2: ${p2Points} pts em mão.`;

  if (p1Points < p2Points) {
    winner = room.players[0];
    reason += ` Vitória por menor soma de peças!`;
  } else if (p2Points < p1Points) {
    winner = room.players[1];
    reason += ` Vitória por menor soma de peças!`;
  }

  io.to(room.id).emit('game_over', { winner, reason, scores: room.scores });
  rooms.delete(room.id);
}

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

// 1. Criar Sala Privada
socket.on('create_private_room', (data?: { gameMode?: GameMode }) => {
  const gameMode = data?.gameMode || 'CLASSIC';
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room: Room = {
    id: roomCode,
    players: [socket.id],
    isPrivate: true,
    isBotGame: false,
    gameMode,
    scores: {},
    boneyard: [],
    hands: {},
    boardLeft: null,
    boardRight: null,
    playedPieces: [],
    currentTurn: 0,
    passesCount: 0
  };

  rooms.set(roomCode, room);
  socket.join(roomCode);
  socket.emit('private_room_created', { roomCode, gameMode });
});

// 2. Modo CPU (Bot)
socket.on('start_bot_game', (data?: { gameMode?: GameMode }) => {
  const gameMode = data?.gameMode || 'CLASSIC';
  const roomId = `bot_${Date.now()}`;
  const room: Room = {
    id: roomId,
    players: [socket.id, 'BOT_CPU'],
    isPrivate: false,
    isBotGame: true,
    gameMode,
    scores: {},
    boneyard: [],
    hands: {},
    boardLeft: null,
    boardRight: null,
    playedPieces: [],
    currentTurn: 0,
    passesCount: 0
  };

  rooms.set(roomId, room);
  socket.join(roomId);
  startGame(roomId);
});

  // Jogar Peça na Mesa
  socket.on('play_piece', ({ roomId, piece, side }: { roomId: string; piece: Piece; side: 'left' | 'right' }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.players[room.currentTurn] !== socket.id) {
      return socket.emit('error_message', { message: 'Não é a sua vez!' });
    }

    const validation = DominoEngine.validateMove(piece, side, room.boardLeft, room.boardRight);
    if (!validation.valid || !validation.rotatedPiece) {
      return socket.emit('error_message', { message: 'Jogada inválida!' });
    }

    room.boardLeft = validation.newBoardLeft!;
    room.boardRight = validation.newBoardRight!;
    room.playedPieces.push({ piece: validation.rotatedPiece, side });
    room.hands[socket.id] = room.hands[socket.id].filter(p => p.id !== piece.id);
    room.passesCount = 0;

    // Cálculo da Regra Ponta de 5
    if (room.gameMode === 'PONTA_DE_CINCO') {
      const pointsScored = DominoEngine.calculatePontaDeCincoPoints(
        room.playedPieces,
        room.boardLeft,
        room.boardRight
      );
      if (pointsScored > 0) {
        room.scores[socket.id] = (room.scores[socket.id] || 0) + pointsScored;
        io.to(room.id).emit('points_scored', { playerId: socket.id, points: pointsScored, total: room.scores[socket.id] });
      }
    }

    if (room.hands[socket.id].length === 0) {
      io.to(room.id).emit('game_over', { winner: socket.id, reason: 'Você bateu e venceu!', scores: room.scores });
      rooms.delete(roomId);
      return;
    }

    room.currentTurn = room.currentTurn === 0 ? 1 : 0;
    const nextPlayerId = room.players[room.currentTurn];

    io.to(room.id).emit('game_updated', {
      boardLeft: room.boardLeft,
      boardRight: room.boardRight,
      playedPieces: room.playedPieces,
      boneyardCount: room.boneyard.length,
      currentTurnPlayerId: nextPlayerId,
      scores: room.scores
    });

    socket.emit('your_hand_updated', { hand: room.hands[socket.id] });

    if (room.isBotGame && nextPlayerId === 'BOT_CPU') {
      handleBotTurn(roomId);
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        rooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));