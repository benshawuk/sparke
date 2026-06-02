// Group H - Race conditions & concurrency (cases 56-59).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

function fetchLog(c) {
  const urls = [];
  c.on("Network.requestWillBeSent", (p) => {
    const h = p.request.headers || {};
    if (h["X-Sparke"] || h["x-sparke"]) urls.push(p.request.url);
  });
  return urls;
}
const addLink = (c, id, href) =>
  ev(c, `(()=>{const a=document.createElement('a');a.id=${JSON.stringify(id)};a.href=${JSON.stringify(href)};a.textContent=${JSON.stringify(id)};document.querySelector('main').appendChild(a);})()`);

// 56 / 57 / 59 share one context (links added post-discovery -> uncached).
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime", "Network"]);
  const fetched = fetchLog(c);
  await sleep(400);
  await addLink(c, "A", "/demo/_p2?delay=700"); // slow -> Page Two
  await addLink(c, "B", "/demo/_p1?delay=100"); // fast -> Page One
  await addLink(c, "C", "/demo/_p2?delay=400"); // for repeated-click test

  // 56. Rapid A-then-B (both uncached): ends on B; A's slow reply can't clobber.
  await ev(c, `document.getElementById('A').click()`);
  await sleep(60);
  await ev(c, `document.getElementById('B').click()`);
  await sleep(1000); // let A's slow response also arrive
  check("56 ended on the LATER page B", await ev(c, "location.pathname + location.search"), "/demo/_p1?delay=100");
  check("56 content is B (A didn't clobber)", await ev(c, "document.querySelector('main h1').textContent"), "Page One");

  // 57. The superseded A fetch is still cached: navigating to it now is instant
  //     from memory (no new network request).
  const aBefore = fetched.filter((u) => u.includes("_p2?delay=700")).length;
  ok("57 A was fetched exactly once already", aBefore === 1);
  // The earlier swap replaced <main>, so re-add a link to A's URL to click.
  await addLink(c, "A2", "/demo/_p2?delay=700");
  c.clearEvents();
  await ev(c, `document.getElementById('A2').click()`);
  await sleep(400);
  const aAfter = fetched.filter((u) => u.includes("_p2?delay=700")).length;
  check("57 superseded fetch was cached (no refetch)", aAfter, aBefore);
  check("57 renders A from cache", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  check("57 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 59. Repeated clicks on the same (uncached) link -> single coherent render,
//     single fetch (in-flight dedup), no errors.
{
  const c = await open(`http://localhost:8770/demo/_hrace`, ["Page", "Runtime", "Network"]);
  const fetched = fetchLog(c);
  await sleep(400);
  await addLink(c, "C", "/demo/_p2?delay=400");
  c.clearEvents();
  await ev(c, `for (let i=0;i<5;i++) document.getElementById('C').click();`);
  await sleep(800);
  check("59 single coherent render", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  check("59 ended on the target once", await ev(c, "location.pathname + location.search"), "/demo/_p2?delay=400");
  check("59 only one fetch (dedup across repeats)", fetched.filter((u) => u.includes("_p2?delay=400")).length, 1);
  check("59 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 58. popstate during an in-flight fetch supersedes it (token bump).
{
  const c = await open(`http://localhost:8770/demo/_race58`, ["Page", "Runtime", "Network"]);
  await sleep(500);
  // Build a forward history entry: go to cached _p1, then Back to _race58.
  await ev(c, `document.getElementById('toCached').click()`);
  await sleep(400);
  check("58 setup: on _p1", await ev(c, "location.pathname"), "/demo/_p1");
  await ev(c, "history.back()");
  await sleep(400);
  check("58 setup: back on _race58 (forward entry = _p1)", await ev(c, "location.pathname"), "/demo/_race58");

  // Add an uncached slow link and start navigating to it (fetch in-flight,
  // pushState still deferred), then immediately go Forward via history.
  await addLink(c, "slow", "/demo/_p2?delay=900");
  c.clearEvents();
  await ev(c, `document.getElementById('slow').click()`);
  await sleep(80);
  await ev(c, "history.forward()"); // popstate -> _p1 (cached), bumps navToken
  await sleep(1200); // let the slow fetch resolve - it must be superseded

  check("58 popstate won; landed on _p1", await ev(c, "location.pathname"), "/demo/_p1");
  check("58 slow fetch did NOT clobber (content is One)", await ev(c, "document.querySelector('main h1').textContent"), "Page One");
  check("58 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

report("race");
