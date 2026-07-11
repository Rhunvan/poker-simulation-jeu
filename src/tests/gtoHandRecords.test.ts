import { describe, expect, it } from 'vitest'

import {
  parseCreateGtoHandRequest,
  serializeCreateGtoHandRequest,
} from '../data/gtoHandRecords'
import type { RealTableSpotInput } from '../engine/advisor/realTableAdvisor'

const spot: RealTableSpotInput = {
  heroCards: ['As', 'Kh'],
  board: ['', '', '', '', ''],
  street: 'preflop',
  position: 'button',
  pot: 3_500,
  toCall: 2_000,
  heroStack: 40_000,
  opponentStack: 52_000,
  opponentIds: ['gilles', 'gerard'],
  pressureType: 'raise',
  pressureActorId: 'gerard',
  limperCount: 1,
}

describe('contrat des mains GTO enregistrées', () => {
  it('sérialise puis valide le spot et les observations réelles', () => {
    const serialized = serializeCreateGtoHandRequest(spot, {
      actualAction: 'raise',
      actualAmount: 8_000,
      heroNet: 12_500,
      note: '  Relance payée par Gérard.  ',
    })
    const parsed = parseCreateGtoHandRequest(JSON.parse(serialized))

    expect(parsed).toEqual({
      ok: true,
      value: {
        spot,
        actualAction: 'raise',
        actualAmount: 8_000,
        heroNet: 12_500,
        note: 'Relance payée par Gérard.',
      },
    })
  })

  it('refuse une action ou un résultat hors contrat', () => {
    expect(parseCreateGtoHandRequest({ spot, actualAction: 'dance' })).toMatchObject({ ok: false })
    expect(parseCreateGtoHandRequest({ spot, actualAmount: 1.5 })).toMatchObject({ ok: false })
    expect(parseCreateGtoHandRequest({ spot, heroNet: 1_000_000_001 })).toMatchObject({ ok: false })
  })

  it('refuse une structure de cartes incomplète', () => {
    expect(
      parseCreateGtoHandRequest({
        spot: { ...spot, heroCards: ['As'] },
      }),
    ).toMatchObject({ ok: false })
  })
})
