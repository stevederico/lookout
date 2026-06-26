import fs from 'node:fs'
import path from 'node:path'
import { overlayClient } from './overlay.js'

const VIRTUAL_ID = 'virtual:lookout-overlay'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * Lookout — dev-only Vite plugin.
 * Click-to-select overlay + a small REST bridge with long-polling so the browser
 * can wait for your agent's reply.
 *
 * Browser endpoints:
 *   POST /__lookout            submit a selection → { id }
 *   GET  /__lookout/wait/:id   long-poll for the result → { done, result }
 *
 * Worker endpoints (your agent / wake-loop):
 *   GET  /__lookout/next       claim the oldest pending selection → selection | 204
 *   POST /__lookout/done       { id, result } → resolves the browser's wait
 *
 * @param {object} [opts]
 * @param {string} [opts.outFile='.lookout/selection.json'] latest selection, for inspection
 * @param {number} [opts.waitMs=25000] long-poll hold time before telling the browser to retry
 */
export default function lookout(opts = {}) {
  const outFile = opts.outFile || '.lookout/selection.json'
  const waitMs = opts.waitMs || 25000

  return {
    name: 'lookout',
    apply: 'serve',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) return overlayClient('/__lookout')
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/@id/' + VIRTUAL_ID }, injectTo: 'body' }]
    },

    configureServer(server) {
      const pending = [] // selections awaiting a worker
      const results = new Map() // id -> { result, timing } (worker reply)
      const waiters = new Map() // id -> res (held browser long-poll)
      const nextWaiters = [] // held worker /next long-polls: { res, timer }
      const timeline = new Map() // id -> { queued, claimed, done } (ms epoch)
      let seq = 0
      const markClaimed = (id) => {
        const tl = timeline.get(id)
        if (tl && !tl.claimed) tl.claimed = Date.now()
      }
      const log = (m) => server.config.logger.info(`  \x1b[35m[lookout]\x1b[0m ${m}`)

      const readBody = (req) =>
        new Promise((resolve) => {
          let b = ''
          req.on('data', (c) => (b += c))
          req.on('end', () => resolve(b))
        })
      const json = (res, code, obj) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(obj))
      }

      server.middlewares.use('/__lookout', async (req, res) => {
        const url = (req.url || '/').split('?')[0]

        // --- browser submits a selection ---
        if (req.method === 'POST' && url === '/') {
          try {
            const data = JSON.parse(await readBody(req))
            const now = Date.now()
            const id = `${++seq}-${now}`
            const item = { id, ...data, time: new Date().toISOString() }
            timeline.set(id, { queued: now })
            const dest = path.resolve(server.config.root, outFile)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.writeFileSync(dest, JSON.stringify(item, null, 2))
            // hand straight to a waiting worker if one is parked on /next
            const w = nextWaiters.shift()
            if (w) {
              clearTimeout(w.timer)
              markClaimed(id)
              json(w.res, 200, item)
            } else {
              pending.push(item)
            }
            log(`${data.note ? `"${data.note}" — ` : ''}queued id=${id}`)
            return json(res, 200, { ok: true, id })
          } catch (e) {
            return json(res, 400, { ok: false, error: String(e) })
          }
        }

        // --- browser long-polls for the worker's reply ---
        if (req.method === 'GET' && url.startsWith('/wait/')) {
          const id = url.slice('/wait/'.length)
          if (results.has(id)) {
            const payload = results.get(id)
            results.delete(id)
            return json(res, 200, payload)
          }
          const timer = setTimeout(() => {
            waiters.delete(id)
            json(res, 200, { done: false }) // browser retries
          }, waitMs)
          waiters.set(id, { res, timer })
          res.on('close', () => { // client disconnected — don't reply to a dead socket
            if (waiters.get(id)?.res === res) { clearTimeout(timer); waiters.delete(id) }
          })
          return
        }

        // --- worker claims the next pending selection (long-polls if none) ---
        if (req.method === 'GET' && url === '/next') {
          if (pending.length) {
            const item = pending.shift()
            markClaimed(item.id)
            return json(res, 200, item)
          }
          const entry = { res, timer: null }
          entry.timer = setTimeout(() => {
            const i = nextWaiters.indexOf(entry)
            if (i >= 0) nextWaiters.splice(i, 1)
            res.statusCode = 204
            res.end() // worker re-polls
          }, waitMs)
          nextWaiters.push(entry)
          res.on('close', () => { // worker disconnected — drop stale waiter so items aren't lost to it
            const i = nextWaiters.indexOf(entry)
            if (i >= 0) { clearTimeout(entry.timer); nextWaiters.splice(i, 1) }
          })
          return
        }

        // --- worker posts its reply ---
        if (req.method === 'POST' && url === '/done') {
          try {
            const { id, result } = JSON.parse(await readBody(req))
            const tl = timeline.get(id) || {}
            tl.done = Date.now()
            const timing = {
              waitMs: tl.claimed && tl.queued ? tl.claimed - tl.queued : null,
              editMs: tl.done && tl.claimed ? tl.done - tl.claimed : null,
              totalMs: tl.done && tl.queued ? tl.done - tl.queued : null,
            }
            timeline.delete(id)
            const payload = { done: true, result, timing }
            const w = waiters.get(id)
            if (w) {
              clearTimeout(w.timer)
              waiters.delete(id)
              json(w.res, 200, payload)
            } else {
              results.set(id, payload) // browser not waiting yet — stash it
            }
            log(`replied id=${id} · wait=${timing.waitMs}ms edit=${timing.editMs}ms total=${timing.totalMs}ms`)
            return json(res, 200, { ok: true })
          } catch (e) {
            return json(res, 400, { ok: false, error: String(e) })
          }
        }

        res.statusCode = 404
        res.end()
      })
    },
  }
}
