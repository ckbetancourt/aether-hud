# Aether HUD

Aether is a browser-based, voice-first HUD for Hermes Agent. Hermes owns the model, tools, APIs, memory, runtime profiles, and sessions; Aether provides speech input, browser TTS, HUD rendering, and a small voice-first prompt layer so replies sound natural when read aloud.

## Start

```bash
npm install
npm start
```

Open `http://localhost:8787`.

## Hermes Bridge

Hermes mode is the default. Start the Hermes API server, then point Aether at it. In most setups you only need:

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8000/v1
```

You do **not** need to set `HERMES_MODEL`, `HERMES_API_KEY`, or `HERMES_PROFILE` — Hermes owns model routing, API auth, and runtime profiles. Aether discovers the model from Hermes `/models` when connected, uses no bearer token unless you override `HERMES_API_KEY`, and uses the HUD profile picker (or Hermes default) for profiles.

Aether keeps the same `/api/chat` frontend contract but routes requests through Hermes. The HUD sends the local session id, optional Hermes session id, optional Hermes runtime profile, and TTS style system prompt to the server. Hermes responses are normalized back into the HUD as `{ reply, backend, hermes }`.

### Connect Aether To Hermes

1. Start the Hermes API server with your installed Hermes Agent build. Aether expects an OpenAI-compatible base URL that serves `/models` and `/chat/completions`.

2. Create or update `.env.local` in this repository (minimal example):

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8000/v1
PORT=8787
```

Optional overrides — only when your Hermes build requires them:

```bash
# HERMES_MODEL=anthropic/claude-sonnet-4
# HERMES_API_KEY=your-bearer-token
# HERMES_PROFILE=my-hermes-profile
```

If you still have old `OPENAI_*` entries in `.env.local`, remove them or set `AETHER_BACKEND=hermes` so Aether does not use the OpenAI fallback path.

3. Start Aether:

```bash
npm start
```

4. Verify the bridge:

```bash
curl http://localhost:8787/api/hermes/status
```

When Hermes is reachable, the response includes `"enabled": true` and `"connected": true`, and the HUD badge changes from `HERMES OFFLINE` to `HERMES`.

The HUD also exposes:

- `GET /api/hermes/status` for connection and capability detection.
- `GET /api/hermes/profiles` for configured or externally exposed Hermes profiles.
- `GET /api/hermes/sessions` for externally exposed Hermes session lists.

If your Hermes build does not expose profile or session listing endpoints, leave `HERMES_PROFILES_URL` and `HERMES_SESSIONS_URL` empty. Aether will still chat through Hermes and will mark those capabilities as unavailable instead of faking sync.

## Launch From Hermes

This repo includes a local launcher intended for a Hermes `/aether` command:

```bash
npm run hermes:launch
```

The launcher starts the HUD if needed, defaults the server to Hermes mode for that process, and prints the local URL. Use `npm run hermes:launch -- --open` to open the browser as well.

Hermes-facing assets live in `hermes/`:

- `hermes/SKILL.md` describes when and how Hermes should launch Aether.
- `hermes/aether.command.json` is a small command descriptor for Hermes builds that support manifest-based command registration.

If your Hermes installation has a slash-command registry, register `/aether` to execute `npm run hermes:launch` from this repository.

## Profiles, TTS, And Sessions

Hermes profiles are the only runtime profiles. Aether stores the selected Hermes profile as `aether_hermes_profile` and displays it in the HUD badge. Aether no longer injects separate activity-profile behavior.

Aether still injects a compact TTS prompt (see [`TTS-Prompt.md`](TTS-Prompt.md) for reference; runtime source is [`aether-config.js`](aether-config.js)). That prompt tells Hermes to write for spoken delivery, avoid heavy markdown, avoid tables, and keep code blocks short when speech output is enabled.

Local archives remain in browser `localStorage`. Hermes-backed sessions add optional metadata:

- `source: "hermes"`
- `hermesSessionId`
- `hermesProfile`
- `hermesUpdatedAt`

When `HERMES_SESSIONS_URL` is configured, Aether imports session shells into the archive drawer.

## Explicit OpenAI-Compatible Fallback

Set `AETHER_BACKEND=openai` only when you intentionally want to test without Hermes. The server will use:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
```

This fallback works with OpenRouter, Groq, Ollama, LM Studio, and other OpenAI-compatible endpoints, but it does not provide Hermes tools, APIs, memory, or sessions.
