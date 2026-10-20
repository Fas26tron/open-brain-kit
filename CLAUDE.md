# CLAUDE.md — instructions for AI coding agents in this repository

This repository is the **Open Brain Kit**: everything needed to deploy a personal AI memory (Supabase + three Edge Functions), capture conversations (Chrome extension, Claude Code scanner, import scripts) and connect AI clients to it.

## If the user asks to install / set up their Open Brain

Act as a guided setup wizard. The single source of truth for WHAT to do is `docs/install.md` (French) or `docs/en/install.md` (English, same content), plus `connect-clients.md` for step 7 and `advisors.md` for step 12, in the same folder. Pick the language the user writes in, and read the guides fully before starting. This file only defines HOW we work together.

1. **Interview first**, one question at a time: operating system (detect it yourself and confirm), which AI clients they want connected at the end (Claude, ChatGPT, Claude Code, others), whether they attempted this before (if yes, check for leftover state before touching anything), and whether you can run terminal commands in this session.
2. **Plan**: show the trimmed list of steps that apply to them, with a time estimate, and get a confirmation.
3. **One step at a time, in order.** Say what the step builds and why in a sentence. Run the terminal parts yourself; for browser parts (account creation, dashboard clicks, connector settings) tell them exactly what to click and what to copy. Verify the step's **« Terminé quand »** checkpoint before moving on. When a check fails, read the actual error or log, consult the troubleshooting section and `upstream/docs/03-faq.md`, and fix the configuration — the code in this kit is known-good, failures are almost always a secret, a value or a skipped step.
4. **Secrets never go through the chat.** Have the user paste keys directly where they are used (`supabase/secrets.env`, `~/.open-brain/claude-code-capture/.env.local`, the extension's settings, the connector field). Refer to each secret by name. Keep a running list of the non-secret values (project ref, URLs) and show it on request.
5. **Finish with proof**: capture a test thought from a connected client, search for it from another client, show the row exists (`thought_stats`). Then summarise what is deployed, where every credential lives, and what to do next (history import, keepalive).
6. **Resumable**: if asked to continue a previous attempt, detect what is already done by testing the checkpoints, state where things stand, and resume from the first unfinished step.

Speak the user's language. Use plain words and short sentences, and assume no terminal experience unless told otherwise.

## If the user asks to update the kit from upstream (maintainers)

Follow `UPSTREAM.md`: run `scripts/sync-upstream.sh` (dry run), review the diff, then `--apply`, resolve conflicts, run the checks, redeploy, commit.

## Guard rails

- Never commit secrets. `.env*`, `supabase/secrets.env` and `*.key` are git-ignored on purpose.
- Never edit a migration that may already be applied on a live brain; add a new timestamped migration instead.
- Never edit files under `upstream/`: they are the pristine merge base.
- The three functions authenticate with the brain key, not a Supabase JWT: `verify_jwt = false` in `supabase/config.toml` is required, keep it.
