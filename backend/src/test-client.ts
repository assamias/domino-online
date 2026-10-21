import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';

console.log('⚡ Testando Pontuação Automática no Modo Ponta de 5...');

const socket = io(URL);

socket.on('connect', () => {
  console.log(`✅ Conectado ao servidor! ID: ${socket.id}`);
  console.log('🤖 Iniciando jogo contra a CPU no modo PONTA_DE_CINCO...');
  socket.emit('start_bot_game', { gameMode: 'PONTA_DE_CINCO' });
});

socket.on('game_started', (data) => {
  console.log('\n🎮 Partida Iniciada!');
  console.log(`- ID da Sala: ${data.roomId}`);
  console.log(`- Modo de Jogo: ${data.gameMode}`);
  console.log(`- Placar Inicial:`, data.scores);
  console.log(`- Suas Peças:`, data.hand);

  // Faz a jogada da primeira peça da mão
  if (data.hand.length > 0) {
    const firstPiece = data.hand[0];
    const sum = firstPiece.left + firstPiece.right;
    console.log(`\n🎯 Jogando peça inicial: [${firstPiece.left} | ${firstPiece.right}] (Soma: ${sum})`);
    
    if (sum % 5 === 0 && sum > 0) {
      console.log(`💡 Esta peça deve somar ${sum} pontos no placar!`);
    } else {
      console.log(`ℹ️ Esta peça não é múltiplo de 5. Aguardando próximas jogadas...`);
    }

    socket.emit('play_piece', {
      roomId: data.roomId,
      piece: firstPiece,
      side: 'left'
    });
  }
});

// Evento disparado quando um jogador marca pontos de múltiplo de 5
socket.on('points_scored', (data) => {
  console.log(`\n🎉 PONTUAÇÃO DETECTADA!`);
  console.log(`- Jogador / Bot ID: ${data.playerId}`);
  console.log(`- Pontos marcados na jogada: +${data.points}`);
  console.log(`- Pontuação total acumulada: ${data.total} pts`);
});

// Atualização de mesa e placar geral
socket.on('game_updated', (data) => {
  console.log('\n🔄 Mesa Atualizada:');
  console.log(`- Ponta Esquerda: ${data.boardLeft} | Ponta Direita: ${data.boardRight}`);
  console.log(`- Placar Atual:`, data.scores);
});

socket.on('error_message', (err) => {
  console.error('❌ Erro recebido do servidor:', err.message);
});

// Encerra o teste após 4 segundos
setTimeout(() => {
  console.log('\n✨ Teste de pontuação concluído com sucesso!');
  socket.disconnect();
  process.exit(0);
}, 4000);