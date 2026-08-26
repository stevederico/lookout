#!/usr/bin/env node
// Live ping of the default Lookout model. Needs XAI_API_KEY or lookout/.env.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const daemon = fs.readFileSync(path.join(root, 'bin/grok-daemon.mjs'), 'utf8')
const m = daemon.match(/LOOKOUT_MODEL \|\| '([^']+)'/)
if (!m || m[1] !== 'grok-4.6') {
  console.error(`FAIL default model is ${m?.[1] ?? 'missing'}, want grok-4.6`)
  process.exit(1)
}

function loadKey() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY
  const f = path.join(root, '.env')
  try {
    const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('XAI_API_KEY='))
    if (line) return line.slice('XAI_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '')
  } catch {}
  return null
}

const key = loadKey()
if (!key) {
  console.log('ok  default model grok-4.6 (skip live ping — no key)')
  process.exit(0)
}

const r = await fetch('https://api.x.ai/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'grok-4.6',
    messages: [
      { role: 'system', content: 'Return ONLY {"ok":true}' },
      { role: 'user', content: 'ping' },
    ],
    response_format: { type: 'json_object' },
    reasoning_effort: 'low',
  }),
})
if (!r.ok) {
  console.error(`FAIL grok-4.6 ${r.status}: ${(await r.text()).slice(0, 200)}`)
  process.exit(1)
}
const data = await r.json()
const raw = data.choices?.[0]?.message?.content || ''
if (!raw.includes('"ok"')) {
  console.error('FAIL unexpected body')
  process.exit(1)
}
console.log('ok  grok-4.6 live')
