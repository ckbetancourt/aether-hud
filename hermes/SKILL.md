# Aether Voice HUD

Use this skill when the user wants to open, launch, or switch into the Aether voice-first interface for Hermes Agent.

## Command

From the Aether repository root, run:

```bash
npm run hermes:launch
```

This starts the Aether HUD server if it is not already running and prints the local URL. It defaults the HUD server to Hermes bridge mode when launched this way.

## Slash Command Contract

Register `/aether` in Hermes to execute the repository command above. If the installed Hermes build supports command manifests, use `hermes/aether.command.json` as the command descriptor. If slash-command registration is not available, load this skill and run the command directly.

## Expected Environment

- `AETHER_BACKEND=hermes` (default)
- `HERMES_API_BASE_URL` points at the running Hermes API server (default `http://127.0.0.1:8000/v1`)
- Model, API key, and profile come from Hermes by default — no extra env vars required
- Optional: `HERMES_API_KEY`, `HERMES_PROFILE`, or `HERMES_MODEL` only when you need to override Hermes defaults

## Behavior

Aether remains the browser voice and HUD layer. Hermes remains the agent runtime for sessions, tools, profiles, and memory.
