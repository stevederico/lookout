import fs from 'node:fs'
import path from 'node:path'
import { overlayClient } from './overlay.js'

const VIRTUAL_ID = 'virtual:lookout-overlay'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * Lookout — dev-only Vite plugin.
 * Injects a click-to-select overlay and writes the picked element + your note
 * to a JSON file your agent can read.
 *
 * @param {object} [opts]
 * @param {string} [opts.outFile='.lookout/selection.json'] where selections land (relative to project root)
 * @param {string} [opts.hotkey='cmd+shift+l'] toggle key for edit mode (informational; handled in overlay)
 */
export default function lookout(opts = {}) {
  const outFile = opts.outFile || '.lookout/selection.json'
  const endpoint = '/__lookout'

  return {
    name: 'lookout',
    apply: 'serve', // dev server only — never in a production build

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id === RESOLVED_ID) return overlayClient(endpoint)
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/@id/' + VIRTUAL_ID },
          injectTo: 'body',
        },
      ]
    },

    configureServer(server) {
      server.middlewares.use(endpoint, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const dest = path.resolve(server.config.root, outFile)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            const stamped = { ...data, time: new Date().toISOString() }
            fs.writeFileSync(dest, JSON.stringify(stamped, null, 2))
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            server.config.logger.info(
              `  \x1b[35m[lookout]\x1b[0m ${data.note ? `"${data.note}" — ` : ''}selection saved → ${outFile}`,
            )
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      })
    },
  }
}
