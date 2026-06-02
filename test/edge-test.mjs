// Verifies the edge-case fixes: #4 body-attr sync, #5 cross-page hash scroll,
// #2 focus + aria-live announce, #1 redirect handling. Expects fixtures
// /demo/_a and /demo/_b to exist and serve.py running on 8770.
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

const t = await nt(`${BASE}/_a`);
const c = mk(t.webSocketDebuggerUrl);
await c.ready;
await c.send("Runtime.enable");
await sleep(900);

check("#4 initial body class", await ev(c, "document.body.className"), "page-a");

// Click cross-page hash link to /demo/_b#target
await ev(c, `document.getElementById('toB').click()`);
await sleep(500);
check("#5 address bar keeps hash", await ev(c, "location.pathname + location.hash"), "/demo/_b#target");
check("#4 body class updated to page-b", await ev(c, "document.body.className"), "page-b");
check("#4 body data-x synced", await ev(c, "document.body.getAttribute('data-x')"), "1");
const scrolled = await ev(c, "window.scrollY > 100");
check("#5 scrolled to #target (not top)", scrolled, true);
check("#2 focus moved to <main>", await ev(c, "document.activeElement && document.activeElement.tagName"), "MAIN");
check("#2 aria-live region present", await ev(c, "!!document.getElementById('sparke-live-region')"), true);
await sleep(120);
check("#2 aria-live announced title", await ev(c, "document.getElementById('sparke-live-region').textContent"), "Page B");

c.ws.close();

// Redirect test needs a fresh page that still has the redirect link.
const t2 = await nt(`${BASE}/_a`);
const c2 = mk(t2.webSocketDebuggerUrl);
await c2.ready;
await c2.send("Runtime.enable");
await sleep(900);
await ev(c2, `document.getElementById('toRedirect').click()`); // /demo/old-about -> /demo/about
await sleep(700);
check("#1 redirect: address bar shows final URL", await ev(c2, "location.pathname"), "/demo/about");
check("#1 redirect: content is About", await ev(c2, "document.querySelector('main h1').textContent"), "About");
c2.ws.close();
