// Group I - History, scroll & hash (cases 60-67).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// 60 / 61 / 67. pushState on forward; Back restores from cache; F/B/F consistent.
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  const len0 = await ev(c, "history.length");
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(400);
  check("60 forward navigated to B", await ev(c, "location.pathname"), "/demo/_histB");
  ok("60 pushState grew history", (await ev(c, "history.length")) > len0);

  c.clearEvents();
  await ev(c, "history.back()");
  await sleep(400);
  check("61 Back returns to A", await ev(c, "location.pathname"), "/demo/_histA");
  check("61 Back content from cache", await ev(c, "document.querySelector('main h1').textContent"), "Hist A");
  check("61 Back was no full reload (from memory)", c.drain("Page.loadEventFired").length > 0, false);

  // 67. forward -> back -> forward stays consistent.
  await ev(c, "history.forward()");
  await sleep(400);
  check("67 Forward returns to B", await ev(c, "location.pathname"), "/demo/_histB");
  check("67 Forward content correct", await ev(c, "document.querySelector('main h1').textContent"), "Hist B");
  c.close();
}

// 62. Back to an uncached page -> full reload. We reach B via a full browser
//     load (rel=external), so B's fresh JS context never cached A; pressing
//     Back to A is therefore a real reload.
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('toBfull').click()`); // full load to B
  await sleep(700);
  check("62 setup: full-loaded onto B", await ev(c, "location.pathname"), "/demo/_histB");
  ok("62 setup: it was a real load", c.drain("Page.loadEventFired").length > 0);
  c.clearEvents();
  await ev(c, "history.back()");
  await sleep(700);
  check("62 Back lands on A", await ev(c, "location.pathname"), "/demo/_histA");
  check("62 Back to uncached page was a full reload", c.drain("Page.loadEventFired").length > 0, true);
  c.close();
}

// 63. Forward navigation scrolls to top.
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  await ev(c, "window.scrollTo(0, 1200)");
  await sleep(100);
  ok("63 setup: scrolled down first", (await ev(c, "window.scrollY")) > 500);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(400);
  check("63 forward nav scrolled to top", await ev(c, "window.scrollY"), 0);
  c.close();
}

// 64. Cross-page hash scrolls to the anchor after swap.
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  await ev(c, `document.getElementById('toBhash').click()`);
  await sleep(400);
  check("64 address bar keeps hash", await ev(c, "location.pathname + location.hash"), "/demo/_histB#target");
  ok("64 scrolled to the #target anchor (not top)", (await ev(c, "window.scrollY")) > 100);
  c.close();
}

// 65. Same-page hash is left to the browser: Sparke's click handler does NOT
//     intercept it (no sparke:navigate / fetch flow); the browser applies the
//     hash. (Note: headless Chrome also fires popstate on a fragment-link
//     click, unlike real browsers which fire only hashchange - so we assert on
//     the click-interception path, which is what "left to the browser" means.)
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  await ev(c, `window.__nav=0;window.addEventListener('sparke:navigate',()=>window.__nav++);`);
  c.clearEvents();
  await ev(c, `document.getElementById('samehash').click()`);
  await sleep(300);
  check("65 same-page hash: click NOT intercepted by Sparke", await ev(c, "window.__nav"), 0);
  check("65 same-page hash: hash applied by browser", await ev(c, "location.hash"), "#down");
  check("65 same-page hash: content unchanged", await ev(c, "document.querySelector('main h1').textContent"), "Hist A");
  check("65 same-page hash: no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 66. scrollRestoration is left to the browser for history navigation.
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(400);
  check("66 scrollRestoration is 'auto' (browser-managed)", await ev(c, "history.scrollRestoration"), "auto");
  c.close();
}

report("history");
