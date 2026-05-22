# Aether Vault

Aether Vault is a **SQLite index** of files that Hermes creates during agent sessions.

## Important

- **No file duplication.** The vault stores metadata only (path, session, size, hash, timestamps).
- **Previews read originals.** When you open a file in the vault drawer, Aether reads it directly from the path Hermes used on disk.
- **Hermes is never configured or changed.** Ingestion only reads Hermes session logs and `state.db` tool calls.
- The SQLite index lives in `data/aether.db` (`aether_vault` table).

## How indexing works

1. Scan recent `~/.hermes/sessions/*.json` and `~/.hermes/state.db` for tool calls (`write_file`, `patch`, `execute_code`, etc.).
2. Resolve written file paths on disk.
3. Record metadata in SQL (original path, session, size, hash, timestamps).

Sensitive paths (`.env*`, keys, Hermes internals) are ignored.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/aether/vault/files` | List indexed files |
| `POST /api/aether/vault/ingest` | Scan sessions and index new/updated files |
| `GET /api/aether/vault/file?id=` | Preview original file (text/image metadata) |
| `GET /api/aether/vault/file/raw?id=` | Raw original file bytes |
