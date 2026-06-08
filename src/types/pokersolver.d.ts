declare module 'pokersolver' {
  export interface SolvedCard {
    toString(): string
  }

  export interface SolvedHand {
    name: string
    descr: string
    rank: number
    cards: SolvedCard[]
  }

  export const Hand: {
    solve(cards: string[]): SolvedHand
    winners(hands: SolvedHand[]): SolvedHand[]
  }

  const pokersolver: {
    Hand: typeof Hand
  }

  export default pokersolver
}
