---
name: aether
description: Launch the Aether HUD voice-first browser interface for Hermes Agent.
version: 1.0.0
metadata:
  hermes:
    tags: [aether, hud, voice, ui]
    category: integrations
---

# Aether HUD

Use this skill when the user wants to open, launch, or switch into the **Aether HUD** (browser voice UI). Hermes stays the agent runtime; Aether is the spoken interface.

## When to use

- User types `/aether` in Hermes chat
- User asks to open Aether, the voice HUD, or the Jarvis-style orb UI

## Repository path

Before running launcher commands, `cd` to the Aether HUD repo:

1. If `AETHER_HUD_ROOT` is set in the environment, use that directory.
2. Else if `aether-hud-root.txt` exists in this skill directory (written by `npm run hermes:install-skill`), read the path from that file.
3. Else ask the user for the clone path once, then run commands there.

## What to run

From the repository root:

```bash
npm run hermes:launch
```

That starts the Aether HUD server if needed and opens `http://localhost:8787`. It does **not** start the `hermes` CLI.

## Hermes bridge

Aether talks to Hermes through the **gateway API** (`hermes gateway`, default `http://127.0.0.1:8642/v1`). The HUD and `hermes` chat are separate processes. See `hermes/README.md` in this repo.

## Behavior

Aether provides browser speech input, TTS, and HUD rendering. Hermes provides profiles, tools, APIs, memory, and sessions.

Use the **model button** in the bottom control pill to switch Hermes models (same curated lists as `/model` when the dashboard is running).
