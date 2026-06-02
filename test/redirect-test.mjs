// Group G - Redirects (cases 52-55).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// 52. Same-origin redirect: address bar shows the FINAL url; content is final.
{
  const c = await open(`http://localhost:8770/demo/_redir`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('same').click()`); // /demo/_redir-old -> /demo/_redirdest
  await sleep(700);
  check("52 address bar shows final URL", await ev(c, "location.pathname"), "/demo/_redirdest");
  check("52 content is the final page", await ev(c, "document.querySelector('main h1').textContent"), "Redirect Dest");
  check("52 it was a swap, not a full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 54. Redirect chain resolves to the final URL.
{
  const c = await open(`http://localhost:8770/demo/_redir`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('chain').click()`); // _redir-old2 -> _redir-old -> _redirdest
  await sleep(800);
  check("54 chain resolves to final URL", await ev(c, "location.pathname"), "/demo/_redirdest");
  check("54 chain content is final page", await ev(c, "document.querySelector('main h1').textContent"), "Redirect Dest");
  check("54 chain was a swap", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 53. Cross-origin redirect -> fallback to a full browser navigation.
{
  const c = await open(`http://localhost:8770/demo/_redir`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('cross').click()`); // -> http://127.0.0.1:8770/demo/_p2
  await sleep(900);
  check("53 cross-origin redirect did a full load", c.drain("Page.loadEventFired").length > 0, true);
  check("53 ended on the cross-origin host", await ev(c, "location.host"), "127.0.0.1:8770");
  c.close();
}

// 55. Preloading a redirecting URL caches under the FINAL key: navigating to
//     the clean final URL is then served from memory with no extra fetch.
{
  const c = await open(`http://localhost:8770/demo/_redir55`, ["Page", "Runtime", "Network"]);
  const fetched = [];
  c.on("Network.requestWillBeSent", (p) => {
    const h = p.request.headers || {};
    if (h["X-Sparke"] || h["x-sparke"]) fetched.push(p.request.url);
  });
  await sleep(1500); // _redir-old preloads, 302 -> _redirdest, cached under it
  // Add the clean /demo/_redirdest link now (after discovery), so it was NOT
  // itself preloaded - any cache hit must come from the redirect.
  await ev(c, `(()=>{const a=document.createElement('a');a.id='ab';a.href='/demo/_redirdest';a.textContent='dest';document.querySelector('main').appendChild(a);})()`);
  c.clearEvents();
  const before = fetched.filter((u) => u.endsWith("/demo/_redirdest")).length;
  await ev(c, `document.getElementById('ab').click()`);
  await sleep(500);
  const after = fetched.filter((u) => u.endsWith("/demo/_redirdest")).length;
  check("55 final URL served from cache (no direct fetch)", after, before);
  check("55 redirect target content is present", await ev(c, "document.querySelector('main h1').textContent"), "Redirect Dest");
  check("55 it was a swap", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

report("redirect");
