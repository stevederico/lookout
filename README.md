# Lookout

your agent's eyes on your browser. A dev-only Vite overlay that lets you point at any element on your localhost app and send it — with a note — straight to your agent.

No browser extension. Loads only in dev, ships to nobody.

## How it works

1. **Overlay** (injected in dev) highlights the element under your cursor; click to select, type a note.
2. **Bridge** (the plugin's dev-server middleware) writes the selection to `.lookout/selection.json`.
3. **Your agent reads** that file → sees the element + your note → edits the right source.

## Install

```bash
bun add -D lookout
```

## Usage

```js
// vite.config.js
import { defineConfig } from 'vite'
import lookout from 'lookout'

export default defineConfig({
  plugins: [lookout()],
})
```

Start dev (`bun run dev`), then:

- Press **⌘⇧L** (or click the `👁 lookout` badge) to toggle select mode.
- Hover to highlight, **click** an element.
- Type a note (optional) → **Enter** to send.
- Selection lands in `.lookout/selection.json`.

Then tell your agent: **"read the lookout selection"** — it picks up the element + note and acts.

## Options

```js
lookout({
  outFile: '.lookout/selection.json', // where selections are written (relative to project root)
})
```

## Selection shape

```json
{
  "selector": "main > div.card:nth-of-type(2) > button",
  "tag": "button",
  "text": "Submit",
  "html": "<button class=\"card\">Submit</button>",
  "rect": { "x": 120, "y": 340, "w": 90, "h": 36 },
  "url": "http://localhost:5173/",
  "note": "make this bigger and primary-colored",
  "time": "2026-06-25T00:00:00.000Z"
}
```

## License

MIT
