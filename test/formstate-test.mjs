// The reported bug: type into the search form, submit, press Back -> the form
// values should be restored (as bfcache does when Sparke is off).
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

const t = await nt(`${BASE}/search`);
const c = mk(t.webSocketDebuggerUrl);
await c.ready;
await c.send("Runtime.enable");
await sleep(900);

// Fill the form and submit.
await ev(c, `document.getElementById('q').value='hello world';
            document.querySelector('select[name=cat]').value='docs';
            document.querySelector('input[name=exact]').checked=true;
            document.querySelector('button[type=submit]').click();`);
await sleep(600);
check("submitted -> on results", await ev(c, "location.pathname"), "/demo/results");

// Press Back.
await ev(c, "history.back()");
await sleep(600);
check("back -> on search", await ev(c, "location.pathname"), "/demo/search");
check("text field restored", await ev(c, "document.getElementById('q').value"), "hello world");
check("select restored", await ev(c, "document.querySelector('select[name=cat]').value"), "docs");
check("checkbox restored", await ev(c, "document.querySelector('input[name=exact]').checked"), true);
c.ws.close();
