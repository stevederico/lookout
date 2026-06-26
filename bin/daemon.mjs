#!/usr/bin/env node
// Lookout daemon — ONE warm your agent session that edits on each selection.
// Pays the model/session boot once, then every click is fast.
//   node node_modules/lookout/bin/daemon.mjs   (run from project root)
import { query } from 'agent-sdk'

const PORT = process.env.LOOKOUT_PORT || '5191'
const HOST = process.env.LOOKOUT_HOST || `http://localhost:${PORT}`
const ROOT = process.env.LOOKOUT_ROOT || process.cwd()
const MODEL = process.env.LOOKOUT_MODEL || 'haiku'
const BASE = `${HOST}/__lookout`

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`\x1b[2m${ts()}\x1b[0m \x1b[35m[lookout-daemon]\x1b[0m`, ...a)

function buildPrompt(sel) {
  return [
    `A developer clicked an element in their running web app and left an instruction. Find the element in the source and apply the change. Touch nothing else.`,
    ``,
    `Selector: ${sel.selector}`,
    `Tag: ${sel.tag}`,
    `Visible text: ${JSON.stringify(sel.text || '')}`,
    `Outer HTML: ${sel.html || ''}`,
    `Page URL: ${sel.url || ''}`,
    `Instruction: ${sel.note || '(no note — infer the most likely change)'}`,
    ``,
    `Reply with ONE short line describing what you changed.`,
  ].join('\n')
}

// push-driven async stream of user messages (keeps the session open)
function pushStream() {
  const buf = []
  let wake = null
  const it = (async function* () {
    for (;;) {
      while (buf.length) yield buf.shift()
      await new Promise((r) => (wake = r))
    }
  })()
  return {
    it,
    push(content) {
      buf.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
      if (wake) { const r = wake; wake = null; r() }
    },
  }
}

const inflight = [] // FIFO of selection ids awaiting a result
const stream = pushStream()

const q = query({
  prompt: stream.it,
  options: {
    model: MODEL,
    cwd: ROOT,
    allowedTools: ['Edit', 'Read', 'Grep', 'Glob'],
    permissionMode: 'acceptEdits',
    settingSources: [], // skip global/user/project AGENTS.md — the slow part
    systemPrompt:
      'You are Lookout, a fast inline web editor. Make the smallest correct source edit to satisfy the instruction, then reply with one short line. Do not explain.',
  },
})

// consume results and reply to the browser
async function consume() {
  try {
  for await (const m of q) {
    if (m.type !== 'result') { log(`sdk msg: ${m.type}${m.subtype ? '/' + m.subtype : ''}`); continue }
    {
      const id = inflight.shift()
      const result = (m.result || 'done').trim().split('\n').pop()
      const secs = (m.duration_ms / 1000).toFixed(1)
      log(`done in ${secs}s — ${result}`)
      if (id) {
        try {
          await fetch(`${BASE}/done`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, result: `${result} (${secs}s)` }),
          })
        } catch {}
      }
    }
  }
  } catch (e) {
    log(`SDK ERROR: ${e?.message || e}`)
  }
  log('consume loop ended')
}

// poll the bridge for selections and feed the warm session
async function poll() {
  log(`watching ${BASE} · model=${MODEL} · root=${ROOT} (warming…)`)
  for (;;) {
    let sel
    try {
      const r = await fetch(`${BASE}/next`)
      if (r.status !== 200) continue
      sel = await r.json()
    } catch {
      await new Promise((res) => setTimeout(res, 1000))
      continue
    }
    log(`got: ${sel.note ? `"${sel.note}"` : sel.selector}`)
    inflight.push(sel.id)
    stream.push(buildPrompt(sel))
  }
}

consume()
poll()
