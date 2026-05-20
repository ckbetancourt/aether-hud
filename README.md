# Aether Jarvis HUD

Aether is a browser-based, voice-first HUD for Hermes Agent. Hermes owns the model, tools, APIs, memory, runtime profiles, and sessions; Aether provides speech input, browser TTS, HUD rendering, and a small voice-first prompt layer so replies sound natural when read aloud.

## Start

```bash
npm install
npm start
```

Open `http://localhost:8787`.

## Hermes Bridge

Run or expose Hermes Agent as an OpenAI-compatible local API server, then set:

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8000/v1
HERMES_MODEL=hermes
HERMES_API_KEY=
HERMES_PROFILE=
```

Hermes mode is the default. Aether keeps the same `/api/chat` frontend contract but routes requests through Hermes. The HUD sends the local session id, optional Hermes session id, optional Hermes runtime profile, and TTS style system prompt to the server. Hermes responses are normalized back into the HUD as `{ reply, backend, hermes }`.

### Connect Aether To Hermes

1. Start the Hermes API server with your installed Hermes Agent build. Aether expects an OpenAI-compatible base URL that serves `/models` and `/chat/completions`.

2. Create or update `.env.local` in this repository:

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8000/v1
HERMES_MODEL=hermes
HERMES_API_KEY=
HERMES_PROFILE=
PORT=8787
```

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

Aether still injects a compact TTS style prompt. That prompt tells Hermes to write for spoken delivery, avoid heavy markdown, avoid tables, and keep code blocks short when speech output is enabled.

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
