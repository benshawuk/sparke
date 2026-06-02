// Group E - Swap strategies (cases 38-44).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

// 38 / 42 / 43 / 44. Single-main swap; persistence; no script exec; in-main CSS.
{
  const c = await open(`http://localhost:8770/demo/_swap1`);
  await sleep(500);
  const counterBefore = await ev(c, "window.__counter");
  c.clearEvents();
  await ev(c, `document.getElementById('toSwap2').click()`);
  await sleep(500);

  check("38 only <main> swapped (new content)", await ev(c, "document.querySelector('main h1').textContent"), "Swap Two");
  check("38 header persisted (runtime dataset kept)", await ev(c, "document.getElementById('hdr').dataset.mounted"), "orig");
  check("38 no full reload", c.drain("Page.loadEventFired").length > 0, false);

  // 42. The JS context survived: the live counter kept ticking, window state kept.
  await sleep(150);
  ok("42 live timer kept running across swap", (await ev(c, "window.__counter")) > counterBefore);

  // 43. The <script> inside the swapped-in <main> did NOT execute.
  check("43 in-main <script> not executed", await ev(c, "typeof window.__swap2ran"), "undefined");

  // 44. The <style> inside the swapped-in <main> DID apply.
  check("44 in-main <style> applied", await ev(c, "getComputedStyle(document.getElementById('marker44')).color"), "rgb(0, 128, 0)");
  c.close();
}

// 39. Not single-main on both sides -> <body> children replaced.
{
  const c = await open(`http://localhost:8770/demo/_nomain1`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('toNoMain2').click()`);
  await sleep(500);
  check("39 body-swap replaced content", await ev(c, "document.querySelector('#content h1').textContent"), "No main Two");
  check("39 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 41. Incoming has multiple <main> -> body-swap path (whole body replaced).
{
  const c = await open(`http://localhost:8770/demo/_swap1`);
  await sleep(500);
  c.clearEvents();
  await ev(c, `document.getElementById('toMulti').click()`);
  await sleep(500);
  check("41 multi-main target rendered", await ev(c, "document.querySelector('main h1').textContent"), "Multi main");
  // Body swap brought BOTH mains across (proof the body path was taken).
  check("41 both <main> elements present (body swap)", await ev(c, "document.querySelectorAll('main').length"), 2);
  check("41 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 40. Incoming doc with no <body> -> canSwap() returns false -> caller falls
//     back. A real text/html fetch always has a <body>, so we exercise the
//     decision directly through the test hook with a body-less (XML) document.
{
  const c = await open(`http://localhost:8770/demo/_swap1`);
  await sleep(500);
  const noBodyFails = await ev(
    c,
    `(()=>{const d=new DOMParser().parseFromString('<root><a/></root>','text/xml');return window.__sparkeInternals.canSwap(d);})()`
  );
  check("40 no-body incoming -> canSwap false (fallback)", noBodyFails, false);
  // Sanity: a normal single-main doc is swappable.
  const okDoc = await ev(
    c,
    `(()=>{const d=new DOMParser().parseFromString('<!doctype html><body><main>x</main></body>','text/html');return window.__sparkeInternals.canSwap(d);})()`
  );
  check("40 single-main incoming -> canSwap true", okDoc, true);
  c.close();
}

report("swap");
