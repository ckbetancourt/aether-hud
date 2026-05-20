# Aether HUD

Aether HUD is a voice-first browser interface for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/). You speak to the orb, read replies aloud, and browse session history in a full-screen HUD. Hermes runs the agent — models, tools, memory, and profiles. Aether runs the voice UI.

## What you need

- **Node.js** 18 or newer
- **Hermes Agent** installed (`hermes` in your terminal)
- A **Hermes API server** reachable over HTTP (OpenAI-compatible, usually `http://127.0.0.1:8000/v1`)
- A modern browser with speech recognition and synthesis (Chrome or Edge recommended)

## Quick start

1. Clone this repository and install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and point Aether at your Hermes API:

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` if your Hermes API is not on the default host:

   ```bash
   AETHER_BACKEND=hermes
   HERMES_API_BASE_URL=http://127.0.0.1:8000/v1
   PORT=8787
   ```

3. Start the HUD server:

   ```bash
   npm start
   ```

4. Open [http://localhost:8787](http://localhost:8787).

5. Use the microphone or chat panel to talk to Hermes through the HUD.

To open the browser automatically:

```bash
npm run hermes:launch
```

## How it fits together

```text
┌─────────────┐     voice / chat      ┌──────────────┐     API      ┌─────────────┐
│  Aether HUD │  ◄──────────────────► │  Aether      │  ◄────────► │   Hermes    │
│  (browser)  │                       │  server      │             │   Agent     │
└─────────────┘                       └──────────────┘             └─────────────┘
                                                                           ▲
                                                                           │
                                                                    hermes (terminal)
```

| Component | What it does |
|-----------|----------------|
| **Hermes** (`hermes`) | Agent in the terminal — tools, memory, profiles, sessions |
| **Hermes API** | HTTP bridge Aether uses for chat (`/chat/completions`) |
| **Aether server** (`npm start`) | Serves the HUD and proxies chat to Hermes |
| **Aether HUD** (browser) | Orb, voice input, text-to-speech, archives |

## Configuration

Environment variables are read from `.env` and `.env.local` (`.env.local` wins).

### Required for Hermes (typical setup)

| Variable | Default | Purpose |
|----------|---------|---------|
| `AETHER_BACKEND` | `hermes` | Use Hermes as the agent runtime |
| `HERMES_API_BASE_URL` | `http://127.0.0.1:8000/v1` | Hermes OpenAI-compatible API base URL |
| `PORT` | `8787` | Port for the Aether HUD server |

### Optional overrides

Only set these if your Hermes build requires them:

| Variable | Purpose |
|----------|---------|
| `HERMES_MODEL` | Force a specific model id (otherwise Aether picks from Hermes `/models`) |
| `HERMES_API_KEY` | Bearer token if the Hermes API requires auth |
| `HERMES_PROFILE` | Default Hermes profile for all requests (or pick one in HUD settings) |
| `HERMES_PROFILES_URL` | URL to list Hermes profiles, if not on the default API |
| `HERMES_SESSIONS_URL` | URL to list Hermes sessions for the archives drawer |
| `AETHER_TEMPERATURE` | Generation temperature for the bridge (default `0.7`) |

See [`.env.example`](.env.example) for a full template.

### Check the connection

With the server running:

```bash
curl http://localhost:8787/api/hermes/status
```

When Hermes is reachable, you should see `"connected": true`. The HUD status badge shows **HERMES** instead of **HERMES OFFLINE**.

## Using the HUD

- **Microphone** — speak a command; behavior depends on settings (send directly to Hermes or fill the chat composer first).
- **Chat panel** — type when you prefer text; collapse it for a voice-only layout.
- **Archives** — past conversations stored in the browser; Hermes-backed sessions can include Hermes session metadata when listing is configured.
- **Settings** — voice speed, Hermes profile, and microphone behavior.
- **Accent colors** — visual theme for the orb only; does not change Hermes behavior.

Replies are written for **text-to-speech**. Aether adds a small TTS prompt layer so answers sound natural when read aloud. Reference: [`TTS-Prompt.md`](TTS-Prompt.md) (runtime source: [`aether-config.js`](aether-config.js)).

## Launch from Hermes (`/aether`)

Hermes and the HUD are two programs. You can use either or both.

### Terminal: Hermes

```bash
hermes
```

Slash commands are typed **in the Hermes chat**, not in your system shell.

### Browser: Aether HUD

From this repository:

```bash
npm run hermes:launch
```

That starts the Aether server if it is not already running and opens the HUD in your browser.

### Register `/aether` in Hermes

Hermes learns slash commands from **skills** in `~/.hermes/skills/`. Install the Aether skill once:

```bash
npm run hermes:install-skill
```

Then in a Hermes session:

```bash
hermes
/aether
```

If `/aether` does not appear, run `/reload-skills` or start a new session.

Manual install:

```bash
mkdir -p ~/.hermes/skills/aether
cp hermes/SKILL.md ~/.hermes/skills/aether/SKILL.md
echo "/absolute/path/to/this/repo" > ~/.hermes/skills/aether/aether-hud-root.txt
```

More on Hermes skills: [Working with Skills](https://hermes-agent.nousresearch.com/docs/guides/work-with-skills).

## NPM scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the HUD server on `PORT` |
| `npm run hermes:launch` | Start the server if needed and open the HUD in the browser |
| `npm run hermes:install-skill` | Install the `/aether` skill into `~/.hermes/skills/` |

## OpenAI-compatible fallback (advanced)

To run the HUD against a generic OpenAI-compatible API instead of Hermes (no Hermes tools, memory, or sessions):

```bash
AETHER_BACKEND=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=your-key
```

Works with OpenRouter, Groq, Ollama, LM Studio, and similar endpoints. Hermes integration is the intended setup.
