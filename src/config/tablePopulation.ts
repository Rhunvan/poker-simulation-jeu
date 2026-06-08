import type { TablePopulation } from './schema'

export const REAL_TABLE_POPULATION: TablePopulation = {
  description:
    'home game loose/passif avec quelques profils agressifs, sizings parfois enormes, beaucoup d erreurs humaines',
  averageLimpRate: 'high',
  averageColdCallRate: 'high',
  averageOpenSizeBb: [4, 5, 6, 7, 8],
  rareOversizeOpenBb: [10, 12, 15, 20, 30, 35],
  threeBetEnvironment: 'low_to_medium_unbalanced',
  fourBetEnvironment: 'rare',
  preflopJamSuppressionAboveBb: 35,
  riverBluffPopulation: 'low',
  showdownCuriosityPopulation: 'elevated',
  stickyPlayersExist: true,
  scaredMoneyPlayersExist: true,
  irrationalAggroPlayersExist: true,
  limpCallCulture: 'normalized',
  oversizedNonJamRaisesPreferred: true,
  curiosityCombos: ['A4', 'K4', 'J3'],
}
