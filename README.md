# Aether HUD

Aether HUD is a voice-first browser interface for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/). You speak to the orb, read replies aloud, and browse session history in a full-screen HUD. Hermes runs the agent — models, tools, memory, and profiles. Aether runs the voice UI.

## What you need

- **Node.js** 18 or newer
- **Hermes Agent** installed (`hermes` in your terminal)
- **Hermes API gateway** running (`hermes gateway` — not the same as `hermes` chat)
- A modern browser with speech recognition and synthesis (Chrome or Edge recommended)

## Quick start

### 1. Enable Hermes API (one time)

Edit `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
```

### 2. Start the Hermes gateway (every session)

In a terminal you keep open:

```bash
hermes gateway
```

You should see the API listening on `http://127.0.0.1:8642` (default port).

### 3. Configure and run Aether

```bash
git clone <this-repo>
cd aether-hud   # or your clone directory
npm install
cp .env.example .env.local
```

Edit `.env.local` — `HERMES_API_KEY` must match `API_SERVER_KEY` from step 1:

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8642/v1
HERMES_API_KEY=change-me-local-dev
PORT=8787

# Optional — cloud voices (Settings → Speech engine → ElevenLabs)
# ELEVENLABS_API_KEY=your-elevenlabs-api-key
# ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
# ELEVENLABS_DEFAULT_VOICE_ID=

# Optional — local OmniVoice (Settings → Speech engine → OmniVoice)
# OMNIVOICE_BASE_URL=http://127.0.0.1:8000
```

Check wiring before starting the HUD:

```bash
npm run hermes:doctor
npm start
```

Open [http://localhost:8787](http://localhost:8787).

More detail: [`hermes/README.md`](hermes/README.md).

## How it fits together

```text
Terminal A (keep open)     Terminal B
┌─────────────────────┐    ┌─────────────────────┐
│  hermes gateway     │    │  npm start          │
│  :8642 /v1 API      │◄───│  Aether server :8787│
└─────────────────────┘    └──────────┬──────────┘
                                        │
                                        ▼
                               Browser: Aether HUD
```

| Component | Command | Role |
|-----------|---------|------|
| Hermes gateway | `hermes gateway` | OpenAI-compatible API Aether calls |
| Hermes chat | `hermes` | Terminal agent; optional `/aether` skill |
| Aether server | `npm start` | Serves HUD + proxies chat to Hermes + SQLite user data |
| Aether HUD | browser | Voice UI |

**Common mistake:** running only `hermes` or `npm start` without `hermes gateway`. The HUD will show **HERMES OFFLINE**.

## Configuration

Environment variables load from `.env` then `.env.local` (`.env.local` wins).

| Variable | Default | Purpose |
|----------|---------|---------|
| `AETHER_BACKEND` | `hermes` | Use Hermes as the agent runtime |
| `HERMES_API_BASE_URL` | `http://127.0.0.1:8642/v1` | Hermes API base URL |
| `HERMES_API_KEY` | *(empty)* | Bearer token — must match `API_SERVER_KEY` in `~/.hermes/.env` when auth is enabled |
| `PORT` | `8787` | Aether HUD server port |
| `ELEVENLABS_API_KEY` | *(empty)* | Enables ElevenLabs TTS in Settings |
| `ELEVENLABS_MODEL_ID` | `eleven_turbo_v2_5` | ElevenLabs model for speech |
| `ELEVENLABS_DEFAULT_VOICE_ID` | *(empty)* | Default voice when none selected in HUD |
| `OMNIVOICE_BASE_URL` | `http://127.0.0.1:8000` | OmniVoice-local REST API base URL |
| `OMNIVOICE_API_KEY` | *(empty)* | Bearer token when OmniVoice-local auth is enabled |
| `OMNIVOICE_DEFAULT_SAMPLE` | *(empty)* | Default clone sample when none selected in HUD |
| `OMNIVOICE_DEFAULT_INSTRUCT` | *(empty)* | Default voice-design instruct when no sample |

Optional: `HERMES_MODEL`, `HERMES_PROFILE`, `HERMES_PROFILES_URL`, `HERMES_SESSIONS_URL`, `AETHER_TEMPERATURE`. See [`.env.example`](.env.example).

### Optional ElevenLabs voices

For higher-quality speech than browser TTS, uncomment and set `ELEVENLABS_API_KEY` in `.env.local` (see [`.env.example`](.env.example)), then restart the server:

```bash
ELEVENLABS_API_KEY=your-elevenlabs-api-key
# ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
# ELEVENLABS_DEFAULT_VOICE_ID=
```

Verify the server sees your key:

```bash
curl http://localhost:8787/api/tts/elevenlabs/status
# → {"configured":true}
```

In the HUD, open **Settings** → **Speech engine** → **ElevenLabs**, pick a voice, and save. The API key stays on the server only. If ElevenLabs fails, Aether falls back to browser speech synthesis.

### Optional OmniVoice (local)

For high-quality **local** TTS with voice cloning (600+ languages), use [OmniVoice-local](https://github.com/pasadei/OmniVoice-local) as a REST server on port **8000**. It wraps the official [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice) model. The stock `omnivoice-demo` Gradio UI does **not** expose an HTTP TTS API — Aether talks to OmniVoice-local (or any compatible server) only.

**Setup**

1. Install and start [OmniVoice-local](https://github.com/pasadei/OmniVoice-local) (Docker or native). Wait until the model is loaded:

```bash
curl http://127.0.0.1:8000/health
```

2. Add clone samples under its `samples/` folder (paired by filename stem):

```text
samples/
  my-voice.wav    # 3–10 s reference audio
  my-voice.txt    # optional transcript (recommended)
```

3. In Aether `.env.local`:

```bash
OMNIVOICE_BASE_URL=http://127.0.0.1:8000
# OMNIVOICE_API_KEY=...          # if OmniVoice-local auth is enabled
# OMNIVOICE_DEFAULT_SAMPLE=...   # optional server default
# OMNIVOICE_DEFAULT_INSTRUCT=... # optional voice-design default
```

4. Restart Aether and verify the proxy:

```bash
npm start
curl http://localhost:8787/api/tts/omnivoice/status
# → {"configured":true,"ready":true,...}

curl http://localhost:8787/api/tts/omnivoice/samples
# → {"samples":[{"id":"my-voice","name":"my-voice",...}]}
```

**HUD**

Open **Settings** → **Speech engine** → **OmniVoice (local)**:

| Setting | Effect |
|---------|--------|
| **Speech voice** → sample name | Voice cloning from `samples/` |
| **Speech voice** → Auto voice | Model picks a voice |
| **Voice design instruct** | Used when no sample is selected (e.g. `female, low pitch, british accent`) |

First synthesis after a cold start can take 1–2 minutes while the model warms up. If OmniVoice is down or errors, Aether falls back to browser speech synthesis. The API key (if any) stays on the Aether server only.

### Check the connection

```bash
npm run hermes:doctor
curl http://localhost:8787/api/hermes/status
```

When connected, `"connected": true` and the HUD badge shows **HERMES**.

If not connected, the status JSON includes `setupSteps` and an `error` with the likely fix (wrong port, gateway not running, missing API key).

## Using the HUD

- **Microphone** — speak a command (send directly or fill the composer, per settings).
- **Chat panel** — type when you prefer text.
- **Archives** — stored in local SQLite (`data/aether.db` by default); migrates existing `localStorage` on first load.
- **Aether Vault** — SQLite index of files Hermes creates; previews read directly from originals on disk. See [docs/VAULT.md](docs/VAULT.md).
- **Settings** — speech engine (browser, ElevenLabs, or OmniVoice local), voice, speed, TTS replay history size, Hermes profile (when configured), microphone behavior.

### Kanban board

Aether includes a **native Kanban board** backed by Hermes task data (`~/.hermes/kanban.db`). You do **not** need `hermes dashboard` running to use the board — only the gateway and HUD server.

**One-time setup:**

```bash
hermes kanban init
```

**Every session:**

```bash
hermes gateway    # terminal A
npm start         # terminal B — open http://localhost:8787
```

**In the HUD:**

| Button (bottom pill) | What it does |
|----------------------|--------------|
| **folder-kanban** | Toggle Kanban mode — native board, chat collapses, orb floats in the corner |

In Kanban mode you can create tasks, drag cards between columns (triage → done), open the task drawer for edits/comments, run decompose/specify on triage items, bulk-select cards, and switch boards from the toolbar.

**Hermes dashboard (optional):** Aether auto-starts `hermes dashboard` in the background when it is not already running — for **session restore** and the **model picker** only, not for rendering the board. A small header pill shows progress during first-run web UI builds (can take 1–3 minutes).

**Verify:**

```bash
npm run hermes:doctor
npm run test:native-kanban
```

More detail (API routes, workspaces): [`hermes/README.md`](hermes/README.md).

### TTS replay history

Aether keeps a rolling cache of the last **N** spoken assistant replies (default **5**, configurable under **Settings → TTS replay history size**). ElevenLabs and OmniVoice clips are stored as audio on the server; browser TTS stores speakable text for re-synthesis. When the cache is full, the oldest entry is removed. Each assistant chat bubble shows a replay button to hear that reply again (falls back to re-speaking the message text if the cache entry was evicted).

Replies are tuned for **text-to-speech** via [`TTS-Prompt.md`](TTS-Prompt.md).

### Capabilities

The bridge supports:

- **Streaming** — responses stream token-by-token from Hermes for lower latency.
- **Tool calling** — Hermes's tools (terminal, file, web, memory, etc.) work through the bridge. The server handles up to 6 rounds of tool calls per message before returning the final text response.
- **Session persistence** — pass `hermesSessionId` in the chat body to maintain context across messages.
- **Profile selection** — pass `hermesProfile` or set `HERMES_PROFILE` in `.env.local`.

## Launch from Hermes (`/aether`)

Install the skill once:

```bash
npm run hermes:install-skill
```

In Hermes chat (not your shell):

```text
hermes
/aether
```

Or from this repo:

```bash
npm run hermes:launch
```

## NPM scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the HUD server |
| `npm run hermes:doctor` | Verify gateway + `.env.local` |
| `npm run hermes:launch` | Start server and open browser |
| `npm run hermes:install-skill` | Install `/aether` into `~/.hermes/skills/` |
| `npm run test:native-kanban` | Smoke test native Kanban API (server must be running) |
| `npm run test:kanban-workspaces` | Smoke test Kanban workspace browser API |

## OpenAI-compatible fallback (advanced)

```bash
AETHER_BACKEND=openai
OPENAI_BASE_URL=...
OPENAI_MODEL=...
OPENAI_API_KEY=...
```

Hermes integration is the intended setup.
