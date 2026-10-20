# Synchronisation horaire

À armer au démarrage de chaque session chief of staff avec un job cron `13 * * * *`, récurrent. La minute 13 est délibérée : à `:00`, tout le monde frappe les API en même temps.

---

Synchronisation chief of staff.

1. **File des sessions fermées.** Si `~/.claude/chief-of-staff/pending-sync.jsonl` existe et n'est pas vide, lire chaque ligne : une session Claude Code fermée depuis le dernier passage (horodatage, projet, dossier, identifiant, transcript). Sinon, passer.
2. **Sessions vivantes.** `ListAgents` si l'outil est disponible.
3. **Dépôts.** Pour chaque projet de `config.md` qui a un `Dossier` versionné : `git status --short` et `git log --oneline -5` depuis la date de `state/last-sync.json`.
4. **Open Brain.** Pour chaque projet de `config.md`, une requête `search_thoughts` avec le nom du projet et ce qu'il faut surveiller. Ne retenir que les résultats postérieurs à la date de `state/last-sync.json`. Chercher aussi « note pour le chief of staff ».
5. **Décision.** Si et seulement si quelque chose a changé (nouveau commit, session fermée ou ouverte, décision prise, note dictée, échéance passée) : écrire un état compact dans Open Brain avec `capture_thought`, contenu commençant par « État chief of staff — <date> » puis, par projet, où il en est, son dossier, la prochaine décision attendue. Puis vider la file et mettre à jour `state/last-sync.json` (`last_sync`, résumé d'une ligne par projet). Si rien n'a bougé : ne rien écrire dans Open Brain, mettre à jour `last_sync`, et le dire en une ligne.
6. **Index des conversations**, seulement si Claude Code est utilisé et que la couche graphe est connectée : si une conversation est apparue ou s'est fermée, régénérer l'inventaire avec `tools/sessions.sh` et mettre à jour le nœud dont l'identifiant est dans `state/last-sync.json` avec `update_node`. S'il n'existe pas encore, le créer une fois avec `create_node` et noter son identifiant.

Discipline : `search_thoughts`, jamais `list_thoughts` sans filtre. Une file vide et des dépôts identiques donnent une seule ligne de réponse. Langue : celle de `config.md`.
