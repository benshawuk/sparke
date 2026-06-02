// View Transitions: fires when opted in (data-transitions), skipped under
// prefers-reduced-motion, and the swap works in both cases.
import { connect } from "./rawws.mjs";
const BASE = "http://localhost:8770/demo";
const DBG = "http://127.0.0.1:9222";
const nt = async (u) => (await fetch(`${DBG}/json/new?${encodeURIComponent(u)}`, { method: "PUT" })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(ws) {
  const c = { id: 0, p: new Map(), ws: connect(ws) };
  c.ready = new Promise((r) => c.ws.on("open", r));
  c.ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && c.p.has(m.id)) { c.p.get(m.id)(m.result); c.p.delete(m.id); } });
  c.send = (me, pa = {}) => new Promise((r) => { const id = ++c.id; c.p.set(id, r); c.ws.send(JSON.stringify({ id, method: me, params: pa })); });
  return c;
}
async function ev(c, e) {
  const r = await c.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  return r.result && r.result.value;
}
function check(label, got, want) {
  console.log(`${got === want ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(got)}${got === want ? "" : ", want " + JSON.stringify(want)})`);
}
// Spy that counts startViewTransition calls but still calls through.
const SPY = `window.__vt=0;(function(){var o=document.startViewTransition&&document.startViewTransition.bind(document);document.startViewTransition=function(cb){window.__vt++;return o?o(cb):(cb(),{updateCallbackDone:Promise.resolve()});};})();`;

// --- transitions ON, normal motion ---
{
  const t = await nt(`${BASE}/_vt1`);
  const c = mk(t.webSocketDebuggerUrl);
  await c.ready; await c.send("Runtime.enable"); await sleep(800);
  await ev(c, SPY);
  await ev(c, `document.getElementById('go').click()`);
  await sleep(700);
  check("opted-in: swap happened", await ev(c, "document.querySelector('main h1').textContent"), "VT2");
  check("opted-in: startViewTransition was used", await ev(c, "window.__vt > 0"), true);
  c.ws.close();
}

// --- reduced motion: should NOT use transitions, but still swap ---
{
  const t = await nt(`${BASE}/_vt1`);
  const c = mk(t.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await c.send("Runtime.enable"); await sleep(800);
  await ev(c, SPY);
  await ev(c, `document.getElementById('go').click()`);
  await sleep(700);
  check("reduced-motion: swap still happened", await ev(c, "document.querySelector('main h1').textContent"), "VT2");
  check("reduced-motion: startViewTransition NOT used", await ev(c, "window.__vt"), 0);
  c.ws.close();
}
