// Group Y - Memory & performance (cases 158-160). 158 is [F].
import { open, openObserve, ev, sleep, check, ok, pending, report } from "./cdp.mjs";

// 158. [F] Long session: cache stays bounded by the LRU - locked feature.
pending("158 long session cache bounded by LRU (data-cache-size)");

// 159. No detached-DOM/listener accumulation across repeated swaps: the live
// document's structure stays stable (one <main>, one live region, head stable).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(600);
  // Do one swap so the live region etc. exist, then snapshot the structure.
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(300);
  const headBefore = await ev(c, "document.head.childElementCount");
  // Now mash 20 swaps back and forth.
  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? "toOne" : "toTwo";
    await ev(c, `var a=document.getElementById(${JSON.stringify(id)}); if(a) a.click();`);
    await sleep(120);
  }
  await sleep(200);
  check("159 exactly one <main> after many swaps", await ev(c, "document.querySelectorAll('main').length"), 1);
  check("159 exactly one aria-live region (not duplicated)", await ev(c, "document.querySelectorAll('#sparke-live-region').length"), 1);
  check("159 <head> did not grow across swaps", await ev(c, "document.head.childElementCount"), headBefore);
  check("159 body has a single child structure (no pile-up)", await ev(c, "document.body.querySelectorAll('main').length"), 1);
  c.close();
}

// 160. Preloading uses idle time (after first paint). The concurrency-cap part
// is folded into the locked image-preloading work, so it's pending.
{
  const c = await openObserve(`http://localhost:8770/demo/_boot_many`, ["Page", "Runtime", "Network"]);
  let loadTs = null;
  const preloadTs = [];
  c.on("Page.loadEventFired", (p) => { if (loadTs === null) loadTs = p.timestamp; });
  c.on("Network.requestWillBeSent", (p) => {
    const h = p.request.headers || {};
    if (h["X-Sparke"] === "preload" || h["x-sparke"] === "preload") preloadTs.push(p.timestamp);
  });
  await sleep(1500);
  ok("160 preloads ran on idle, after first paint", preloadTs.length > 0 && preloadTs.every((t) => t >= loadTs));
  c.close();
  pending("160 explicit preload concurrency cap (locked with image preloading)");
}

report("perf");
