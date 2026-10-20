# Open Brain Kit

*English: [README.en.md](README.en.md) and [docs/en/](docs/en/).*

Une mémoire IA personnelle, prête à installer en une heure, qui :

- **se construit à partir de vos historiques** ChatGPT et Claude (synchronisation de compte + import des exports officiels) ;
- **écoute en continu** vos conversations ChatGPT, Claude.ai et Claude Code, qu'elles aient lieu dans Chrome, dans les apps Mac ou sur mobile ;
- **étend le contexte de vos questions** depuis toutes les interfaces Claude et ChatGPT, via un connecteur MCP, avec une couche graphe de connaissances en option.

Tout tourne dans **votre** projet Supabase (base Postgres + pgvector, trois Edge Functions). Rien ne transite par un serveur tiers. Les clés restent sur votre machine et dans les secrets Supabase.

Le kit est construit sur [Open Brain](https://github.com/NateBJones-Projects/OB1) de Nate B. Jones. Il en assemble les briques utiles, y ajoute la capture continue et les scripts d'import, et conserve un lien de mise à jour avec la source (voir [UPSTREAM.md](UPSTREAM.md)).

## Démarrage rapide

1. Forkez ce dépôt sur votre compte GitHub, puis clonez votre fork.
2. Gardez ce dépôt en remote `upstream` pour recevoir les mises à jour : `git remote add upstream <URL de ce dépôt>`.
3. Ouvrez le dossier dans Claude Code (ou Cursor, Codex…) et écrivez : **« installe mon Open Brain »**. L'agent suit [docs/install.md](docs/install.md) pas à pas, exécute les commandes et vérifie chaque étape. Vous gardez les clics navigateur et les inscriptions.
4. Sans agent : suivez [docs/install.md](docs/install.md) vous-même.

Prérequis que vous fournissez : un compte [Supabase](https://supabase.com) (gratuit), un compte [OpenRouter](https://openrouter.ai) avec quelques dollars de crédit, Chrome, et vos comptes ChatGPT (plan payant pour le connecteur) et Claude.

## Ce que contient le dépôt

| Dossier | Rôle |
|---|---|
| `supabase/` | migrations (schéma complet, idempotent) et quatre Edge Functions : `open-brain-mcp` (cœur MCP), `open-brain-rest` (API REST pour l'extension et les imports), `ob-graph-mcp` (graphe), `open-brain-advisors` (chief of staff, sparring partner, panel de personae, voir [docs/advisors.md](docs/advisors.md)) |
| `chrome-capture-extension/` | extension Chrome : capture à la demande et synchronisation complète des comptes ChatGPT et Claude |
| `local/claude-code-capture/` | scanner des sessions Claude Code (launchd, toutes les 2 h) |
| `local/import/` | import d'un export Claude.ai avec conservation des dates |
| `chief-of-staff/` | la version locale du chief of staff pour Claude Code : lit en plus vos dépôts git et vos sessions, versionne tout dans un repo |
| `keepalive/` | GitHub Actions : anti-pause du free tier Supabase, et distillation nocturne des conseillers |
| `bootstrap.sh` | installe la partie locale (scanner, scripts, config) sur un Mac |
| `docs/` | [install.md](docs/install.md), [connect-clients.md](docs/connect-clients.md) |
| `upstream/` | copies intactes des fichiers d'origine OB1, base de fusion pour les mises à jour |
| `scripts/sync-upstream.sh` | récupère les changements d'OB1 (correctifs de sécurité…) et les fusionne dans le kit |

## Mises à jour

- **Utilisateur du kit** : `git pull upstream main`, puis `supabase db push`, `supabase functions deploy`, rechargez l'extension et relancez `./bootstrap.sh`. Le détail est en fin de [docs/install.md](docs/install.md).
- **Mainteneur du kit** : `scripts/sync-upstream.sh` puis `--apply` pour intégrer les évolutions d'OB1. Voir [UPSTREAM.md](UPSTREAM.md).

## Ce qui n'est volontairement pas ici

Le kit ne contient aucune donnée ni aucun code propre à une activité. Votre brain, vos clés et vos conversations vivent dans votre projet Supabase et sur votre machine. Si vous voulez ajouter une couche « métier » (extraction d'affirmations, synthèses, dossiers thématiques propres à votre société), faites-le dans un second dépôt privé qui dépend de celui-ci.

## Licence

FSL-1.1-MIT, comme OB1 (voir [LICENSE.md](LICENSE.md)) : usage interne et personnel libre, pas de produit concurrent dérivé.
