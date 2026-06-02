// Drives the GET-form demo to confirm: submitting swaps (no full reload) and
// the resulting URL carries the serialized fields (incl. the submit button).
import { connect } from "./rawws.mjs";

const BASE = "http://localhost:8770/demo";
const DBG = "http://127.0.0.1:9222";

async function newTarget(url) {
  const res = await fetch(`${DBG}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = connect(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((r) => this.ws.on("open", r));
    this.ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.id && this.pending.has(m.id)) this.pending.get(m.id).call(null, m.result), this.pending.delete(m.id);
      else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evl(cdp, expr) {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.value;
}

const t = await newTarget(`${BASE}/search`);
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await sleep(1000);

console.log("start:", await evl(cdp, "location.pathname + location.search"));

cdp.events.length = 0;
await evl(cdp, `(()=>{ document.getElementById('q').value='hello world'; document.querySelector('select').value='docs'; document.querySelector('button[type=submit]').click(); return 1; })()`);
await sleep(600);

const after = await evl(cdp, "location.pathname + location.search");
const heading = await evl(cdp, "document.querySelector('main h1').textContent");
const results = await evl(cdp, "(document.getElementById('results')||{}).innerText || '(no #results)'");
const fullLoad = cdp.events.filter((e) => e.method === "Page.loadEventFired").length > 0;

console.log("after submit:", after);
console.log("panel h1:", heading);
console.log("#results renders:", JSON.stringify(results));
console.log(fullLoad ? "RESULT: FULL RELOAD (bad)" : "RESULT: swap, no reload (good)");
cdp.ws.close();
