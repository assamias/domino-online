export type GameMode = 'CLASSIC' | 'PONTA_DE_CINCO';

export interface Piece {
  id: string;
  left: number;
  right: number;
}

export interface PlayMove {
  piece: Piece;
  side: 'left' | 'right';
  rotatedPiece: Piece;
}

export interface MoveValidation {
  valid: boolean;
  rotatedPiece?: Piece;
  newBoardLeft?: number;
  newBoardRight?: number;
}

export interface PlayedPiece {
  piece: Piece;
  side: 'left' | 'right';
}

export class DominoEngine {
  static generateDeck(): Piece[] {
    const deck: Piece[] = [];
    for (let i = 0; i <= 6; i++) {
      for (let j = i; j <= 6; j++) {
        deck.push({ id: `${i}-${j}`, left: i, right: j });
      }
    }
    return deck;
  }

  static shuffle(deck: Piece[]): Piece[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static deal(shuffledDeck: Piece[], playerCount: number = 2) {
    const playerHands: Piece[][] = Array.from({ length: playerCount }, () => []);
    const remainingDeck = [...shuffledDeck];

    for (let i = 0; i < 7; i++) {
      for (let p = 0; p < playerCount; p++) {
        const piece = remainingDeck.pop();
        if (piece) playerHands[p].push(piece);
      }
    }

    return { hands: playerHands, boneyard: remainingDeck };
  }

  static validateMove(
    piece: Piece,
    side: 'left' | 'right',
    boardLeft: number | null,
    boardRight: number | null
  ): MoveValidation {
    if (boardLeft === null || boardRight === null) {
      return {
        valid: true,
        rotatedPiece: piece,
        newBoardLeft: piece.left,
        newBoardRight: piece.right
      };
    }

    if (side === 'left') {
      if (piece.right === boardLeft) {
        return {
          valid: true,
          rotatedPiece: piece,
          newBoardLeft: piece.left,
          newBoardRight: boardRight
        };
      }
      if (piece.left === boardLeft) {
        return {
          valid: true,
          rotatedPiece: { ...piece, left: piece.right, right: piece.left },
          newBoardLeft: piece.right,
          newBoardRight: boardRight
        };
      }
    } else if (side === 'right') {
      if (piece.left === boardRight) {
        return {
          valid: true,
          rotatedPiece: piece,
          newBoardLeft: boardLeft,
          newBoardRight: piece.right
        };
      }
      if (piece.right === boardRight) {
        return {
          valid: true,
          rotatedPiece: { ...piece, left: piece.right, right: piece.left },
          newBoardLeft: boardLeft,
          newBoardRight: piece.left
        };
      }
    }

    return { valid: false };
  }

  static getValidMoves(
    hand: Piece[],
    boardLeft: number | null,
    boardRight: number | null
  ): PlayMove[] {
    const validMoves: PlayMove[] = [];

    if (boardLeft === null || boardRight === null) {
      if (hand.length > 0) {
        validMoves.push({ piece: hand[0], side: 'left', rotatedPiece: hand[0] });
      }
      return validMoves;
    }

    for (const piece of hand) {
      const leftCheck = this.validateMove(piece, 'left', boardLeft, boardRight);
      if (leftCheck.valid && leftCheck.rotatedPiece) {
        validMoves.push({ piece, side: 'left', rotatedPiece: leftCheck.rotatedPiece });
      }

      const rightCheck = this.validateMove(piece, 'right', boardLeft, boardRight);
      if (rightCheck.valid && rightCheck.rotatedPiece) {
        validMoves.push({ piece, side: 'right', rotatedPiece: rightCheck.rotatedPiece });
      }
    }

    return validMoves;
  }

  static findBotMove(
    hand: Piece[],
    boardLeft: number | null,
    boardRight: number | null
  ): PlayMove | null {
    const validMoves = this.getValidMoves(hand, boardLeft, boardRight);
    if (validMoves.length === 0) return null;

    validMoves.sort((a, b) => (b.piece.left + b.piece.right) - (a.piece.left + a.piece.right));
    return validMoves[0];
  }

  // CÁLCULO DE PONTOS PARA A REGRA PONTA DE 5 (ALL FIVES)
  static calculatePontaDeCincoPoints(
    playedPieces: PlayedPiece[],
    boardLeft: number | null,
    boardRight: number | null
  ): number {
    if (boardLeft === null || boardRight === null || playedPieces.length === 0) return 0;

    // Se houver apenas 1 peça na mesa
    if (playedPieces.length === 1) {
      const p = playedPieces[0].piece;
      const sum = p.left + p.right;
      return sum % 5 === 0 ? sum : 0;
    }

    // Encontra as peças das extremidades
    const leftPieces = playedPieces.filter(p => p.side === 'left');
    const rightPieces = playedPieces.filter(p => p.side === 'right');

    const leftEndPiece = leftPieces.length > 0 ? leftPieces[leftPieces.length - 1].piece : playedPieces[0].piece;
    const rightEndPiece = rightPieces.length > 0 ? rightPieces[rightPieces.length - 1].piece : playedPieces[0].piece;

    // Buchas (duplas) na ponta contam com valor duplo na soma
    const leftContribution = (leftEndPiece.left === leftEndPiece.right) ? (boardLeft * 2) : boardLeft;
    const rightContribution = (rightEndPiece.left === rightEndPiece.right) ? (boardRight * 2) : boardRight;

    const totalSum = leftContribution + rightContribution;

    return totalSum % 5 === 0 ? totalSum : 0;
  }

  static calculateHandPoints(hand: Piece[]): number {
    return hand.reduce((sum, piece) => sum + piece.left + piece.right, 0);
  }
}