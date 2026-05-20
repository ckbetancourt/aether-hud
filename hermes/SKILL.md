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

- `AETHER_BACKEND=hermes`
- `HERMES_API_BASE_URL` points at the running Hermes API server.
- `HERMES_API_KEY` is optional if the local Hermes API server does not require a bearer token.
- `HERMES_PROFILE` is optional and selects the default Hermes runtime profile.

## Behavior

Aether remains the browser voice and HUD layer. Hermes remains the agent runtime for sessions, tools, profiles, and memory.
