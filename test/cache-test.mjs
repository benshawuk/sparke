// Group F - Cache, seed snapshot & in-flight dedup (cases 45-51). 50/51 are [F].
import { open, openCounting, ev, sleep, check, ok, pending, report } from "./cdp.mjs";

// openCounting opens the tab, registers the Sparke-fetch counter, THEN
// navigates - so idle preloads (which race the load event) are never missed.
// The counter is a live [{ url, mode }] array; here we match on the URL.

// 45. Seed is an independent snapshot: away and back shows the right content,
//     not a stale page (the "settings tab" regression).
{
  const c = await open(`http://localhost:8770/demo/_seed`);
  await sleep(500);
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  check("45 navigated away to Page Two", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  await ev(c, "history.back()");
  await sleep(500);
  check("45 back shows the ORIGINAL seed page", await ev(c, "document.querySelector('main h1').textContent"), "Seed");
  check("45 seed content intact (not stale)", await ev(c, "!!document.getElementById('seedmark')"), true);
  c.close();
}

// 46. A preloaded page is served from memory - no network fetch on click.
{
  const { c, reqs: fetched } = await openCounting(`http://localhost:8770/demo/_seed`);
  await sleep(1500); // let _p2 preload
  ok("46 _p2 was preloaded ahead of the click", fetched.some((r) => r.url.endsWith("/demo/_p2")));
  const before = fetched.filter((r) => r.url.endsWith("/demo/_p2")).length;
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  const after = fetched.filter((r) => r.url.endsWith("/demo/_p2")).length;
  check("46 served from memory (no extra fetch on click)", after, before);
  check("46 content swapped in", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 47. Clicking mid-preload joins the in-flight request (no duplicate fetch).
{
  const { c, reqs: fetched } = await openCounting(`http://localhost:8770/demo/_dedup`);
  await sleep(250); // preload of the slow (700ms) page is in flight, not done
  await ev(c, `document.getElementById('toSlow').click()`);
  await sleep(1000); // let it resolve
  const n = fetched.filter((r) => r.url.includes("/demo/_p2?delay=700")).length;
  check("47 exactly one fetch for the slow page (joined in-flight)", n, 1);
  check("47 ended on the slow page", await ev(c, "location.pathname + location.search"), "/demo/_p2?delay=700");
  c.close();
}

// 48. Failed preload is swallowed; the page still works; a later click refetches.
{
  const { c, reqs: fetched } = await openCounting(`http://localhost:8770/demo/_broken`);
  await sleep(1500); // broken (500) link preload fires and FAILS, swallowed
  ok("48 the broken link was preload-attempted", fetched.some((r) => r.url.includes("_p2?status=500")));
  // Page still works: a good link still swaps with no error.
  await ev(c, `document.getElementById('good').click()`);
  await sleep(400);
  check("48 page still works after a failed preload", await ev(c, "document.querySelector('main h1').textContent"), "Page One");
  c.close();

  // A later click on the broken link refetches (it was NOT cached): so a second
  // Sparke fetch goes out, then it falls back to a full browser load.
  const { c: c2, reqs: fetched2 } = await openCounting(`http://localhost:8770/demo/_broken`);
  await sleep(1500);
  c2.clearEvents();
  await ev(c2, `document.getElementById('broken').click()`);
  await sleep(700);
  const tries = fetched2.filter((r) => r.url.includes("_p2?status=500")).length;
  ok("48 failed preload wasn't cached; click refetched (>=2 fetches)", tries >= 2);
  check("48 broken nav falls back to a full load", c2.drain("Page.loadEventFired").length > 0, true);
  c2.close();
}

// 49. Non-HTML preload response is not cached (a later click falls back).
{
  const { c, reqs: fetched } = await openCounting(`http://localhost:8770/demo/_broken`);
  await sleep(1500); // non-HTML link preloaded -> parsed away (not cached)
  c.clearEvents();
  await ev(c, `document.getElementById('nonhtml').click()`);
  await sleep(700);
  const tries = fetched.filter((r) => r.url.includes("_p2?type=")).length;
  ok("49 non-HTML wasn't cached; click refetched", tries >= 2);
  check("49 non-HTML nav falls back to a full load", c.drain("Page.loadEventFired").length > 0, true);
  c.close();
}

// 50/51. [F] LRU cap + never-evict-current depend on the locked cache work.
pending("50 LRU cap (data-cache-size) evicts least-recently-used");
pending("51 the current page is never evicted by the LRU");

report("cache");
