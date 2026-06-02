// Group A - Bootstrapping & feature detection (cases 1-9).
import { CDP, newTarget, open, openObserve, ev, sleep, realClick, check, ok, report } from "./cdp.mjs";

// Helper: does Sparke intercept a click (swap, no full reload)?
async function swaps(c, sel, expectPath) {
  c.clearEvents();
  await ev(c, `document.querySelector(${JSON.stringify(sel)}).click()`);
  await sleep(400);
  const path = await ev(c, "location.pathname");
  const reloaded = c.drain("Page.loadEventFired").length > 0;
  return { path, reloaded };
}

// 1. Auto-initialises on DOMContentLoaded (plain in-head <script>).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(400);
  ok("1 installed via DOMContentLoaded path", await ev(c, "window.__sparkeInstalled === true"));
  const r = await swaps(c, "#toTwo", "/demo/_p2");
  check("1 swap works (no reload)", r.reloaded, false);
  check("1 swapped to Page Two", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 2. defer script - initialises (readyState interactive path, runs once).
{
  const c = await open(`http://localhost:8770/demo/_boot_defer`);
  await sleep(400);
  ok("2 defer installed", await ev(c, "window.__sparkeInstalled === true"));
  const r = await swaps(c, "#toTwo");
  check("2 defer swap works", r.reloaded, false);
  check("2 defer swapped to Page Two", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 3. Injected after DOM ready - still initialises immediately.
{
  const c = await open(`http://localhost:8770/demo/_boot_bare`);
  await sleep(300);
  ok("3 not installed before injection", await ev(c, "!window.__sparkeInstalled"));
  await ev(c, `(()=>{const s=document.createElement('script');s.src='/sparke.js';document.head.appendChild(s);})()`);
  await sleep(500);
  ok("3 installed after dynamic injection", await ev(c, "window.__sparkeInstalled === true"));
  const r = await swaps(c, "#toTwo");
  check("3 injected swap works", r.reloaded, false);
  c.close();
}

// 4. Double-include guard: a second include is a no-op (one set of handlers,
//    so a click produces exactly ONE after-swap, not two).
{
  const c = await open(`http://localhost:8770/demo/_boot_double`);
  await sleep(400);
  ok("4 installed once", await ev(c, "window.__sparkeInstalled === true"));
  await ev(c, `window.__afterCount=0;window.addEventListener('sparke:after-swap',()=>window.__afterCount++);`);
  c.clearEvents();
  await ev(c, `document.querySelector('#toTwo').click()`);
  await sleep(500);
  check("4 exactly one after-swap (no double-init)", await ev(c, "window.__afterCount"), 1);
  check("4 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 5/6/7. Missing fetch / pushState / DOMParser -> Sparke no-ops; the site
//        behaves as a normal MPA (a click is a full browser navigation).
for (const [fix, label] of [
  ["_nofetch", "5 no fetch"],
  ["_nohistory", "6 no pushState"],
  ["_nodomparser", "7 no DOMParser"],
]) {
  const c = await open(`http://localhost:8770/demo/${fix}`);
  await sleep(300);
  ok(`${label}: Sparke did NOT install`, await ev(c, "!window.__sparkeInstalled"));
  c.clearEvents();
  await ev(c, `document.querySelector('#toTwo').click()`);
  await sleep(500);
  check(`${label}: click is a full browser navigation`, c.drain("Page.loadEventFired").length > 0, true);
  check(`${label}: landed on the target page`, await ev(c, "location.pathname"), "/demo/_p2");
  c.close();
}

// 8. First paint is not blocked by preloading: preload requests go out AFTER
//    the page's load event (deferred to idle), never before it.
{
  const c = await openObserve(`http://localhost:8770/demo/_boot_many`, ["Page", "Runtime", "Network"]);
  let loadTs = null;
  const preloadTs = [];
  c.on("Page.loadEventFired", (p) => { if (loadTs === null) loadTs = p.timestamp; });
  c.on("Network.requestWillBeSent", (p) => {
    const h = p.request.headers || {};
    if (h["X-Sparke"] === "preload" || h["x-sparke"] === "preload") preloadTs.push(p.timestamp);
  });
  await sleep(1500); // let idle preloading run
  ok("8 some links were preloaded", preloadTs.length > 0);
  ok("8 load event was observed", loadTs !== null);
  ok("8 every preload happened after first paint/load", preloadTs.every((t) => t >= loadTs));
  c.close();
}

// 9. JavaScript disabled -> pages are complete documents; links work natively.
{
  const t = await newTarget("about:blank");
  const c = new CDP(t.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setScriptExecutionDisabled", { value: true });
  await c.send("Page.navigate", { url: "http://localhost:8770/demo/_p1" });
  await sleep(700);
  // The link sits in normal flow at the top-left of <main>; click it with a
  // real mouse event (page JS is off, so .click()/evaluate can't drive it).
  c.clearEvents();
  const box = await c.send("DOM.getDocument", {}).then(async () => {
    // Use DOM domain to find the anchor's box model (works with JS disabled).
    const doc = await c.send("DOM.getDocument", { depth: -1 });
    const q = await c.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#toTwo" });
    const bm = await c.send("DOM.getBoxModel", { nodeId: q.nodeId });
    const c4 = bm.model.content; // [x1,y1,x2,y2,x3,y3,x4,y4]
    return { x: (c4[0] + c4[2]) / 2, y: (c4[1] + c4[5]) / 2 };
  });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(700);
  const navigated = c.drain("Page.frameNavigated").some((e) => /_p2$/.test(e.params.frame.url));
  check("9 native navigation to target works (JS disabled)", navigated, true);
  c.close();
}

report("bootstrap");
