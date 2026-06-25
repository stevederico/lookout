#!/usr/bin/env node
// Lookout worker — drains selections from the bridge and applies them with `agent`.
// Run from your project root (or pass LOOKOUT_ROOT):  node node_modules/lookout/bin/worker.mjs
import { spawn } from 'node:child_process'

const PORT = process.env.LOOKOUT_PORT || '5191'
const HOST = process.env.LOOKOUT_HOST || `http://localhost:${PORT}`
const ROOT = process.env.LOOKOUT_ROOT || process.cwd()
const MODEL = process.env.LOOKOUT_MODEL || 'haiku'
const BASE = `${HOST}/__lookout`

const ts = () => new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
const log = (...a) => console.log(`\x1b[2m${ts()}\x1b[0m \x1b[35m[lookout-worker]\x1b[0m`, ...a)

function buildPrompt(sel) {
  return [
    `You are editing the source of a web app running locally. A developer clicked an element in the browser and left an instruction. Find the element in the source and apply the change.`,
    ``,
    `Element selector: ${sel.selector}`,
    `Tag: ${sel.tag}`,
    `Visible text: ${JSON.stringify(sel.text || '')}`,
    `Outer HTML: ${sel.html || ''}`,
    `Page URL: ${sel.url || ''}`,
    ``,
    `Instruction: ${sel.note || '(no note — infer the most likely intended change)'}`,
    ``,
    `Edit the correct source file to satisfy the instruction. Do not touch anything else. When done, reply with ONE short line describing what you changed.`,
  ].join('\n')
}

function runAgent(prompt) {
  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      '--model', MODEL,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Edit', 'Read', 'Grep', 'Glob',
    ]
    const tSpawn = Date.now()
    const child = spawn('agent', args, { cwd: ROOT })
    let out = '', err = '', firstByte = 0
    child.stdout.on('data', (d) => {
      if (!firstByte) { firstByte = Date.now(); log(`  agent first output: +${firstByte - tSpawn}ms`) }
      out += d
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      log(`  agent exited: +${Date.now() - tSpawn}ms (code ${code})`)
      const line = out.trim().split('\n').filter(Boolean).pop() || (code === 0 ? 'done' : 'edit failed')
      resolve({ code, line, err })
    })
    child.on('error', (e) => resolve({ code: -1, line: 'agent not found', err: String(e) }))
  })
}

async function loop() {
  log(`watching ${BASE} · model=${MODEL} · root=${ROOT}`)
  for (;;) {
    let sel
    try {
      const r = await fetch(`${BASE}/next`) // long-polls server-side (~25s) then 204
      if (r.status !== 200) continue
      sel = await r.json()
    } catch {
      await new Promise((res) => setTimeout(res, 1000)) // bridge down — back off
      continue
    }
    log(`got: ${sel.note ? `"${sel.note}"` : sel.selector}`)
    const t0 = Date.now()
    const { line } = await runAgent(buildPrompt(sel))
    const editMs = Date.now() - t0
    try {
      await fetch(`${BASE}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sel.id, result: `${line} (${(editMs / 1000).toFixed(1)}s)` }),
      })
    } catch {}
    log(`replied: +${Date.now() - t0 - editMs}ms · total ${((Date.now() - t0) / 1000).toFixed(1)}s — ${line}`)
  }
}

loop()
