// Per-page <head> CSS: a page-specific <style>/<link> applies on swap and is
// removed when navigating to a page that doesn't have it; shared CSS stays.
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
// h1 colour: _cssa has an inline <style> making h1 rgb(255,0,0); _cssb does not.
const COLOR = "document.defaultView.getComputedStyle(document.querySelector('main h1')).color";
const HASBLOCK = `!!document.head.querySelector('style[data-marker=\"cssa\"]')`;

const t = await nt(`${BASE}/_cssa`);
const c = mk(t.webSocketDebuggerUrl);
await c.ready;
await c.send("Runtime.enable");
await sleep(900);
check("on _cssa: page-specific <style> present", await ev(c, HASBLOCK), true);
check("on _cssa: h1 is red", await ev(c, COLOR), "rgb(255, 0, 0)");
check("global style.css present", await ev(c, `!!document.head.querySelector('link[href$="style.css"]')`), true);

await ev(c, `document.getElementById('toB').click()`);
await sleep(500);
check("on _cssb: page-specific <style> removed", await ev(c, HASBLOCK), false);
check("on _cssb: h1 NOT red", await ev(c, COLOR + ` !== 'rgb(255, 0, 0)'`), true);
check("global style.css STILL present (not nuked)", await ev(c, `!!document.head.querySelector('link[href$="style.css"]')`), true);

// Back to A: page-specific style should be re-applied.
await ev(c, `document.getElementById('toA').click()`);
await sleep(500);
check("back on _cssa: <style> re-applied", await ev(c, HASBLOCK), true);
check("back on _cssa: h1 red again", await ev(c, COLOR), "rgb(255, 0, 0)");
c.ws.close();
