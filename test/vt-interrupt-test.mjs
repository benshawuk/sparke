// Bug: clicking DURING a view transition was swallowed by the snapshot overlay.
// Fix: ::view-transition{pointer-events:none}. Verified with REAL mouse events
// (synthetic .click() bypasses hit-testing, so it wouldn't reproduce this).
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
async function realClick(c, sel, gap) {
  const b = await ev(c, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!b) { console.log("  (no element " + sel + ")"); return; }
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(gap || 0); // realistic press->release gap, so skipTransition can restore hit-testing
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
}
function check(label, got, want) {
  console.log(`${got === want ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(got)}${got === want ? "" : ", want " + JSON.stringify(want)})`);
}

const t = await nt(`${BASE}/_vt1`);
const c = mk(t.webSocketDebuggerUrl);
await c.ready;
await c.send("Runtime.enable");
await sleep(800);

// Start a deliberately long (1s) transition vt1 -> vt2.
await realClick(c, "#go");
await sleep(250); // mid-transition
check("first nav happened (on vt2)", await ev(c, "location.pathname"), "/demo/_vt2");

const backAt = `(()=>{const e=document.querySelector('#back');const r=e.getBoundingClientRect();const a=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return a?(a.id||a.tagName):null;})()`;
// Mid-transition the page is inert (the snapshot covers the live DOM).
check("during transition: page inert (link not hit-testable)", (await ev(c, backAt)) === "back", false);

// A SINGLE click during the transition should take over: skip the old
// transition and navigate to the link under the pointer.
await realClick(c, "#back");
await sleep(600);
check("mid-transition click takes over and navigates", await ev(c, "location.pathname"), "/demo/_vt1");
c.ws.close();
