// Zero-dependency Chrome DevTools Protocol driver to reproduce the tab bug.
// Launches nothing itself; expects Chrome already running with --remote-debugging-port=9222
// and a static server on http://localhost:8770.
import { connect } from "./rawws.mjs";

const BASE = "http://localhost:8770/demo";
const DBG = "http://127.0.0.1:9222";

async function newTarget(url) {
  const res = await fetch(`${DBG}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) {
    // Older Chrome uses GET for /json/new
    const r2 = await fetch(`${DBG}/json/new?${encodeURIComponent(url)}`);
    return r2.json();
  }
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = connect(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((res) => this.ws.on("open", res));
    this.ws.on("close", () => console.error("ws CLOSED"));
    this.ws.on("error", (e) => console.error("ws error", e.message || e));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  drain(method) {
    const out = this.events.filter((e) => e.method === method);
    return out;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text || JSON.stringify(r.exceptionDetails) };
  return { value: r.result.value };
}

const START = process.argv[2] || "profile";

async function run() {
  console.error("stage: newTarget (start=" + START + ")");
  const target = await newTarget(`${BASE}/tabs-${START}`); // clean URL (no .html)
  console.error("stage: target", JSON.stringify(target).slice(0, 200));
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  console.error("stage: ws open");
  await cdp.send("Page.enable");
  console.error("stage: Page.enable ok");
  await cdp.send("Runtime.enable");
  console.error("stage: Runtime.enable ok");
  await cdp.send("Log.enable");
  console.error("stage: Log.enable ok");
  await sleep(1200); // initial load + preload

  // Visit each other tab and return to the START page each time, so we can see
  // whether the START page (the seeded one) is the one that goes stale.
  const others = ["profile", "dashboard", "settings", "contacts"].filter((s) => s !== START);
  const sequence = [];
  for (const o of others) { sequence.push(o, START); }
  console.log("start:", (await evaluate(cdp, "location.pathname")).value);

  for (const slug of sequence) {
    cdp.events.length = 0; // reset event buffer
    const before = (await evaluate(cdp, "location.pathname")).value;
    const click = await evaluate(
      cdp,
      `(() => { const a=[...document.querySelectorAll('.tabs a')].find(x=>x.getAttribute('href')==='/demo/tabs-${slug}'); if(!a) return 'NO LINK'; a.click(); return 'clicked'; })()`
    );
    await sleep(600);
    const after = (await evaluate(cdp, "location.pathname")).value;
    const heading = (await evaluate(cdp, "document.querySelector('main h2') && document.querySelector('main h2').textContent")).value;
    const fullLoad = cdp.drain("Page.loadEventFired").length > 0;
    const errors = cdp.drain("Log.entryAdded")
      .filter((e) => e.params.entry.level === "error")
      .map((e) => e.params.entry.text);
    const exceptions = cdp.drain("Runtime.exceptionThrown").map(
      (e) => e.params.exceptionDetails.text + " " + (e.params.exceptionDetails.exception?.description || "")
    );

    const expected = slug.charAt(0).toUpperCase() + slug.slice(1);
    const ok = String(heading) === expected;
    console.log(
      `click ${slug.padEnd(9)} | ${before.replace("/demo/", "")} -> ${after.replace("/demo/", "")} | panel=${String(heading).padEnd(9)} | ${
        ok ? "OK  " : "STALE!"
      } | ${fullLoad ? "FULL-RELOAD" : "swap"}${errors.length ? " ERR:" + errors.join("; ") : ""}${exceptions.length ? " EXC:" + exceptions.join("; ") : ""}`
    );
  }

  cdp.ws.close();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
