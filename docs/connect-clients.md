# Connecter vos clients IA

Votre Open Brain expose un serveur MCP. Tout client qui parle MCP peut l'interroger (`search_thoughts`, `list_thoughts`, `thought_stats`) et y écrire (`capture_thought`). Il expose aussi `search` et `fetch`, les deux outils que ChatGPT exige.

Valeurs à préparer :

- **URL de connexion MCP** : `https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=BRAIN_KEY`
- **URL du graphe** : `https://PROJECT_REF.supabase.co/functions/v1/ob-graph-mcp?key=BRAIN_KEY`
- **URL des conseillers** : `https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY`

La clé est dans l'URL : ne collez ces URLs que dans les réglages de vos propres clients. Quand un client propose des **en-têtes de requête**, préférez l'URL sans `?key=` et un en-tête `x-brain-key` avec la clé : elle est stockée chiffrée et plus jamais affichée. Toutes les fonctions acceptent les deux formes.

## Claude (web, desktop, mobile)

Les connecteurs sont attachés à votre compte Claude. Ajoutez-le une fois, il apparaît dans claude.ai, Claude Desktop et l'app mobile.

1. [claude.ai](https://claude.ai) → **Settings → Connectors** (ou Claude Desktop → Settings → Connectors).
2. **Add custom connector**. Nom : `Open Brain`. URL : votre URL de connexion MCP. **Add**.
3. Dans une nouvelle conversation, le bouton **+** → Connectors permet d'activer ou non Open Brain.
4. **Autorisations des outils** (ouvrez le connecteur depuis la liste) : passez les outils de lecture sur « toujours autoriser » et gardez « demander » pour ceux qui écrivent, sinon Claude demande confirmation à chaque appel.

Faites de même avec le nom `OB-Graph` et l'URL du graphe si vous voulez les outils de graphe (nœuds, relations, parcours), et avec le nom `Conseillers` et l'URL des conseillers (voir [advisors.md](advisors.md)).

**Terminé quand** : « combien de thoughts contient mon Open Brain ? » déclenche `thought_stats`.

## ChatGPT

Plan payant requis (Plus, Pro, Business…). Depuis l'été 2026, les connecteurs MCP s'appellent **plugins** dans ChatGPT et il n'y a plus de mode développeur à activer. Un plugin se crée une fois, sur le web, puis s'installe sur le compte : il est ensuite disponible dans l'app Mac (vérifié en octobre 2026) et, selon les versions, sur mobile.

1. [chatgpt.com](https://chatgpt.com) → avatar → **Settings → Plugins** → **Browse directory** → bouton **+** ou **Add custom MCP server**.
2. Name : `Open Brain Memory` (si « Open Brain » est annoncé comme déjà existant, changez le nom, il n'a aucune importance). Description : `Ma mémoire personnelle : recherche et capture`. Server URL : votre URL de connexion MCP, clé comprise. Authentication : **No authentication**. Cochez « I understand and want to continue », puis **Create as a plugin**.
3. Retour dans **Plugins**, onglet **Personnel**, section « Créés par vous » : cliquez sur le **+** du plugin pour l'**installer**. Il apparaît alors sous « Installés ». Un plugin créé mais non installé ne fait rien.
4. Dans une conversation, bouton **+** du champ de saisie : activez le plugin si ChatGPT ne le propose pas de lui-même. Si l'outil n'est pas appelé spontanément, nommez-le : « utilise l'outil search d'Open Brain Memory pour… ».

Cette partie de ChatGPT change souvent. Si un outil est annoncé indisponible et que les logs Supabase de `open-brain-mcp` ne montrent aucune requête, recréez le plugin et ouvrez une nouvelle conversation.

**Terminé quand** : la même question qu'au-dessus déclenche `search` ou `thought_stats`.

## Claude Code

Une commande, en remplaçant les deux valeurs. `--scope user` rend le connecteur disponible dans tous vos projets.

```bash
claude mcp add --transport http --scope user open-brain \
  https://PROJECT_REF.supabase.co/functions/v1/open-brain-mcp \
  --header "x-brain-key: BRAIN_KEY"
```

Pour le graphe :

```bash
claude mcp add --transport http --scope user ob-graph \
  "https://PROJECT_REF.supabase.co/functions/v1/ob-graph-mcp?key=BRAIN_KEY"
```

**Terminé quand** : `claude mcp list` affiche les deux serveurs connectés, et dans une session « que sait mon Open Brain de ce projet ? » répond.

## Les conseillers (chief of staff, sparring partner, panel)

Un troisième connecteur, si vous avez déployé `open-brain-advisors` ([advisors.md](advisors.md)). Même geste que les deux autres, nom `Conseillers`, URL :

```
https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY
```

Claude Code : `claude mcp add --transport http --scope user advisors "https://PROJECT_REF.supabase.co/functions/v1/open-brain-advisors?key=BRAIN_KEY"`.

## Codex, Cursor, VS Code, Windsurf

Ces clients acceptent soit l'URL de connexion MCP directement, soit un pont local (`supergateway` ou `mcp-remote`). Les configurations prêtes à copier sont dans `upstream/docs/01-getting-started.md`, sections 7.4 et 7.5.

## S'en servir au quotidien

- **Retenir** : « retiens que… », « note pour plus tard… » → `capture_thought`.
- **Retrouver** : « qu'ai-je décidé au sujet de… », « rappelle-moi le contexte de… » → `search_thoughts`.
- **Étendre une question** : « en tenant compte de ce que mon Open Brain sait de X, … ». Claude le fait seul ; ChatGPT a parfois besoin qu'on nomme l'outil.

Les captures automatiques (extension Chrome, scanner Claude Code) arrivent avec `source_type` = `chatgpt_import`, `claude_import`, `claude_code_session`, ce qui permet de filtrer par origine.
