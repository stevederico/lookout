# Lookout

Point at any element in your running dev app, type a note, and have it edited — in under a second.

No browser extension. Dev-only. Ships to nobody.

## How it works

```
[browser overlay] --click+note--> [Vite bridge] --/next--> [Grok daemon] --edit--> source file
       ^                                |                        |
       |<------ ✓ result (long-poll) ---|                        |--append--> .lookout/changes.log
                                                                                      |
                                                              [self-wake watcher] --wakes--> your agent
```

- **Overlay** (injected in dev only): hover-highlight, click an element, type a note → POSTs the selection.
- **Bridge** (Vite middleware, REST + long-poll): queues selections, hands them to a worker, relays the reply back to the browser.
- **Grok daemon** (warm worker, `XAI_API_KEY`): finds the source file, asks Grok for a surgical edit, applies it. ~0.6–1s. Logs every change.
- **Supervisor loop** (optional): a debounced watcher wakes your main your agent session to review batches of edits — off the critical path, so edits stay fast.

## Why this architecture

| Worker | Speed | Context | Notes |
|---|---|---|---|
| Self-wake into a running agent session | ~18s | richest | reloads the whole chat transcript every edit — unusable |
| `your agent` | ~5s | repo only | fresh boot each click |
| **Grok daemon** | **~0.6s** | matched file (+ engine, optional) | warm, the fast path |

Speed comes from a **warm** worker holding context in memory, not a cold load or a giant transcript per edit. Your agent supervises asynchronously instead of being in the loop.

## Install

```bash
bun add -D lookout
```

## Usage

**1. Add the plugin** (overlay + bridge):

```js
// vite.config.js
import { defineConfig } from 'vite'
import lookout from 'lookout'

export default defineConfig({ plugins: [lookout()] })
```

**2. Start the daemon** (the fast editor). Needs `XAI_API_KEY` in the env or a local `.env` (copy `.env.example`; override the path with `LOOKOUT_ENV`):

```bash
LOOKOUT_ROOT="$PWD" LOOKOUT_PORT=5173 node node_modules/lookout/bin/grok-daemon.mjs
```

**3. Use it:** start dev (`bun run dev`), press **⌘⇧L** (or click the `👁 lookout` badge), click an element, type the change, Enter. Edited in <1s, page hot-reloads.

## Daemon env

| Var | Default | Meaning |
|---|---|---|
| `LOOKOUT_PORT` | `5191` | your Vite dev port |
| `LOOKOUT_ROOT` | `cwd` | project root to edit |
| `LOOKOUT_MODEL` | `grok-4.20-0309-non-reasoning` | xAI model (use `grok-4.3` for harder edits) |
| `XAI_API_KEY` | from `.env` (or `LOOKOUT_ENV`) | xAI key |

## Change log

Every applied edit is appended as JSONL to `.lookout/changes.log` (gitignored) — selector, note, file, find/replace, summary. The supervisor loop reads this to review what the daemon did.

## License

MIT
