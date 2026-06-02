// Group N - Accessibility (cases 86-90).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// 86/87/88. Forward nav: focus moves to <main>, ring suppressed, title announced.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(300);
  check("86 focus moved to <main>", await ev(c, "document.activeElement && document.activeElement.tagName"), "MAIN");
  check("88 focus ring suppressed on <main>", await ev(c, "document.querySelector('main').style.outline"), "none");
  await sleep(120); // announcement set on a later tick
  check("87 aria-live region present", await ev(c, "!!document.getElementById('sparke-live-region')"), true);
  check("87 aria-live announced new title", await ev(c, "document.getElementById('sparke-live-region').textContent"), "Page Two");
  c.close();
}

// 89. popstate leaves focus/scroll restoration to the browser (focus is NOT
//     force-moved to <main>; it returns to the body as the old <main> is gone).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, `document.getElementById('toTwo').click()`); // forward -> focuses main
  await sleep(300);
  check("89 setup: forward focused <main>", await ev(c, "document.activeElement.tagName"), "MAIN");
  await ev(c, "history.back()");
  await sleep(400);
  check("89 popstate did not force focus onto <main>", await ev(c, "document.activeElement.tagName"), "BODY");
  c.close();
}

// 90. prefers-reduced-motion -> no view transition, but the swap still happens.
{
  const c = await open(`http://localhost:8770/demo/_vtA`, ["Page", "Runtime"]);
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(600);
  await ev(c, `window.__vt=0;(function(){var o=document.startViewTransition&&document.startViewTransition.bind(document);document.startViewTransition=function(cb){window.__vt++;return o?o(cb):(cb(),{updateCallbackDone:Promise.resolve(),finished:Promise.resolve()});};})();`);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(500);
  check("90 reduced-motion: swap still happened", await ev(c, "document.querySelector('main h1').textContent"), "VT B");
  check("90 reduced-motion: startViewTransition NOT used", await ev(c, "window.__vt"), 0);
  c.close();
}

report("a11y");
