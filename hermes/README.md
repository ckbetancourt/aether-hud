# Hermes integration for Aether HUD

Aether does **not** connect to the `hermes` chat CLI directly. It connects to the **Hermes API server**, which only runs when you start the **gateway**.

## What runs where

| Process | Command | Purpose |
|---------|---------|---------|
| Hermes gateway | `hermes gateway` | Exposes OpenAI-compatible API (default `http://127.0.0.1:8642/v1`) |
| Hermes dashboard (optional) | `hermes dashboard` | Session list + message history for HUD restore on reload (default `http://127.0.0.1:9119`) |
| Hermes chat (optional) | `hermes` | Terminal agent; `/aether` skill launches the HUD |
| Aether HUD server | `npm start` | Browser UI + proxy to Hermes API |

Running `hermes` alone does **not** start the API that Aether needs.

## One-time: enable Hermes API

Edit `~/.hermes/.env` (create the file if needed):

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
```

Use any secret string for `API_SERVER_KEY`. You will copy the same value into Aether’s `.env.local`.

Optional: change port (default `8642`):

```bash
API_SERVER_PORT=8642
```

## Every session: start gateway

In a dedicated terminal (leave it open):

```bash
hermes gateway
```

You should see:

```text
[API Server] API server listening on http://127.0.0.1:8642
```

Test:

```bash
curl http://127.0.0.1:8642/v1/health \
  -H "Authorization: Bearer change-me-local-dev"
```

## Configure Aether

In this repo, `.env.local`:

```bash
AETHER_BACKEND=hermes
HERMES_API_BASE_URL=http://127.0.0.1:8642/v1
HERMES_API_KEY=change-me-local-dev
PORT=8787
```

`HERMES_API_KEY` must match `API_SERVER_KEY` in `~/.hermes/.env`.

Then:

```bash
npm run hermes:doctor
npm start
```

## Session restore on reload

The Hermes **gateway** handles chat continuity (`X-Hermes-Session-Id`), but it does **not** expose a session list API. To import and resume Hermes sessions in the Aether Archives on page load, also run the **web dashboard** in another terminal:

```bash
hermes dashboard
```

Aether auto-probes `http://127.0.0.1:9119/api/sessions` (override with `HERMES_DASHBOARD_URL` or `HERMES_SESSIONS_URL` in `.env.local`). When the dashboard is running, the HUD imports session metadata and message history before restoring your active session.

If the dashboard is not running, the HUD still works with locally cached archives only.

Docs: [Hermes Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)

## Model picker in the HUD

The bottom control pill shows the **current model**. Click it to open a Hermes-style picker (provider → model, search filter, custom model name).

| Capability | Requires |
|------------|----------|
| Full provider + curated model lists | `hermes dashboard` **or** installed Hermes CLI (`~/.hermes/hermes-agent`) |
| Switch model | Dashboard **or** Hermes CLI (writes `~/.hermes/config.yaml`) |
| Fallback list when dashboard is offline | Reads actual model from `config.yaml` via Hermes CLI; gateway `/v1/models` only advertises `hermes-agent` |

**Persist globally** (checkbox in the picker, default off):

- **Checked**: writes to `config.yaml` — applies to new gateway sessions (Hermes dashboard behavior).
- **Unchecked**: session-only preference in the HUD; inference still updates via config when switching through the gateway API (same practical constraint as the Hermes Models page vs in-chat `/model`).

Recommended: run both `hermes gateway` and `hermes dashboard` for the full experience.

## `/aether` slash command

Install the skill (separate from API wiring):

```bash
npm run hermes:install-skill
```

Then in `hermes` chat: `/aether`

## Hermes profiles

Hermes profiles are separate agent instances. Each profile’s gateway can use its own port and API key. The HUD profile dropdown only applies if you point Aether at that profile’s API URL (or set `HERMES_PROFILE` when your build supports it). Listing profiles via HTTP is optional and often not configured.

Docs: [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
