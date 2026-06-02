// #3 race: a slow earlier navigation must NOT land on top of a later one.
// #7 cancel: preventDefault on sparke:before-swap keeps the user put (no reload).
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

// --- #3 race ---------------------------------------------------------------
{
  const t = await nt(`${BASE}/_race`);
  const c = mk(t.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await sleep(300); // sparke loaded; slow link's preload (800ms) NOT done yet
  await ev(c, `document.getElementById('slow').click()`); // token 1, 800ms fetch
  await sleep(60);
  await ev(c, `document.getElementById('fast').click()`); // token 2, resolves first
  await sleep(1400); // let the slow fetch resolve too
  check("#3 ended on the LATER (fast) page", await ev(c, "location.pathname"), "/demo/_fastpage");
  check("#3 content is Fast (slow didn't clobber)", await ev(c, "document.querySelector('main h1').textContent"), "Fast");
  c.ws.close();
}

// --- #7 before-swap cancel -------------------------------------------------
{
  const t = await nt(`${BASE}/_guard`);
  const c = mk(t.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await sleep(400);
  c.ev.length = 0; // watch for a full reload from here
  await ev(c, `document.getElementById('go').click()`);
  await sleep(400);
  const reloaded = c.ev.filter((e) => e.method === "Page.loadEventFired").length > 0;
  check("#7 cancel keeps you on the page", await ev(c, "location.pathname"), "/demo/_guard");
  check("#7 content unchanged", await ev(c, "document.querySelector('main h1').textContent"), "Guard");
  check("#7 no full reload happened", reloaded, false);
  c.ws.close();
}
