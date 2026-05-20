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
| Aether server | `npm start` | Serves HUD + proxies chat to Hermes |
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

Optional: `HERMES_MODEL`, `HERMES_PROFILE`, `HERMES_PROFILES_URL`, `HERMES_SESSIONS_URL`, `AETHER_TEMPERATURE`. See [`.env.example`](.env.example).

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
- **Archives** — browser-stored history.
- **Settings** — voice speed, Hermes profile (when configured), microphone behavior.

Replies are tuned for **text-to-speech** via [`TTS-Prompt.md`](TTS-Prompt.md).

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

## OpenAI-compatible fallback (advanced)

```bash
AETHER_BACKEND=openai
OPENAI_BASE_URL=...
OPENAI_MODEL=...
OPENAI_API_KEY=...
```

Hermes integration is the intended setup.
