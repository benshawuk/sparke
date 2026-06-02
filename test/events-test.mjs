// Group Q - Events & extension API (cases 106-112).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// Install a recorder for the three Sparke events, capturing detail + the live
// <main> heading at the moment each fires (to prove ordering vs the swap).
const RECORDER = `
  window.__ev = [];
  function rec(n){ return function(e){ window.__ev.push({ n:n, from:e.detail&&e.detail.from, to:e.detail&&e.detail.to, h:(document.querySelector('main h1')||{}).textContent }); }; }
  window.addEventListener('sparke:navigate', rec('navigate'));
  window.addEventListener('sparke:before-swap', rec('before'));
  window.addEventListener('sparke:after-swap', rec('after'));
`;

// 106/107/109/110. Order, timing and detail on a forward navigation.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, RECORDER);
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  const log = await ev(c, "JSON.stringify(window.__ev)");
  const evs = JSON.parse(log);
  const names = evs.map((e) => e.n);
  ok("106/107/109 fired navigate, before, after in order", JSON.stringify(names) === JSON.stringify(["navigate", "before", "after"]));

  const nav = evs.find((e) => e.n === "navigate");
  const before = evs.find((e) => e.n === "before");
  const after = evs.find((e) => e.n === "after");
  check("106 sparke:navigate fired while old content still shown", nav.h, "Page One");
  check("107 before-swap fired before content changed", before.h, "Page One");
  check("109 after-swap fired with new content in place", after.h, "Page Two");
  ok("110 detail.from is the old URL", before.from.endsWith("/demo/_p1"));
  ok("110 detail.to is the new URL", before.to.endsWith("/demo/_p2"));
  c.close();
}

// 111. Events fire for popstate navigation too (before/after-swap on Back).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, `document.getElementById('toTwo').click()`); // forward to _p2
  await sleep(400);
  await ev(c, RECORDER); // start recording, then go Back
  await ev(c, "history.back()");
  await sleep(400);
  const evs = JSON.parse(await ev(c, "JSON.stringify(window.__ev)"));
  const names = evs.map((e) => e.n);
  ok("111 before-swap fires on popstate", names.includes("before"));
  ok("111 after-swap fires on popstate", names.includes("after"));
  const after = evs.find((e) => e.n === "after");
  ok("111 popstate detail.to is the Back target", after.to.endsWith("/demo/_p1"));
  c.close();
}

// 108/112. preventDefault on before-swap keeps the user put - and that's
// distinct from a failure (no fallback navigation / full reload).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, `window.addEventListener('sparke:before-swap', function(e){ e.preventDefault(); });`);
  c.clearEvents();
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(500);
  check("108 cancel keeps user on the page", await ev(c, "location.pathname"), "/demo/_p1");
  check("108 content unchanged", await ev(c, "document.querySelector('main h1').textContent"), "Page One");
  check("112 cancel did NOT fall back to a full navigation", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

report("events");
