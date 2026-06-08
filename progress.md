Original prompt: Alors, il faudrait ajouter un nouvel historique quand on joue avec le garde de trucs qu'on a sur le côté, mais un historique de main, en gros avec qui a gagné, avec quoi. Genre paire de rois, gagné 125 000, j'en sais rien. Et que j'ai un bouton avec mes statistiques sur la session. C'est-à-dire que je puisse faire une nouvelle session et à la fin, qu'il me dise en gros combien j'ai gagné, combien j'ai perdu, combien de mains j'ai gagné, plus grosse perte, plus grosse défaite, dans combien de mains je suis entré, et cetera. Et qu'en plus, je sache aussi où est-ce que j'en suis des recaves, parce que là, ça me recave automatiquement. Alors du coup, on n'a aucune idée de combien j'ai recavé.

- Added engine-level hand summaries so each completed hand can feed a dedicated hand-history UI and session stats.
- Added a persisted-state merge path so old local storage snapshots gain the new `handSummaries` field safely.
- Wired a new hand-history view into the side rail, plus a session-stats modal and a hero-session summary block.
- Added focused tests for hand summaries, session stats, and automatic recaves.
- Verification note: could not execute Vitest in this environment because `node` is not installed (`env: node: No such file or directory`).
