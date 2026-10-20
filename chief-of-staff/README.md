# Chief of staff (version locale, Claude Code)

> Il existe aussi une version **serveur** du chief of staff, utilisable depuis tous vos clients et distillée chaque nuit : voir [docs/advisors.md](../docs/advisors.md). Cette version locale reste utile si vous codez : elle lit en plus vos dépôts git et vos sessions Claude Code, et versionne ses états dans un repo. Les deux peuvent coexister.

Un rôle pour Claude Code qui suit vos projets parallèles à votre place : ce qui avance, ce qui attend une décision de vous, où les choses sont rangées, et ce dont vous vous éloignez. Il s'appuie sur votre Open Brain comme mémoire partagée.

Il ne vous demande rien. C'est sa règle de conception : un outil qui exige une tenue à jour manuelle finit abandonné. Il déduit l'état de vos projets de ce qui existe déjà.

## Trois pièces

1. **Un espace de travail** `~/chief-of-staff/` avec un `CLAUDE.md` qui définit le rôle, un `config.md` que vous remplissez une fois (vos projets, votre langue), et les prompts.
2. **Une synchronisation horaire**, armée au début de chaque session : elle balaie vos sources et n'écrit un état compact dans Open Brain que si quelque chose a changé.
3. **Un hook SessionEnd**, optionnel : si vous utilisez Claude Code pour travailler, chaque session fermée est notée dans une file que la synchronisation draine.

Vous obtenez, sur demande, un **état des lieux** structuré : par projet, où il en est, sa dernière activité datée, ce qu'il attend ; puis ce qui est bloqué sur vous, et les chantiers stratégiques qui ne bougent plus. Comme il est écrit dans Open Brain, il est aussi lisible depuis l'app Claude mobile : « où en sont mes projets ? ».

## Deux façons de s'en servir

**Avec des dépôts** (vous codez) : les projets de `config.md` ont un dossier versionné, le hook est installé. Sources : git, sessions Claude Code, Open Brain.

**Sans dépôts** (vous dirigez, vous écrivez, vous décidez) : aucun dossier, pas de hook. La seule source est Open Brain, c'est-à-dire vos conversations Claude et ChatGPT capturées par l'extension, et ce que vous dictez à l'app Claude. Pour qu'une idée soit reprise à coup sûr, commencez-la par « note pour le chief of staff : ». Ce mode n'est pas dégradé, c'est le canal le plus propre.

## Installation

Prérequis : le kit installé et le connecteur Open Brain branché dans Claude Code (`docs/connect-clients.md`), `jq` (`brew install jq`).

```bash
chief-of-staff/install.sh              # avec le hook SessionEnd
chief-of-staff/install.sh --no-hook    # mode sans dépôts
```

Puis :

1. Remplissez `~/chief-of-staff/config.md` : prénom, langue, la table des projets avec leur type (stratégique ou autonome), leur dossier s'il existe, ce qu'il faut surveiller, et le hors périmètre.
2. `cd ~/chief-of-staff && claude -n "chief of staff"`, puis dites « démarre ». Il lit la config, arme la synchronisation et se présente.
3. Demandez « état des lieux » quand vous voulez. Au quotidien, laissez l'onglet ouvert : la synchronisation tourne toutes les heures.

À chaque reprise de session, redites « démarre » : les jobs cron de Claude Code vivent en mémoire et meurent avec la session. Le hook est le filet qui garantit que rien n'est perdu entre-temps.

## Ce qu'il écrit dans Open Brain

- Un thought « État chief of staff — date » par synchronisation qui a détecté un changement. Jamais quand rien n'a bougé.
- Si la couche graphe est connectée et que Claude Code est utilisé : un nœud « index des conversations », mis à jour, jamais dupliqué.
- Jamais de modification de vos propres thoughts.

## Limites connues

- Le cron ne survit pas à la session : c'est pourquoi « démarre » fait partie du rituel.
- Les connecteurs messagerie, agenda et documents sont hors périmètre par conception. Le chief of staff suit vos projets, pas votre boîte mail.
- `tools/sessions.sh` ne sert qu'à Claude Code : il liste vos conversations par sujet, là où le sélecteur de reprise n'affiche que des identifiants.
