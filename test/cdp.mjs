// Shared Chrome DevTools Protocol helper for the Sparke test suite.
//
// The existing modules (cdp-test, form-test, …) each inline their own ~15-line
// CDP wrapper; new modules import this one instead. It adds a few things those
// need: an event-handler registry (so we can answer Fetch.requestPaused to
// simulate a network error), a real-mouse-click helper, and a check()/report()
// pair that run.sh greps for "FAIL".
//
// Connect over the raw-socket WebSocket (rawws.mjs) because the built-in
// WebSocket can't set the Origin header Chrome's DevTools endpoint requires.
import { connect } from "./rawws.mjs";

export const BASE = "http://localhost:8770/demo";
const DBG = "http://127.0.0.1:9222";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function newTarget(url) {
  const res = await fetch(`${DBG}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (res.ok) return res.json();
  // Older Chrome uses GET for /json/new.
  const r2 = await fetch(`${DBG}/json/new?${encodeURIComponent(url)}`);
  return r2.json();
}

export class CDP {
  constructor(wsUrl) {
    this.ws = connect(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = new Map();
    this.ready = new Promise((r) => this.ws.on("open", r));
    this.ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      } else if (m.method) {
        this.events.push(m);
        const hs = this.handlers.get(m.method);
        if (hs) for (const h of hs) h(m.params, m);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((r) => {
      this.pending.set(id, r);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Register a handler for a CDP event method (e.g. "Fetch.requestPaused"). */
  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
  }
  drain(method) {
    return this.events.filter((e) => e.method === method);
  }
  clearEvents() {
    this.events.length = 0;
  }
  close() {
    try { this.ws.close(); } catch (e) {}
    // Also close the Chrome tab (target), not just the socket - otherwise tabs
    // accumulate across the suite (one shared Chrome, many modules) and new-tab
    // creation gets flaky under the pile-up. Fire-and-forget.
    if (this.targetId) fetch(`${DBG}/json/close/${this.targetId}`).catch(() => {});
  }
}

/** Open a fresh tab at `url`, enable the given domains, return a ready CDP. */
async function attach(url, domains) {
  const t = await newTarget(url);
  const c = new CDP(t.webSocketDebuggerUrl);
  c.targetId = t.id; // so close() can close the tab, not just the socket
  await c.ready;
  for (const d of domains) await c.send(d + ".enable");
  return c;
}

/**
 * Open a tab and return once the INITIAL document load event has fired and been
 * cleared from the buffer. This makes "no full reload" checks (which drain
 * Page.loadEventFired) immune to a slow initial load racing in after a test's
 * clearEvents(). Use this for the vast majority of cases.
 */
export async function open(url, domains = ["Page", "Runtime"]) {
  const c = await attach(url, domains);
  for (let i = 0; i < 80; i++) {
    if (c.drain("Page.loadEventFired").length > 0) break;
    await sleep(50);
  }
  c.clearEvents(); // baseline: drop the initial load event
  return c;
}

/**
 * Open a tab WITHOUT consuming the initial load event - for the few tests that
 * need to observe the first Page.loadEventFired / preload requests themselves
 * (they register handlers right after this returns, before the page loads).
 */
export async function openObserve(url, domains = ["Page", "Runtime"]) {
  return attach(url, domains);
}

/**
 * Create a tab parked at about:blank with `domains` enabled but NOT yet
 * navigated. Lets a test install request interception / counters that must be
 * live before the very first request (a normal open() navigates immediately, so
 * early idle preloads race the setup). Pair with navigate().
 */
export async function openBlank(domains = ["Page", "Runtime"]) {
  const t = await newTarget("about:blank");
  const c = new CDP(t.webSocketDebuggerUrl);
  c.targetId = t.id;
  await c.ready;
  for (const d of domains) await c.send(d + ".enable");
  return c;
}

/** Navigate an already-open CDP to `url` and resolve once it has loaded. */
export async function navigate(c, url) {
  c.clearEvents();
  await c.send("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    if (c.drain("Page.loadEventFired").length > 0) break;
    await sleep(50);
  }
  c.clearEvents();
}

/**
 * Open a tab with a LIVE Sparke-fetch counter that cannot miss early preloads.
 * The counter is registered while parked at about:blank, BEFORE navigating, so
 * idle preloads (which race the load event with a normal open()) are always
 * observed. Returns { c, reqs } where reqs is the live [{ url, mode }] array.
 */
export async function openCounting(url, domains = ["Page", "Runtime", "Network"]) {
  const c = await openBlank(domains);
  const reqs = sparkeRequests(c); // live before any request goes out
  await navigate(c, url);
  return { c, reqs };
}

/** Evaluate an expression in the page; returns the value, or an "EXC:" string. */
export async function ev(c, expr) {
  const r = await c.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    return "EXC:" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result && r.result.value;
}

/**
 * A REAL mouse click via Input.dispatchMouseEvent (press then release at the
 * element's centre). Use this - not element.click() - for anything involving
 * hit-testing or the view-transition overlay. `gap` ms between press/release.
 */
export async function realClick(c, sel, gap) {
  const b = await ev(
    c,
    `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`
  );
  if (!b || typeof b !== "object") return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(gap || 0);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  return true;
}

/**
 * Track Sparke's own programmatic fetches. Sparke tags each with an
 * `X-Sparke: preload|navigate` request header, but Chrome reports custom
 * fetch() headers in `Network.requestWillBeSent` OR in
 * `Network.requestWillBeSentExtraInfo` (version-dependent), so we MERGE both by
 * requestId. Returns a LIVE array of `{ url, mode }`, appended to as each
 * Sparke request is sent. Requires the Network domain enabled
 * (`open(url, ["Page", "Runtime", "Network"])`).
 */
export function sparkeRequests(c) {
  const out = [];
  const byId = new Map(); // requestId -> live { url, mode, isSparke, pushed }
  const xsparke = (headers) => {
    for (const k in headers || {}) if (k.toLowerCase() === "x-sparke") return headers[k];
    return undefined;
  };
  const flush = (id) => {
    const r = byId.get(id);
    // Push once we know it's a Sparke fetch and have its URL. We push the LIVE
    // object, so a `mode` that only arrives later (via the ExtraInfo event)
    // still shows up for callers that read it.
    if (r && r.isSparke && r.url !== undefined && !r.pushed) {
      r.pushed = true;
      out.push(r);
    }
  };
  c.on("Network.requestWillBeSent", (p) => {
    const r = byId.get(p.requestId) || {};
    r.url = p.request.url;
    // Sparke issues preloads/navigations via fetch() -> resourceType "Fetch"
    // (the document load and full-nav fallback are "Document"). That type is
    // the reliable signal; the X-Sparke header (mode) is captured when present.
    if (p.type === "Fetch" || p.type === "XHR") r.isSparke = true;
    const m = xsparke(p.request.headers);
    if (m !== undefined) { r.mode = m; r.isSparke = true; }
    byId.set(p.requestId, r);
    flush(p.requestId);
  });
  c.on("Network.requestWillBeSentExtraInfo", (p) => {
    const r = byId.get(p.requestId) || {};
    const m = xsparke(p.headers);
    if (m !== undefined) { r.mode = m; r.isSparke = true; }
    byId.set(p.requestId, r);
    flush(p.requestId);
  });
  return out;
}

/**
 * Wait until a full browser navigation (Page.loadEventFired) is observed since
 * the last clearEvents(), up to `timeout` ms. Returns true if it happened.
 * Use instead of a fixed sleep for fallback/full-reload checks, which race
 * under suite load.
 */
export async function waitReload(c, timeout = 1500) {
  for (let i = 0; i < Math.ceil(timeout / 50); i++) {
    if (c.drain("Page.loadEventFired").length > 0) return true;
    await sleep(50);
  }
  return c.drain("Page.loadEventFired").length > 0;
}

/** Did a full browser navigation / reload happen since the last clearEvents()? */
export function fullyReloaded(c) {
  return c.drain("Page.loadEventFired").length > 0 || c.drain("Page.frameNavigated").some((e) => !e.params.frame.parentId);
}

// ---- assertions ------------------------------------------------------------
let passes = 0;
let fails = 0;

export function check(label, got, want) {
  const ok = got === want;
  ok ? passes++ : fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(got)}${ok ? "" : ", want " + JSON.stringify(want)})`);
}

/** Assert a condition is truthy. */
export function ok(label, cond) {
  check(label, !!cond, true);
}

/** A case that depends on a not-yet-built feature; reported, never fails. */
export function pending(label) {
  console.log(`PENDING  ${label}  (feature locked, not yet built - see ROADMAP §4)`);
}

export function report(name) {
  console.log(`-- ${name}: ${passes} passed, ${fails} failed --`);
  passes = 0;
  fails = 0;
}
