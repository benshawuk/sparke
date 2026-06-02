// Group T - Loading / slow-connection UX (cases 128-131).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

const addLink = (c, id, href) =>
  ev(c, `(()=>{const a=document.createElement('a');a.id=${JSON.stringify(id)};a.href=${JSON.stringify(href)};a.textContent=${JSON.stringify(id)};document.querySelector('main').appendChild(a);})()`);

// 128 / 129. Slow uncached navigation: the OLD page stays fully visible (no
// blank, no spinner) until content arrives; sparke:navigate fires up front.
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime"]);
  await sleep(400);
  await addLink(c, "slow", "/demo/_p2?delay=1200"); // uncached (added post-discovery)
  await ev(c, `window.__nav=false;window.addEventListener('sparke:navigate',()=>window.__nav=true);`);
  c.clearEvents();
  await ev(c, `document.getElementById('slow').click()`);
  await sleep(400); // mid-fetch
  check("129 sparke:navigate fired up front", await ev(c, "window.__nav"), true);
  check("128 mid-fetch: still on the old URL", await ev(c, "location.pathname"), "/demo/_hrace");
  check("128 mid-fetch: old content still fully shown", await ev(c, "document.querySelector('main h1').textContent"), "H race");
  check("128 mid-fetch: page not blank", await ev(c, "document.querySelector('main') !== null"), true);
  // then it swaps
  await sleep(1300);
  check("128 eventually swapped in the slow page", await ev(c, "location.pathname + location.search"), "/demo/_p2?delay=1200");
  check("128 it was a swap, not a reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 130. A slow fetch that then fails -> full-navigation fallback.
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime"]);
  await sleep(400);
  await addLink(c, "slowfail", "/demo/_p2?delay=400&status=500");
  c.clearEvents();
  await ev(c, `document.getElementById('slowfail').click()`);
  // Poll up to ~3s for the fallback full load.
  let reloaded = false;
  for (let i = 0; i < 12; i++) { await sleep(300); if (c.drain("Page.loadEventFired").length > 0) { reloaded = true; break; } }
  check("130 slow fetch that fails -> full-nav fallback", reloaded, true);
  c.close();
}

// 131. Throttled (CDP slow-3G-ish) end-to-end navigation still swaps correctly.
{
  const c = await open(`http://localhost:8770/demo/_p1`, ["Page", "Runtime", "Network"]);
  await c.send("Network.emulateNetworkConditions", {
    offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024,
  });
  await sleep(400);
  await addLink(c, "toAbout", "/demo/about"); // uncached
  c.clearEvents();
  await ev(c, `document.getElementById('toAbout').click()`);
  // Wait generously for the throttled fetch.
  let arrived = false;
  for (let i = 0; i < 20; i++) { await sleep(300); if ((await ev(c, "location.pathname")) === "/demo/about") { arrived = true; break; } }
  ok("131 throttled navigation eventually arrived", arrived);
  check("131 throttled navigation swapped (no full reload)", c.drain("Page.loadEventFired").length > 0, false);
  check("131 throttled content correct", await ev(c, "document.querySelector('main h1').textContent"), "About");
  c.close();
}

// Loading state: <html data-sparke-loading> + sparke:loading event, shown only
// once a navigation is in flight past the (default 150ms) debounce.
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime"]);
  await sleep(400);
  await addLink(c, "slowload", "/demo/_p2?delay=1200"); // uncached, well past the debounce
  await ev(c, `window.__la=[];window.addEventListener('sparke:loading',e=>window.__la.push(e.detail.active));`);
  await ev(c, `document.getElementById('slowload').click()`);
  await sleep(500); // past the 150ms debounce, still mid-fetch
  check("loading attr set during slow nav", await ev(c, `document.documentElement.hasAttribute('data-sparke-loading')`), true);
  check("sparke:loading active:true fired first", await ev(c, `window.__la[0]===true`), true);
  await sleep(1100); // let it complete
  check("loading attr cleared after swap", await ev(c, `document.documentElement.hasAttribute('data-sparke-loading')`), false);
  check("sparke:loading active:false fired last", await ev(c, `window.__la[window.__la.length-1]===false`), true);
  c.close();
}

// Debounce: a fast (sub-150ms, here a local uncached fetch) navigation never
// sets the attribute or fires sparke:loading - no flash on the common case.
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime"]);
  await sleep(400);
  await addLink(c, "fastload", "/demo/_p2"); // uncached but no delay -> resolves before the debounce
  await ev(c, `window.__shown=false;window.addEventListener('sparke:loading',e=>{if(e.detail.active)window.__shown=true;});`);
  await ev(c, `document.getElementById('fastload').click()`);
  let arrived = false;
  for (let i = 0; i < 12; i++) { await sleep(100); if ((await ev(c, "location.pathname")) === "/demo/_p2") { arrived = true; break; } }
  ok("fast nav arrived", arrived);
  check("fast nav under debounce: indicator never shown", await ev(c, `window.__shown`), false);
  check("fast nav under debounce: attr never set", await ev(c, `document.documentElement.hasAttribute('data-sparke-loading')`), false);
  c.close();
}

report("loading");
