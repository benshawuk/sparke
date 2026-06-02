// #19: navigate to a page whose fetch is slow (still preloading / not cached).
// Confirms: the OLD page stays fully visible (never blank, no spinner) until the
// new content arrives, then swaps; sparke:navigate fires up front (loading hook).
import { connect } from "./rawws.mjs";
const BASE = "http://localhost:8770/demo";
const DBG = "http://127.0.0.1:9222";
const nt = async (u) => (await fetch(`${DBG}/json/new?${encodeURIComponent(u)}`, { method: "PUT" })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(ws) {
  const c = { id: 0, p: new Map(), ws: connect(ws), ev: [] };
  c.ready = new Promise((r) => c.ws.on("open", r));
  c.ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && c.p.has(m.id)) { c.p.get(m.id)(m.result); c.p.delete(m.id); } else if (m.method) c.ev.push(m); });
  c.send = (me, pa = {}) => new Promise((r) => { const id = ++c.id; c.p.set(id, r); c.ws.send(JSON.stringify({ id, method: me, params: pa })); });
  return c;
}
async function ev(c, e) {
  const r = await c.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result && r.result.value;
}
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(got)}${ok ? "" : ", want " + JSON.stringify(want)})`);
}

const t = await nt(`${BASE}/_launch`);
const c = mk(t.webSocketDebuggerUrl);
await c.ready;
await c.send("Page.enable");
await c.send("Runtime.enable");
await sleep(400);

// Record when sparke:navigate fires (the loading-indicator hook).
await ev(c, `window.__navFired=false; window.addEventListener('sparke:navigate',()=>window.__navFired=true);`);
c.ev.length = 0;
await ev(c, `document.getElementById('go').click()`); // target has ?delay=1500

// Mid-fetch (well before 1500ms): old page must still be fully there.
await sleep(400);
check("mid-fetch: still on the old URL", await ev(c, "location.pathname"), "/demo/_launch");
check("mid-fetch: old content still shown", await ev(c, "document.querySelector('main h1').textContent"), "Launch");
check("mid-fetch: page not blank", await ev(c, "document.querySelector('main') !== null"), true);
check("sparke:navigate fired up front (loading hook)", await ev(c, "window.__navFired"), true);

// Poll until it swaps, logging when (delay is 1500ms).
const start = Date.now();
let swappedAt = null;
for (let i = 0; i < 20; i++) {
  await sleep(250);
  const p = await ev(c, "location.pathname");
  if (p === "/demo/_slowpage") { swappedAt = Date.now() - start; break; }
}
console.log(swappedAt === null ? "NEVER swapped within 5s" : `swapped ~${swappedAt}ms after first poll (server delay=1500ms)`);
check("eventually swapped to slow page", await ev(c, "location.pathname"), "/demo/_slowpage");
const reloaded = c.ev.filter((e) => e.method === "Page.loadEventFired").length > 0;
check("it was a swap, not a full reload", reloaded, false);
c.ws.close();
