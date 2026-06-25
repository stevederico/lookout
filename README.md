# Lookout

your agent's eyes on your browser. A dev-only overlay that lets you point at any element on your localhost app and send it — with a note — straight to your agent.

No browser extension. Loads only in dev, ships to nobody.

## How it works

1. **Overlay** (injected JS) highlights the element under your cursor; click to select, type a note.
2. **Bridge** (tiny local server) receives the selection and writes it to a file (or exposes it as an MCP tool).
3. **Your agent reads** the selection → sees the element + your note → edits the right source.

## Status

Early scaffold.
