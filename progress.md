Original prompt: Alors, il faudrait ajouter un nouvel historique quand on joue avec le garde de trucs qu'on a sur le côté, mais un historique de main, en gros avec qui a gagné, avec quoi. Genre paire de rois, gagné 125 000, j'en sais rien. Et que j'ai un bouton avec mes statistiques sur la session. C'est-à-dire que je puisse faire une nouvelle session et à la fin, qu'il me dise en gros combien j'ai gagné, combien j'ai perdu, combien de mains j'ai gagné, plus grosse perte, plus grosse défaite, dans combien de mains je suis entré, et cetera. Et qu'en plus, je sache aussi où est-ce que j'en suis des recaves, parce que là, ça me recave automatiquement. Alors du coup, on n'a aucune idée de combien j'ai recavé.

- Added engine-level hand summaries so each completed hand can feed a dedicated hand-history UI and session stats.
- Added a persisted-state merge path so old local storage snapshots gain the new `handSummaries` field safely.
- Wired a new hand-history view into the side rail, plus a session-stats modal and a hero-session summary block.
- Added focused tests for hand summaries, session stats, and automatic recaves.
- Verification note: could not execute Vitest in this environment because `node` is not installed (`env: node: No such file or directory`).

## Nouvelle demande - conseiller GTO et profils

- Ajouter Philippe (tres serre) et Gerard (tres loose).
- Ajouter un conseil de decision qui separe une base theorique GTO de l adaptation exploitante a la table privee.
- Point a confirmer: la table compte deja 8 joueurs sur 9 sieges; l ajout des deux profils exige une rotation ou un passage en 10-max.
- Points joueurs a confirmer: Philippe serre-passif ou serre-agressif; Gerard loose-passif ou loose-agressif.

### Avancement

- Philippe ajoute comme profil tres serre-agressif, lisible et oriente value.
- Gerard ajoute comme profil ultra loose-agressif, gros sizings et overbluff frequent.
- Table portee a 10 places avec un pool de 9 bots activables; la composition choisie est persistante.
- Ajout d un ecran Joueurs: cocher/decocher les presents applique la composition en demarrant une nouvelle session.
- Ajout des hooks `render_game_to_text` et `advanceTime` pour la validation automatisee du jeu.
- Validation intermediaire: TypeScript passe et 34 tests sur 34 passent avant integration du conseiller.

### Conseiller et validation finale

- Conseiller live integre au panneau Hero: action, mix de frequences, equite estimee, cote du pot, stack effectif, niveau de confiance et sizing conseille.
- Le sizing conseille peut etre applique directement au curseur de mise.
- Calcul deterministe sans lecture des cartes cachees, du deck moteur ni du seed; les ranges sont estimees depuis les profils et actions publiques.
- L option/straddle est traitee comme une blind vivante pour reconnaitre correctement les pots limpes et proposer un sizing adapte.
- Cas ajoute: une main faible qui manque la cote dans un gros pot multiway est davantage orientee fold; une premium sur plusieurs limpers reste orientee grosse relance.
- Le panneau rappelle qu il s agit d une estimation locale adaptee, pas d un solveur GTO professionnel exact.
- Validation finale: diff propre, lint OK, TypeScript OK, build Vite OK, 41 tests sur 41.
- Validation navigateur: table reduite a 8 joueurs, profils decoches persistants, conseil visible, sizing reporte dans le slider, aucune erreur console.
- Benchmark conseiller, pire cas flop a 9 joueurs: environ 25 ms en moyenne, p95 environ 27 ms sur cette machine.
- Suite utile: affiner les profils avec de nouvelles observations reelles de Philippe, Gerard et des joueurs inconnus.

## Refonte UX desktop et iPhone 12 Pro

- Nouvelle demande: rendre le front nettement plus agreable et lisible, avec une optimisation ciblee iPhone 12 Pro.
- Baseline mesuree a 390x844: page haute de 3032 px; panneau de decision seulement a 1412 px; table de 700 px avant les actions.
- Baseline desktop 1440x1000 sans debordement horizontal, mais table dense en 10-max et actions concurrencees par le detail GTO.
- Priorites retenues: decision Hero avant la table sur mobile, dock d actions fixe, resume compact, sieges adverses allegees, analyse GTO repliable, cibles tactiles 44 px, safe areas iOS.

### Refonte livrée et contrôlée

- Desktop réorganisé en deux zones claires : table et résumé à gauche, décision Hero puis historique à droite.
- Mobile 390x844 : décision ramenée à 133 px du haut au lieu de 1412 px; hauteur totale ramenée de 3032 px à 1990 px, sans débordement horizontal.
- Dock mobile fixe avec les quatre décisions principales, montants lisibles et action conseillée visuellement reliée au conseil GTO.
- Main du Hero, pot, stack, street, presets de mise et slider regroupés dans le premier écran; détail GTO replié par défaut.
- Table 10-max compactée pour l’iPhone 12 Pro, adversaires simplifiés, joueur actif renforcé et profils accessibles au toucher.
- Profils joueurs ouverts dans une feuille mobile pleine largeur; cible tactile mesurée à environ 47 px.
- Historique allégé, onglets accessibles et détail de la main précédente fermé par défaut.
- Fenêtres Joueurs et Stats adaptées aux safe areas iOS, avec boutons tactiles de 48 px minimum.
- Validation finale : ESLint OK, TypeScript OK, build Vite OK, 41 tests sur 41, test de jeu automatisé OK, aucune erreur console sur desktop ou iPhone 12 Pro.
- Captures finales : `output/web-game/redesign-final/` et interactions mobiles dans `output/web-game/mobile-ux-validation/`.

## Section GTO — table réelle

- Nouvelle demande : rendre le GTO beaucoup plus visible et l’isoler dans une fenêtre/section pensée pour la partie réelle.
- Ajout d’un bouton principal `GTO table réelle` dans l’en-tête de la simulation.
- Ajout d’une vue plein écran indépendante : saisie des cartes Hero, du board, de la street, du pot, du montant à payer, des stacks, de la position, des limpers, de la dernière action visible et des joueurs encore dans le coup.
- La composition de cet après-midi est préchargée : Arnaud, Jésus, Éric B, David, Philippe, Gérard, Pierre et Fabrice.
- Le résultat sépare explicitement `Repère théorique — GTO approché` et `Adaptation aux profils présents`, avec action dominante, alternative, équité estimée, cote requise, marge et comparaison des mixes.
- Le conseil reste stable pendant la lecture; modifier une donnée signale qu’il faut relancer l’analyse. `Nouvelle main` remet uniquement le coup réel à zéro sans toucher à la simulation.
- Le snapshot de calcul est isolé du store de simulation et vide systématiquement toutes les cartes adverses. Seules la main Hero, le board, les montants, les actions visibles et les profils configurés sont utilisés.
- Validation responsive : aucun débordement à 1440x1000 ou 390x844; conseil à 78 px du haut sur iPhone 12 Pro; 7 profils pris en compte; aucune carte adverse ni erreur console.
- Validation finale : ESLint OK, TypeScript OK, build Vite OK, 44 tests sur 44.
- Captures et rapport : `output/web-game/real-gto-validation/`.
