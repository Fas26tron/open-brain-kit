# Conseillers : chief of staff, sparring partner, panel de personae

Trois rôles servis par votre brain lui-même, donc utilisables depuis **n'importe quel client** : claude.ai, Claude Desktop, Claude mobile, ChatGPT, Claude Code. Un seul réglage, valable partout. Un job nocturne les fait apprendre de vos conversations sans que vous y pensiez.

- **Le chief of staff** suit vos projets : où chacun en est, ce qu'il attend, ce qui est bloqué sur vous, ce dont vous vous éloignez. « Où en sont mes projets ? » produit un état des lieux daté.
- **Le sparring partner** est un pair qui vous connaît : vos positions datées, vos revirements, vos réactions, vos forces et faiblesses, distillés chaque nuit dans un profil confidentiel. Il vous challenge avec précision et termine par une question fermée.
- **Le panel** : les personae que vous définissez, investisseur, expert-comptable, salarié, banquier, client. Une question, une réponse par persona depuis les faits que chacune a le droit de voir, puis ce que leurs désaccords révèlent.

## Installation

Prérequis : le kit déployé (étapes 1 à 6 de [install.md](install.md) ; la fonction `open-brain-advisors` et ses tables en font partie).

Vérification : `curl -s https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors/health`.

Réglages optionnels, par `supabase secrets set` : `ADVISORS_MODEL` (identifiant OpenRouter du modèle qui joue les rôles, par défaut `anthropic/claude-sonnet-5.5`), `ADVISORS_LANGUAGE` (défaut `fr`).

**Connecteur** : ajoutez-le comme Open Brain, dans chaque client, nom `Conseillers`, URL :

```
https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY
```

Claude Code : `claude mcp add --transport http --scope user advisors "https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY"`.

**Job nocturne** : copiez `keepalive/advisors-nightly.yml` dans le dépôt GitHub de votre keep-alive, sous `.github/workflows/`. Il réutilise les deux secrets déjà posés. Lancez-le une fois à la main depuis l'onglet Actions.

**Terminé quand** : « liste mes personae » répond dans Claude, et le premier run du job nocturne est vert.

## Les domaines

Les **domaines** partitionnent la mémoire en zones de vie ou de travail : « Artinary et Arts Lab », « Forward College », « Vie personnelle ». Chaque thought porte le ou les domaines auxquels il appartient, attribués chaque nuit par un classeur léger à partir de la description des domaines, et corrigeables par une phrase. Un domaine par défaut existe toujours (« Vie personnelle ») : tout ce qui n'est pas clairement rattaché ailleurs y va.

- Une **persona** appartient à un domaine et ne voit que ses thoughts, règle stricte : un thought qui touche aussi un autre domaine lui est invisible.
- Le **chief of staff** est global ; chaque projet est rattaché à un domaine ; « où en sont mes projets Forward College » ou « état des lieux complet ».
- Le **sparring partner** est global et voit tout ; « sparring, dans le cadre de Forward College… » cadre la réponse sans l'aveugler.

Les règles de définition, avec des exemples de bonnes et mauvaises descriptions, sont dans [rules.md](rules.md).

## S'en servir, depuis n'importe quel client

Tout passe par des phrases ; le client appelle l'outil correspondant.

| Vous dites | Outil |
|---|---|
| « Crée un domaine Forward College : l'école, son équipe, ses campus, son financement, ses étudiants ; pas ma vie personnelle » | `set_domain` |
| « Montre-moi mes domaines » / « reclasse tout » / « cette conversation sur X va dans Forward College » | `list_domains`, `classify_domains`, `set_thought_domains` |
| « Ajoute une persona dans Forward College : professeur salarié de l'école, dix ans d'ancienneté, protège la qualité pédagogique et sa charge, dit non à ce qui ajoute des heures sans moyens, dit oui à ce qui valorise son métier. Il ne connaît pas mes conversations privées. » | `set_persona` |
| « Montre-moi mon panel » | `list_personas` |
| « Demande au panel : faut-il ouvrir un second campus en 2027 ? » | `ask_panel` |
| « Demande à l'investisseur ce qu'il pense du plan de financement » | `ask_persona` |
| « Sparring : je pense reporter le lancement de six mois » | `ask_sparring` |
| « Déclare mes projets : Refonte du site (stratégique), Recrutement direction pédagogique (stratégique), Dossier subvention région (autonome, date limite 15 novembre) » | `set_projects` |
| « Où en sont mes projets ? » | `etat_des_lieux` |
| « Qu'est-ce que mon sparring partner sait de moi ? » | `get_profile` |
| « Oublie la conversation sur l'hôtel en Corse » | `forget` (montre avant d'effacer) |
| « Lance la distillation maintenant » | `run_nightly` |

Le chief of staff propose de lui-même les projets qu'il voit revenir dans vos conversations et qui ne sont pas déclarés ; « liste mes projets » les montre, « déclare… » les adopte.

## Ce que chaque persona a le droit de savoir

Deux mécanismes, et seul le premier est une garantie :

1. **Filtres déterministes**, dans `set_persona` : les sources autorisées (`source_types`, par exemple seulement les affirmations curées), les niveaux de sensibilité exclus (`exclude_sensitivity`, par défaut `restricted` et `private`), une fenêtre de temps (`since_days`). Le serveur ne transmet jamais un thought hors de ces filtres. Ce qui doit rester hors de portée se **marque** (sensibilité du thought), il ne se décrit pas.
2. **Description** (`knows`, `does_not_know`) : indique à la persona ce qu'elle ne doit pas supposer. Utile pour le jeu de rôle, pas une barrière.

Le sparring partner voit tout. Son profil vit dans une table à part, jamais dans les thoughts : aucune autre persona ne peut le lire. Ce profil contient ce que vous êtes ; il reste dans votre Supabase.

## Comment ils apprennent

Chaque nuit, le job lit les thoughts arrivés depuis le dernier passage (toutes sources : extension Chrome, scanner Claude Code, app mobile) et :

- **classe** les nouveaux thoughts dans les domaines ;
- met à jour le **profil du sparring partner** : positions nouvelles, revirements, réactions à des conseils, règles pour vous challenger, traits observés. Rien n'est supprimé, une position dépassée descend en « revirements » avec sa date ;
- met à jour l'**état des projets** du chief of staff et propose les projets non déclarés.

Entre deux nuits, les deux rôles voient quand même tout ce qui est capturé, par recherche au moment de la question. La nuit sert à distiller, pas à savoir.

**Relisez le profil une fois par semaine** (« qu'est-ce que mon sparring partner sait de moi ? »). Un profil qui apprend sans relecture finit par vous décrire de travers sur un point sans que vous le sachiez. `set_profile` remplace le texte si vous corrigez ; `reset_cursor` fait redistiller une période.

**Amorcer** : si vous avez déjà un document qui vous décrit (un modèle du fondateur, des notes), `set_profile` avec son contenu évite de partir de zéro. Pour redistiller tout l'historique importé, `reset_cursor` à une date ancienne, puis `run_nightly` autant de fois qu'il le demande : c'est long et cela coûte des appels de modèle, à faire une fois.

## Coûts et limites

- Chaque question au panel = un appel de modèle par persona, plus un pour la synthèse. Chaque nuit = un appel par tranche de 30 thoughts nouveaux, plus une fusion du profil ; le workflow enchaîne jusqu'à 12 appels. Avec le modèle par défaut, quelques centimes par question, quelques dizaines de centimes par nuit active.
- La qualité des rôles est celle du modèle serveur. Un modèle bas de gamme donne des caricatures.
- « Comme un psychothérapeute » : le sparring partner reflète les schémas visibles dans vos conversations, avec précision si le profil est bien distillé. C'est un miroir informé, pas un clinicien.
- Côté ChatGPT, le plugin se crée puis s'**installe** (deux gestes, voir [connect-clients.md](connect-clients.md)) ; plan payant ; outil parfois à nommer.

Le pack `chief-of-staff/` du kit reste la version locale pour Claude Code : il lit en plus vos dépôts git et vos sessions, et versionne tout dans un repo. Les deux peuvent coexister sur le même brain.
