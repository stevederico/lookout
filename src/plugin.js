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
      const results = new Map() // id -> result string (worker reply)
      const waiters = new Map() // id -> res (held browser long-poll)
      let seq = 0
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
            const id = `${++seq}-${Date.now()}`
            const item = { id, ...data, time: new Date().toISOString() }
            pending.push(item)
            const dest = path.resolve(server.config.root, outFile)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.writeFileSync(dest, JSON.stringify(item, null, 2))
            log(`${data.note ? `"${data.note}" — ` : ''}queued (${pending.length} pending) id=${id}`)
            return json(res, 200, { ok: true, id })
          } catch (e) {
            return json(res, 400, { ok: false, error: String(e) })
          }
        }

        // --- browser long-polls for the worker's reply ---
        if (req.method === 'GET' && url.startsWith('/wait/')) {
          const id = url.slice('/wait/'.length)
          if (results.has(id)) {
            const result = results.get(id)
            results.delete(id)
            return json(res, 200, { done: true, result })
          }
          const timer = setTimeout(() => {
            waiters.delete(id)
            json(res, 200, { done: false }) // browser retries
          }, waitMs)
          waiters.set(id, { res, timer })
          return
        }

        // --- worker claims the next pending selection ---
        if (req.method === 'GET' && url === '/next') {
          if (!pending.length) {
            res.statusCode = 204
            return res.end()
          }
          return json(res, 200, pending.shift())
        }

        // --- worker posts its reply ---
        if (req.method === 'POST' && url === '/done') {
          try {
            const { id, result } = JSON.parse(await readBody(req))
            const w = waiters.get(id)
            if (w) {
              clearTimeout(w.timer)
              waiters.delete(id)
              json(w.res, 200, { done: true, result })
            } else {
              results.set(id, result) // browser not waiting yet — stash it
            }
            log(`replied id=${id}`)
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
