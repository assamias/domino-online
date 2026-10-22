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

const BOT_ID = 'BOT_CPU';

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

// Fila do "Fila Online": quem está esperando um oponente aleatório (por modo de jogo)
const queue: { socketId: string; gameMode: GameMode }[] = [];

function newRoom(id: string, players: string[], gameMode: GameMode, opts: { isPrivate: boolean; isBotGame: boolean }): Room {
  return {
    id,
    players,
    isPrivate: opts.isPrivate,
    isBotGame: opts.isBotGame,
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
}

const humansOf = (room: Room) => room.players.filter((p) => p !== BOT_ID);
const opponentOf = (room: Room, playerId: string) => room.players.find((p) => p !== playerId) as string;

function removeFromQueue(socketId: string) {
  const i = queue.findIndex((q) => q.socketId === socketId);
  if (i >= 0) queue.splice(i, 1);
}

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

  room.players.forEach((playerId, index) => {
    if (playerId === BOT_ID) return;
    io.to(playerId).emit('game_started', {
      roomId: room.id,
      playerIndex: index,
      hand: room.hands[playerId],
      boneyardCount: boneyard.length,
      opponentId: opponentOf(room, playerId),
      isBotGame: room.isBotGame,
      gameMode: room.gameMode,
      scores: room.scores,
      currentTurnPlayerId: room.players[room.currentTurn]
    });
  });

  console.log(`[Game] Partida iniciada na sala ${room.id} - Modo: ${room.gameMode}`);
}

// Manda o estado atual para cada jogador humano. Cada um recebe a própria mão
// (junto com o estado da mesa, para o cliente atualizar tudo de uma vez)
// e a quantidade de peças do oponente.
function broadcastUpdate(room: Room) {
  const nextPlayerId = room.players[room.currentTurn];
  for (const playerId of humansOf(room)) {
    io.to(playerId).emit('game_updated', {
      boardLeft: room.boardLeft,
      boardRight: room.boardRight,
      playedPieces: room.playedPieces,
      boneyardCount: room.boneyard.length,
      currentTurnPlayerId: nextPlayerId,
      scores: room.scores,
      hand: room.hands[playerId],
      opponentHandCount: room.hands[opponentOf(room, playerId)]?.length ?? 0
    });
  }
}

// Fim de jogo: cada jogador recebe a mensagem do ponto de vista dele.
function endGame(room: Room, winner: string, reasonFor: (playerId: string) => string) {
  for (const playerId of humansOf(room)) {
    io.to(playerId).emit('game_over', { winner, reason: reasonFor(playerId), scores: room.scores });
  }
  rooms.delete(room.id);
}

function endGameByEmptyHand(room: Room, winnerId: string) {
  endGame(room, winnerId, (pid) => {
    if (pid === winnerId) return 'Você bateu e venceu!';
    return room.isBotGame ? 'A CPU bateu e venceu!' : 'O oponente bateu e venceu!';
  });
}

function checkBlockedGameWinner(room: Room) {
  const p1 = room.players[0];
  const p2 = room.players[1];
  const p1Points = DominoEngine.calculateHandPoints(room.hands[p1] || []);
  const p2Points = DominoEngine.calculateHandPoints(room.hands[p2] || []);

  let winner = 'DRAW';
  if (p1Points < p2Points) winner = p1;
  else if (p2Points < p1Points) winner = p2;

  const pointsOf = (pid: string) => (pid === p1 ? p1Points : p2Points);

  endGame(room, winner, (pid) => {
    const mine = pointsOf(pid);
    const theirs = pointsOf(opponentOf(room, pid));
    let text = `Jogo trancado! Você: ${mine} pts na mão vs ${room.isBotGame ? 'CPU' : 'Oponente'}: ${theirs}.`;
    if (winner !== 'DRAW') text += ' Vitória por menor soma de peças!';
    return text;
  });
}

function handleBotTurn(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.isBotGame) return;

  setTimeout(() => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.players[currentRoom.currentTurn] !== BOT_ID) return;

    const botHand = currentRoom.hands[BOT_ID] || [];
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
        currentRoom.hands[BOT_ID] = botHand.filter((p) => p.id !== botMove!.piece.id);
        currentRoom.passesCount = 0;

        if (currentRoom.gameMode === 'PONTA_DE_CINCO') {
          const pointsScored = DominoEngine.calculatePontaDeCincoPoints(
            currentRoom.playedPieces,
            currentRoom.boardLeft,
            currentRoom.boardRight
          );
          if (pointsScored > 0) {
            currentRoom.scores[BOT_ID] = (currentRoom.scores[BOT_ID] || 0) + pointsScored;
          }
        }

        if (currentRoom.hands[BOT_ID].length === 0) {
          broadcastUpdate(currentRoom); // mostra a última peça na mesa antes do fim
          endGameByEmptyHand(currentRoom, BOT_ID);
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
    broadcastUpdate(currentRoom);
  }, 1200);
}

// Valida "é a vez de quem pediu?" e devolve a sala; responde com erro e devolve null se não for.
function getRoomForTurn(socketId: string, roomId: string): Room | null {
  const room = rooms.get(roomId);
  if (!room || !room.players.includes(socketId)) return null;
  if (room.players[room.currentTurn] !== socketId) {
    io.to(socketId).emit('error_message', { message: 'Não é a sua vez!' });
    return null;
  }
  return room;
}

function passTurnTo(room: Room) {
  room.currentTurn = room.currentTurn === 0 ? 1 : 0;
  broadcastUpdate(room);
  if (room.isBotGame && room.players[room.currentTurn] === BOT_ID) {
    handleBotTurn(room.id);
  }
}

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  // 1. Criar Sala Privada
  socket.on('create_private_room', (data?: { gameMode?: GameMode }) => {
    removeFromQueue(socket.id);
    const gameMode = data?.gameMode || 'CLASSIC';
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = newRoom(roomCode, [socket.id], gameMode, { isPrivate: true, isBotGame: false });

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('private_room_created', { roomCode, gameMode });
  });

  // 1b. Entrar numa sala privada pelo código
  socket.on('join_private_room', (data?: { roomCode?: string }) => {
    const code = (data?.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room || !room.isPrivate || room.players.length !== 1 || room.players[0] === socket.id) {
      return socket.emit('error_message', { message: 'Sala não encontrada ou já cheia.' });
    }

    removeFromQueue(socket.id);
    room.players.push(socket.id);
    socket.join(room.id);
    startGame(room.id);
  });

  // 2. Modo CPU (Bot)
  socket.on('start_bot_game', (data?: { gameMode?: GameMode }) => {
    removeFromQueue(socket.id);
    const gameMode = data?.gameMode || 'CLASSIC';
    const roomId = `bot_${Date.now()}`;
    const room = newRoom(roomId, [socket.id, BOT_ID], gameMode, { isPrivate: false, isBotGame: true });

    rooms.set(roomId, room);
    socket.join(roomId);
    startGame(roomId);
  });

  // 3. Fila online (oponente aleatório)
  socket.on('join_random_game', (data?: { gameMode?: GameMode }) => {
    const gameMode = data?.gameMode || 'CLASSIC';
    removeFromQueue(socket.id);

    const waiting = queue.find((q) => q.gameMode === gameMode && q.socketId !== socket.id);
    if (!waiting) {
      queue.push({ socketId: socket.id, gameMode });
      return socket.emit('waiting_for_opponent', { gameMode });
    }

    removeFromQueue(waiting.socketId);
    const roomId = `rnd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const room = newRoom(roomId, [waiting.socketId, socket.id], gameMode, { isPrivate: false, isBotGame: false });
    rooms.set(roomId, room);
    io.sockets.sockets.get(waiting.socketId)?.join(roomId);
    socket.join(roomId);
    startGame(roomId);
  });

  // Cancelar a espera (fila ou sala privada que ainda não começou)
  socket.on('cancel_waiting', () => {
    removeFromQueue(socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.isPrivate && room.players.length === 1 && room.players[0] === socket.id) {
        rooms.delete(roomId);
      }
    }
  });

  // Jogar Peça na Mesa
  socket.on('play_piece', ({ roomId, piece, side }: { roomId: string; piece: Piece; side: 'left' | 'right' }) => {
    const room = getRoomForTurn(socket.id, roomId);
    if (!room) return;

    // Usa a peça que está de fato na mão do jogador (o cliente não é confiável)
    const owned = (room.hands[socket.id] || []).find((p) => p.id === piece?.id);
    if (!owned) {
      return socket.emit('error_message', { message: 'Você não tem essa peça!' });
    }

    const validation = DominoEngine.validateMove(owned, side, room.boardLeft, room.boardRight);
    if (!validation.valid || !validation.rotatedPiece) {
      return socket.emit('error_message', { message: 'Jogada inválida!' });
    }

    room.boardLeft = validation.newBoardLeft!;
    room.boardRight = validation.newBoardRight!;
    room.playedPieces.push({ piece: validation.rotatedPiece, side });
    room.hands[socket.id] = room.hands[socket.id].filter((p) => p.id !== owned.id);
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
      broadcastUpdate(room); // mostra a última peça na mesa antes do fim
      endGameByEmptyHand(room, socket.id);
      return;
    }

    passTurnTo(room);
  });

  // Comprar do dorme: só é permitido sem nenhuma jogada possível. A vez continua sua.
  socket.on('draw_piece', ({ roomId }: { roomId: string }) => {
    const room = getRoomForTurn(socket.id, roomId);
    if (!room) return;

    const hand = room.hands[socket.id] || [];
    if (DominoEngine.getValidMoves(hand, room.boardLeft, room.boardRight).length > 0) {
      return socket.emit('error_message', { message: 'Você tem peça para jogar!' });
    }

    const drawn = room.boneyard.pop();
    if (!drawn) {
      return socket.emit('error_message', { message: 'O dorme está vazio. Passe a vez.' });
    }

    hand.push(drawn);
    room.hands[socket.id] = hand;
    broadcastUpdate(room);
  });

  // Passar a vez: só é permitido sem jogada possível E com o dorme vazio.
  socket.on('pass_turn', ({ roomId }: { roomId: string }) => {
    const room = getRoomForTurn(socket.id, roomId);
    if (!room) return;

    const hand = room.hands[socket.id] || [];
    if (DominoEngine.getValidMoves(hand, room.boardLeft, room.boardRight).length > 0) {
      return socket.emit('error_message', { message: 'Você tem peça para jogar!' });
    }
    if (room.boneyard.length > 0) {
      return socket.emit('error_message', { message: 'Ainda há peças no dorme: compre uma.' });
    }

    room.passesCount++;
    if (room.passesCount >= 2) {
      return checkBlockedGameWinner(room);
    }
    passTurnTo(room);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        for (const other of humansOf(room)) {
          if (other !== socket.id) io.to(other).emit('opponent_left', { reason: 'O oponente saiu da partida.' });
        }
        rooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
