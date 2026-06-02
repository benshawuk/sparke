// Group S - Fallback & failure safety (cases 123-127).
import { open, openBlank, navigate, ev, sleep, check, ok, report, waitReload } from "./cdp.mjs";

// 123. Fetch network error -> fallback to a full navigation. We fail Sparke's
// fetch (XHR/Fetch) for the target URL via the Fetch domain, but allow the
// Document navigation through, so the fallback full-load succeeds. The
// interception is installed BEFORE navigating: otherwise the idle preload of
// the neterr link fetches it first (serve.py serves it as a normal page) and
// caches it, so the click would swap from cache and never reach the fallback.
{
  const c = await openBlank(["Page", "Runtime", "Fetch"]);
  await c.send("Fetch.enable", { patterns: [{ urlPattern: "*neterr*" }] });
  c.on("Fetch.requestPaused", async (p) => {
    if (p.resourceType === "Document") await c.send("Fetch.continueRequest", { requestId: p.requestId });
    else await c.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" });
  });
  await navigate(c, `http://localhost:8770/demo/_sfallback`);
  await sleep(400); // let the (intercepted, failed) neterr preload settle
  c.clearEvents();
  await ev(c, `document.getElementById('neterr').click()`);
  const reloaded = await waitReload(c, 2000); // full-nav fallback can lag under load
  check("123 network error -> full-navigation fallback", reloaded, true);
  await sleep(100);
  check("123 fallback landed on the target", await ev(c, "document.querySelector('main h1') && document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 124. Non-200 (404 / 500) HTML response -> fallback (browser shows it).
for (const [id, label] of [["s404", "404"], ["s500", "500"]]) {
  const c = await open(`http://localhost:8770/demo/_sfallback`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById(${JSON.stringify(id)}).click()`);
  await sleep(600);
  check(`124 ${label} -> full reload fallback`, c.drain("Page.loadEventFired").length > 0, true);
  ok(`124 ${label} -> browser shows the status page`, (await ev(c, "document.body.innerText")).includes(label));
  c.close();
}

// 125. Non-HTML content-type -> fallback.
{
  const c = await open(`http://localhost:8770/demo/_sfallback`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('nonhtml').click()`);
  await sleep(600);
  check("125 non-HTML -> full reload fallback", c.drain("Page.loadEventFired").length > 0, true);
  ok("125 ended on the non-HTML URL", (await ev(c, "location.pathname + location.search")).includes("type="));
  c.close();
}

// 126. Exception thrown during the swap -> fallback (user never trapped). We
// force document.importNode to throw on the next swap; render() catches it and
// hands off to a full navigation.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(600); // _p2 is cached
  await ev(c, "document.importNode = function(){ throw new Error('boom'); };");
  c.clearEvents();
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(700);
  check("126 swap exception -> full-navigation fallback", c.drain("Page.loadEventFired").length > 0, true);
  check("126 fallback reached the target", await ev(c, "location.pathname"), "/demo/_p2");
  c.close();
}

// 127. Cross-origin final URL after redirect -> fallback.
{
  const c = await open(`http://localhost:8770/demo/_sfallback`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('cross').click()`);
  await sleep(900);
  check("127 cross-origin redirect -> full reload", c.drain("Page.loadEventFired").length > 0, true);
  check("127 ended on the cross-origin host", await ev(c, "location.host"), "127.0.0.1:8770");
  c.close();
}

report("fallback");
