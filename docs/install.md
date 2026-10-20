# Installer votre Open Brain

Durée : environ une heure, dont vingt minutes de clics dans un navigateur. Aucune ligne de code à écrire. Si vous utilisez Claude Code ou un outil équivalent, ouvrez ce dépôt dedans et demandez « installe mon Open Brain » : il déroule ce guide pour vous.

Chaque étape se termine par un **Terminé quand**. Ne passez pas à la suivante tant qu'il n'est pas vrai.

## Avant de commencer

**Comptes à créer** (vous seul pouvez le faire) :

- [Supabase](https://supabase.com) : votre base de données. Le plan gratuit suffit (voir l'étape 11 pour éviter sa mise en pause).
- [OpenRouter](https://openrouter.ai) : passerelle vers les modèles d'embedding. Ajoutez 5 $ de crédit, cela dure des mois.
- Un plan ChatGPT payant si vous voulez le connecteur ChatGPT (Plus, Pro, Business…). Claude fonctionne avec tout compte.

**Outils sur le Mac** :

```bash
brew install supabase/tap/supabase node
```

**Carnet de valeurs.** Vous allez produire des identifiants et des clés réutilisés à plusieurs étapes. Notez-les au fur et à mesure dans un gestionnaire de mots de passe :

| Valeur | Obtenue à l'étape |
|---|---|
| Project ref Supabase (chaîne aléatoire de l'URL du dashboard) | 1 |
| Mot de passe de la base | 1 |
| Clé OpenRouter | 2 |
| Brain key (`MCP_ACCESS_KEY`) | 5 |
| UUID propriétaire du graphe (`DEFAULT_USER_ID`) | 5 |
| Clé `service_role` (optionnelle, pour les imports datés) | 5 |

Les deux URLs que vous utiliserez partout, une fois le project ref connu :

- **URL des fonctions** : `https://PROJECT_REF.supabase.co/functions/v1`
- **URL de connexion MCP** : `https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=BRAIN_KEY`

## Étape 1 — Projet Supabase

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Nom : `open-brain`. Région : la plus proche de vous. Générez un mot de passe fort et notez-le.
2. Attendez une à deux minutes. Le **project ref** est la partie aléatoire de l'URL : `supabase.com/dashboard/project/CETTE_PARTIE`.
3. Dans **Database → Extensions**, cherchez `vector` et activez-le. La migration le fait aussi, mais l'activer ici évite un échec de permissions sur certains projets.

**Terminé quand** : project ref et mot de passe sont notés, le projet affiche « Active ».

## Étape 2 — Clé OpenRouter

[openrouter.ai/keys](https://openrouter.ai/keys) → **Create key** → notez-la. Puis **Credits** → ajoutez 5 $.

**Terminé quand** : la clé est notée et le solde est positif.

## Étape 3 — Lier le dépôt au projet

Depuis la racine du kit :

```bash
supabase login                       # ouvre le navigateur
supabase link --project-ref PROJECT_REF   # demande le mot de passe de la base
```

**Terminé quand** : `supabase projects list` affiche un ● devant votre projet.

## Étape 4 — Base de données

```bash
supabase db push
```

Quatre migrations s'appliquent : la table `thoughts` avec recherche vectorielle et déduplication, ses colonnes étendues (type, importance, sensibilité), les colonnes de statut, et les tables du graphe.

**Terminé quand** : dans **Table Editor**, vous voyez `thoughts`, `graph_nodes`, `graph_edges`. Relancer `supabase db push` affiche « Remote database is up to date ».

## Étape 5 — Secrets

Générez votre brain key et l'UUID du graphe :

```bash
openssl rand -hex 32          # → MCP_ACCESS_KEY
uuidgen | tr 'A-Z' 'a-z'      # → DEFAULT_USER_ID
```

Puis :

```bash
cp supabase/secrets.env.example supabase/secrets.env
open -e supabase/secrets.env            # remplissez les trois valeurs
supabase secrets set --env-file supabase/secrets.env
```

Le fichier `supabase/secrets.env` est ignoré par git. Ne le commitez jamais.

La clé `service_role` (Supabase → **Settings → API**) n'est pas un secret de fonction. Notez-la seulement si vous ferez des imports datés (étapes 9 et 10).

**Terminé quand** : `supabase secrets list` montre `OPENROUTER_API_KEY`, `MCP_ACCESS_KEY`, `DEFAULT_USER_ID`.

## Étape 6 — Déployer les trois fonctions

```bash
supabase functions deploy open-brain-mcp open-brain-rest ob-graph-mcp --use-api
```

`--use-api` évite d'avoir Docker. `supabase/config.toml` fixe `verify_jwt = false` pour les trois : c'est obligatoire, les fonctions s'authentifient avec votre brain key, pas avec un jeton Supabase.

Vérifiez, en remplaçant les deux valeurs :

```bash
URL=https://PROJECT_REF.supabase.co/functions/v1
KEY=votre_brain_key

curl -s "$URL/open-brain-rest/health" -H "x-brain-key: $KEY"
curl -s "$URL/ob-graph-mcp/health"
curl -s -X POST "$URL/open-brain-mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "x-brain-key: $KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"thought_stats","arguments":{}}}'
```

**Terminé quand** : les deux `health` répondent `ok` et la troisième commande contient « Total thoughts: 0 ». Un 401 signifie une clé différente de celle de l'étape 5, ou un `verify_jwt` resté à `true`.

## Étape 7 — Connecter vos clients IA

Suivez [connect-clients.md](connect-clients.md) : Claude (web, desktop, mobile), ChatGPT, Claude Code, et le graphe en second connecteur.

**Terminé quand** : dans Claude ou ChatGPT, « combien de thoughts contient mon Open Brain ? » déclenche l'outil `thought_stats` et répond.

## Étape 8 — Extension Chrome

C'est elle qui capture ChatGPT et Claude.ai. Elle lit l'historique de votre **compte** par l'API des deux sites, pas la page affichée : les conversations menées dans les apps Mac et mobiles sont donc capturées aussi, du moment que Chrome est ouvert et connecté aux deux sites.

1. `chrome://extensions` → **Mode développeur** (en haut à droite) → **Charger l'extension non empaquetée** → sélectionnez le dossier `chrome-capture-extension/` du kit.
2. Cliquez sur l'icône de l'extension → ⚙️ **Settings** : *Open Brain REST API URL* = `https://PROJECT_REF.supabase.co/functions/v1`, *API Key* = votre brain key → **Test connection** → **Save**.
3. Ouvrez [chatgpt.com](https://chatgpt.com) et [claude.ai](https://claude.ai) connecté, puis dans la popup : **Sync All**. La première synchronisation importe tout l'historique joignable, à raison de quelques secondes par conversation. Laissez l'onglet ouvert.

Ce que la synchronisation atteint : côté ChatGPT, les conversations actives et archivées, mais pas celles rangées dans un **Project** (API inaccessible : sortez-les du projet, elles seront prises au passage suivant). Côté Claude, la liste par défaut ; pour l'historique complet, voir l'étape 10.

Après chaque mise à jour du kit, rechargez l'extension (bouton ↻ dans `chrome://extensions`).

**Terminé quand** : la popup affiche un nombre de conversations synchronisées et `thought_stats` a augmenté.

## Étape 9 — Scanner Claude Code

Capture chaque session Claude Code terminée (au repos depuis 2 h, au moins 3 tours) toutes les deux heures, via launchd.

```bash
./bootstrap.sh      # crée ~/.open-brain/claude-code-capture/.env.local
open -e ~/.open-brain/claude-code-capture/.env.local   # SUPABASE_URL + MCP_ACCESS_KEY
./bootstrap.sh      # installe et vérifie l'agent launchd
```

Pour rattraper les sessions passées avec leur vraie date :

```bash
node ~/.open-brain/claude-code-capture/backfill-history.mjs                          # aperçu
SUPABASE_SERVICE_ROLE_KEY=... node ~/.open-brain/claude-code-capture/backfill-history.mjs --apply
```

Si vous travaillez sur plusieurs Macs, lancez `./bootstrap.sh` sur chacun : la déduplication par identifiant de session évite les doublons.

**Terminé quand** : `bootstrap.sh` affiche « scanner ran successfully (exit 0) ».

## Étape 10 — Historique complet

- **Claude** : [claude.ai](https://claude.ai) → Settings → Privacy → **Export data**. Vous recevez un zip par e-mail. Décompressez-le, puis :

  ```bash
  node ~/.open-brain/import/import-claude-export.mjs ~/Downloads/claude-export          # aperçu
  node ~/.open-brain/import/import-claude-export.mjs ~/Downloads/claude-export --apply  # import
  ```

  Chaque conversation garde sa date d'origine. Relancer le script ne crée pas de doublons.

- **ChatGPT** : la synchronisation de l'étape 8 couvre déjà tout l'historique hors Projects. Pour un export officiel (Settings → Data controls → Export), utilisez la recette [chatgpt-conversation-import](https://github.com/NateBJones-Projects/OB1/tree/main/recipes/chatgpt-conversation-import) d'OB1.

**Terminé quand** : « quelles sont mes conversations les plus anciennes ? » dans Claude renvoie des thoughts datés de l'année correspondante.

## Étape 11 — Keep-alive (free tier uniquement)

Supabase met en pause un projet gratuit inactif une semaine. Suivez [../keepalive/README.md](../keepalive/README.md) : cinq minutes, une GitHub Action qui pingue le brain chaque jour.

**Terminé quand** : le premier run de l'Action est vert.

## Test de bout en bout

1. Dans Claude Desktop : « retiens que je préfère les réunions le matin ». L'outil `capture_thought` doit s'exécuter.
2. Dans ChatGPT (ou Claude Code) : « que sais-tu de mes préférences de réunion ? ». La réponse doit citer le thought.

Si les deux passent, votre Open Brain est complet.

## Mettre à jour le kit

```bash
git pull upstream main
supabase db push
supabase functions deploy open-brain-mcp open-brain-rest ob-graph-mcp --use-api
./bootstrap.sh
```

Puis rechargez l'extension dans `chrome://extensions`.

## Dépannage

- **401 partout** : la clé saisie côté client diffère de `MCP_ACCESS_KEY`, ou une fonction a été déployée avec `verify_jwt = true`. Redéployez depuis le kit.
- **Le brain ne répond plus, DNS introuvable** : projet free tier en pause. Dashboard → **Restore**, puis mettez en place l'étape 11.
- **Extension : « Could not get access token »** : vous n'êtes pas connecté à chatgpt.com dans ce profil Chrome, ou le site a changé son API interne. Voyez les logs du service worker (`chrome://extensions` → Inspecter les vues).
- **ChatGPT dit que l'outil est indisponible** : Developer mode désactivé, ou le connecteur n'a pas atteint le serveur. Vérifiez Supabase → Edge Functions → `open-brain-mcp` → Logs. Détails dans `upstream/docs/03-faq.md`.
- **« permission denied for table thoughts »** : la migration de base n'a pas été appliquée entièrement. Relancez `supabase db push`.
