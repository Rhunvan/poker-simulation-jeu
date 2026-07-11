# Table privee cash game

Simulation locale de Texas Hold'em No-Limit pour reproduire une vraie table privee de cash game, pas une table GTO ni un bac a shoves.

## Lancer

```bash
npm install
npm run dev
```

Dev server local:

- `http://127.0.0.1:4173/` si lance avec `npm run dev -- --host 127.0.0.1 --port 4173`

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

## Calibration bots

Simulation reproductible bot-vs-bot, sans hero humain:

```bash
npm run sim:profiles -- --hands 5000 --seed 4242
```

Options utiles:

- `--hands 10000` pour un gros echantillon
- `--seed 4242` pour comparer deux calibrations
- `--json` pour exploiter le rapport en machine

Le script sort par profil:

- VPIP
- PFR
- limp%
- cold call%
- 3bet%
- 4bet%
- preflop jam au-dessus de 35bb
- cbet flop/turn/river
- fold to 3bet
- hero call tendency
- bluff frequency
- overbet frequency
- WTSD

## Structure

```text
src/
  config/
    tableRules.ts
    tablePopulation.ts
    playerProfiles.ts
    tableConfig.ts
    botProfiles.ts
    schema.ts
  engine/
    core/
    rules/
    eval/
    bots/
      populationModel.ts
      personaOverlay.ts
      emotionModel.ts
      sizingModel.ts
      decisionEngine.ts
  store/
  ui/
  tests/
scripts/
  simulateProfiles.ts
```

## Ou modifier la vraie table

### Blindes / cave / recave

Fichier principal:

- `src/config/tableRules.ts`

Champs importants:

- `smallBlind`
- `bigBlind`
- `startingStack`
- `buyInDefault`
- `rebuy.defaultAmount`
- `rebuy.maxStackFraction`
- `rebuy.availabilityRule`
- `rebuy.notes`

La recave automatique utilise le montant le plus eleve entre la cave de base et la moitie du plus gros stack present.

### Ecologie globale de la table

- `src/config/tablePopulation.ts`

Tu y modifies:

- la frequence de limp globale
- la frequence de cold call globale
- les opens 4x-8x
- les opens enormes non all-in
- la suppression des jams deep
- la curiosite showdown
- la rarete des 4-bets

### Profils joueurs

- `src/config/playerProfiles.ts`

Chaque profil contient:

- nom reel
- archetype
- resume
- fourchettes de stats cibles
- style de sizing
- regles specifiques
- biais emotionnels
- mains fetiches si besoin

## Comment changer les fourchettes de stats

Dans `src/config/playerProfiles.ts`, chaque stat est une fourchette `[min, max]`.

Exemple:

```ts
targetStats: {
  vpip: [48, 62],
  pfr: [5, 10],
  limp: [25, 40],
}
```

Le moteur ne copie pas brutalement ces chiffres. Il s en sert comme ancre de calibration pour:

- filtrer les entrees preflop
- choisir limp/call/raise
- doser les 3-bets et 4-bets
- reduire ou augmenter les bluffs
- moduler les hero calls
- controler les overbets

## Ce qui a ete refondu

- vraie config cash game privee `500/1 000`, cave `40 000`, rake `0`
- pool de population loose/passive avec gros sizings non standard
- profils nominatifs Eric B, Pierre, David, Guillaume, Bruno, Pascal 2 et Fabrice
- pipeline bot `population -> persona -> emotion -> guardrails`
- anti-jam explicite au-dessus de `35bb`
- distinction entre gros raise irrationnel et shove
- panneau profil par joueur dans l UI
- calibration offline reproductible

## TODO_MATCH_REAL_TABLE

Points encore explicitement laisses configurables:

- `favoriteHandsNotes` de Renaud
- composition exacte du roster si tu veux figer quels 8 regs sur 9 sont assis quand le hero humain est present

## Notes moteur

- la boucle de jeu reste 100% locale
- aucun backend, aucun compte, aucun paiement
- les regles poker couvertes par les tests existants sont conservees
- le hero humain n est pas un bot
