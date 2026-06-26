/**
 * Returns the client-side overlay as a module string.
 * Self-contained, no dependencies. Runs only on the dev page.
 */
export function overlayClient(endpoint) {
  return `
const ENDPOINT = ${JSON.stringify(endpoint)}
let active = false
let hovered = null

// ---- styles ----
const style = document.createElement('style')
style.textContent = \`
  #lookout-badge{position:fixed;z-index:2147483647;bottom:16px;right:16px;font:600 12px/1 ui-monospace,monospace;
    padding:8px 10px;border-radius:8px;background:#111;color:#fff;cursor:pointer;user-select:none;
    box-shadow:0 2px 12px rgba(0,0,0,.3);opacity:.85}
  #lookout-badge[data-on="1"]{background:#7c3aed}
  #lookout-box{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #7c3aed;
    background:rgba(124,58,237,.12);border-radius:3px;transition:all .04s linear}
  #lookout-tag{position:fixed;z-index:2147483647;font:600 11px/1 ui-monospace,monospace;color:#fff;
    background:#7c3aed;padding:3px 6px;border-radius:4px;pointer-events:none}
  #lookout-form{position:fixed;z-index:2147483647;background:#111;color:#fff;border-radius:10px;padding:10px;
    box-shadow:0 6px 24px rgba(0,0,0,.4);width:300px;font:13px/1.4 ui-sans-serif,system-ui}
  #lookout-form textarea{width:100%;box-sizing:border-box;min-height:60px;resize:vertical;border:1px solid #333;
    border-radius:6px;background:#1a1a1a;color:#fff;padding:8px;font:13px/1.4 ui-sans-serif,system-ui}
  #lookout-form .row{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
  #lookout-form button{border:0;border-radius:6px;padding:6px 12px;font:600 12px ui-sans-serif;cursor:pointer}
  #lookout-form .send{background:#7c3aed;color:#fff}
  #lookout-form .cancel{background:#333;color:#ccc}
\`
document.head.appendChild(style)

// ---- badge ----
const badge = document.createElement('div')
badge.id = 'lookout-badge'
badge.textContent = '👁 lookout'
badge.title = 'Toggle Lookout (⌘⇧L)'
badge.onclick = () => toggle()
document.body.appendChild(badge)

let box, tag
function ensureBox() {
  if (box) return
  box = document.createElement('div'); box.id = 'lookout-box'
  tag = document.createElement('div'); tag.id = 'lookout-tag'
  document.body.append(box, tag)
}
function clearBox() {
  box && box.remove(); tag && tag.remove(); box = tag = null
}

function toggle(on) {
  active = on === undefined ? !active : on
  badge.dataset.on = active ? '1' : '0'
  if (active) { document.addEventListener('mousemove', onMove, true) }
  else { document.removeEventListener('mousemove', onMove, true); clearBox(); hovered = null }
}

function onMove(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el || el === badge || el.closest('#lookout-form')) return
  hovered = el
  ensureBox()
  const r = el.getBoundingClientRect()
  Object.assign(box.style, { left: r.left+'px', top: r.top+'px', width: r.width+'px', height: r.height+'px' })
  tag.textContent = label(el)
  tag.style.left = r.left + 'px'
  tag.style.top = Math.max(0, r.top - 22) + 'px'
}

function label(el) {
  let s = el.tagName.toLowerCase()
  if (el.id) s += '#' + el.id
  if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.')
  return s
}

// build a reasonably-unique CSS selector
function selector(el) {
  if (el.id) return '#' + el.id
  const parts = []
  let node = el
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
    let part = node.tagName.toLowerCase()
    if (node.classList.length) part += '.' + [...node.classList].slice(0,2).join('.')
    const sibs = node.parentNode ? [...node.parentNode.children].filter(c => c.tagName === node.tagName) : []
    if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node)+1) + ')'
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

document.addEventListener('click', (e) => {
  if (!active) return
  if (e.target === badge || (form && form.contains(e.target))) return
  if (!hovered) return
  e.preventDefault(); e.stopPropagation()
  openForm(hovered, e.clientX, e.clientY)
}, true)

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggle() }
  if (e.key === 'Escape') { closeForm(); toggle(false) }
}, true)

let form
function openForm(el, x, y) {
  closeForm()
  const r = el.getBoundingClientRect()
  const payload = {
    selector: selector(el),
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 200),
    html: el.outerHTML.slice(0, 1000),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    url: location.href,
  }
  form = document.createElement('div')
  form.id = 'lookout-form'
  form.innerHTML = '<div style="opacity:.6;font-size:11px;margin-bottom:6px">'+payload.selector+'</div>'
    + '<textarea placeholder="What should Grok do with this? (optional)"></textarea>'
    + '<div class="row"><button class="cancel">Cancel</button><button class="send">Send ↵</button></div>'
  document.body.appendChild(form)
  const fr = form.getBoundingClientRect()
  form.style.left = Math.min(x, window.innerWidth - fr.width - 12) + 'px'
  form.style.top = Math.min(y, window.innerHeight - fr.height - 12) + 'px'
  const ta = form.querySelector('textarea'); ta.focus()
  form.querySelector('.cancel').onclick = closeForm
  form.querySelector('.send').onclick = () => send({ ...payload, note: ta.value.trim() })
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send({ ...payload, note: ta.value.trim() }) }
  })
}
function closeForm() { form && form.remove(); form = null }

async function send(payload) {
  closeForm()
  const tSend = Date.now()
  payload.clientSent = tSend
  console.log('%c[lookout] ⏱ send @0ms', 'color:#7c3aed')
  let id
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    id = (await r.json()).id
    console.log('[lookout] ⏱ queued (id=' + id + ') @' + (Date.now() - tSend) + 'ms')
  } catch { return flash('✗ send failed', 2000) }
  flash('⏳ Grok working…', 0)
  // long-poll until the worker replies
  while (true) {
    try {
      const r = await fetch(ENDPOINT + '/wait/' + encodeURIComponent(id))
      const d = await r.json()
      if (d.done) {
        const total = Date.now() - tSend
        console.log('%c[lookout] ⏱ DONE @' + total + 'ms', 'color:#7c3aed;font-weight:700', d.timing || {})
        if (d.timing) {
          console.table({
            'wait for worker (queue→claim)': d.timing.waitMs + 'ms',
            'Grok edit (claim→done)': d.timing.editMs + 'ms',
            'server total (queue→done)': d.timing.totalMs + 'ms',
            'client round-trip (send→toast)': total + 'ms',
          })
        }
        return flash('✓ ' + (d.result || 'done') + ' · ' + total + 'ms', 5000)
      }
    } catch { return flash('✗ lost connection', 2000) }
  }
}
function flash(msg, ms) {
  const prev = '👁 lookout'
  badge.textContent = msg
  if (ms) setTimeout(() => { badge.textContent = prev }, ms)
}

console.log('%c[lookout] ready — ⌘⇧L to toggle', 'color:#7c3aed;font-weight:600')
`
}
