#!/usr/bin/env node
// Lookout Grok daemon — warm worker that edits source via the xAI (Grok) API.
// Uses XAI_API_KEY (env or DefaultEnv .env).
//   node node_modules/lookout/bin/grok-daemon.mjs   (run from project root)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = process.env.LOOKOUT_PORT || '5191'
const HOST = process.env.LOOKOUT_HOST || `http://localhost:${PORT}`
const ROOT = process.env.LOOKOUT_ROOT || process.cwd()
const MODEL = process.env.LOOKOUT_MODEL || 'grok-4.20-0309-non-reasoning'
const BASE = `${HOST}/__lookout`
const API = 'https://api.x.ai/v1/chat/completions'

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`\x1b[2m${ts()}\x1b[0m \x1b[35m[lookout-grok]\x1b[0m`, ...a)

function loadKey() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY
  const f = path.join(os.homedir(), 'Dropbox/BixbyApps/DefaultEnv/.env')
  try {
    const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('XAI_API_KEY='))
    if (line) return line.slice('XAI_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '')
  } catch {}
  return null
}
const KEY = loadKey()
if (!KEY) { log('FATAL: no XAI_API_KEY (env or DefaultEnv .env)'); process.exit(1) }

// append each applied edit to a change-log the supervisor (main agent) reviews
const CHANGES = path.join(ROOT, '.lookout', 'changes.log')
function appendChange(entry) {
  try {
    fs.mkdirSync(path.dirname(CHANGES), { recursive: true })
    fs.appendFileSync(CHANGES, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

// find the source file that most likely renders this element (dependency-free walk)
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.lookout', '.next', 'coverage', '.cache'])
const SRC_EXT = /\.(html?|jsx?|tsx?|mjs|cjs|vue|svelte|astro|css|md)$/i
function* walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)) }
    else if (SRC_EXT.test(e.name)) yield path.join(dir, e.name)
  }
}
function findFile(sel) {
  const needle = (sel.text && sel.text.trim()) || (sel.html || '').replace(/<[^>]+>/g, '').trim()
  if (!needle) return null
  for (const f of walk(ROOT)) {
    try { if (fs.readFileSync(f, 'utf8').includes(needle)) return f } catch {}
  }
  return null
}

async function callGrok(file, content, sel) {
  const system =
    'You are a fast, surgical code editor. You are given ONE source file and an instruction about ONE element a developer clicked. ' +
    'Return ONLY a JSON object: {"find": "<exact unique substring from the file to replace>", "replace": "<new substring>", "summary": "<short past-tense description>"}. ' +
    'The "find" value MUST appear verbatim and uniquely in the file. Make the smallest change that satisfies the instruction.'
  const user =
    `File: ${file}\n` +
    `Element selector: ${sel.selector}\nTag: ${sel.tag}\nVisible text: ${JSON.stringify(sel.text || '')}\nOuter HTML: ${sel.html || ''}\n` +
    `Instruction: ${sel.note || '(infer the most likely change)'}\n\n` +
    `--- FILE CONTENT ---\n${content}`
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })
  if (!r.ok) throw new Error(`grok ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  const raw = data.choices?.[0]?.message?.content || ''
  const m = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(m ? m[0] : raw)
}

async function handle(sel) {
  const T = { recv: Date.now() }
  const file = await findFile(sel)
  T.found = Date.now()
  if (!file) { log(`no source file matched "${sel.text || sel.selector}"`); return { result: 'no matching file found', T } }
  const content = fs.readFileSync(file, 'utf8')
  const patch = await callGrok(file, content, sel)
  T.grok = Date.now()
  if (!patch.find || !content.includes(patch.find)) {
    log(`patch.find not found in ${path.basename(file)}`)
    return { result: 'could not locate edit point', T, file }
  }
  fs.writeFileSync(file, content.replace(patch.find, patch.replace))
  T.applied = Date.now()
  const summary = patch.summary || `edited ${path.basename(file)}`
  appendChange({ id: sel.id, file: path.relative(ROOT, file), selector: sel.selector, note: sel.note || '', summary, find: patch.find, replace: patch.replace })
  return { result: summary, T, file }
}

async function poll() {
  log(`watching ${BASE} · model=${MODEL} · root=${ROOT}`)
  for (;;) {
    let sel
    try {
      const r = await fetch(`${BASE}/next`)
      if (r.status !== 200) continue
      sel = await r.json()
    } catch { await new Promise((res) => setTimeout(res, 1000)); continue }
    log(`got: ${sel.note ? `"${sel.note}"` : sel.selector}`)
    let result = 'error'
    let T = { recv: Date.now() }
    try { ({ result, T } = await handle(sel)) } catch (e) { result = `error: ${e.message}`; log(result) }
    const find = (T.found || T.recv) - T.recv
    const grok = T.grok ? T.grok - (T.found || T.recv) : 0
    const apply = T.applied ? T.applied - T.grok : 0
    const total = Date.now() - T.recv
    log(`done — find=${find}ms grok=${grok}ms apply=${apply}ms total=${total}ms — ${result}`)
    try {
      await fetch(`${BASE}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sel.id, result: `${result} (${(total / 1000).toFixed(1)}s)` }),
      })
    } catch {}
  }
}

poll()
