# Aether Vault

Aether Vault is a **SQLite index** of files that Hermes creates during agent sessions.

## Important

- **No file duplication.** The vault stores metadata only (path, session, size, hash, timestamps).
- **Previews read originals.** When you open a file in the vault drawer, Aether reads it directly from the path Hermes used on disk.
- **Hermes is never configured or changed.** Ingestion only reads Hermes session logs and `state.db` tool calls.
- The SQLite index lives in `data/aether.db` (`aether_vault` table).

## Browsing the vault

The full-page vault browser supports three views:

| View | Description |
|------|-------------|
| **Recent** | Flat list sorted by last update (default) |
| **Folder** | Collapsible directory tree by original file path; breadcrumbs for drill-down |
| **Session** | Files grouped by Hermes chat session |

Additional controls:

- **Search** — filter by filename, path, or session ID (client-side)
- **This session only** — limit the list to files from the active chat
- **Sort** — by date, name, or size
- **Reveal** — open the original file in Finder/Explorer from the preview panel
- **Clean up** — remove index entries whose originals were deleted from disk

## How indexing works

1. Scan recent `~/.hermes/sessions/*.json` and `~/.hermes/state.db` for tool calls (`write_file`, `patch`, `execute_code`, etc.).
2. Resolve written file paths on disk.
3. Record metadata in SQL (original path, session, size, hash, timestamps).

Sensitive paths (`.env*`, keys, Hermes internals) are ignored.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/aether/vault/files` | List indexed files (`limit`, `session_id`, `q`) |
| `GET /api/aether/vault/sessions` | Distinct sessions with file counts |
| `POST /api/aether/vault/ingest` | Scan sessions and index new/updated files |
| `POST /api/aether/vault/purge-missing` | Remove entries for deleted originals |
| `POST /api/aether/vault/reveal` | Reveal original file in Finder/Explorer (`{ id }`) |
| `GET /api/aether/vault/file?id=` | Preview original file (text/image metadata) |
| `GET /api/aether/vault/file/raw?id=` | Raw original file bytes |
