// Group U - Configuration via data-* (cases 132-138). 134-137 are [F].
import { open, ev, sleep, check, pending, report } from "./cdp.mjs";

// 132. data-transitions is read from the <script> tag (document.currentScript):
//      present -> transitions engage; absent -> they don't. (Behavioural proof
//      that the attribute on the script element is what drives config.)
{
  const c = await open(`http://localhost:8770/demo/_vtA`, ["Page", "Runtime"]);
  await sleep(600);
  await ev(c, `window.__vt=0;(function(){var o=document.startViewTransition&&document.startViewTransition.bind(document);document.startViewTransition=function(cb){window.__vt++;return o?o(cb):(cb(),{updateCallbackDone:Promise.resolve(),finished:Promise.resolve()});};})();`);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(900);
  check("132 data-transitions on script tag -> transitions used", await ev(c, "window.__vt > 0"), true);
  c.close();
}

// 133. Absent attributes -> documented defaults (transitions OFF by default).
{
  const c = await open(`http://localhost:8770/demo/_p1`, ["Page", "Runtime"]);
  await sleep(500);
  await ev(c, `window.__vt=0;(function(){var o=document.startViewTransition&&document.startViewTransition.bind(document);document.startViewTransition=function(cb){window.__vt++;return o?o(cb):(cb(),{updateCallbackDone:Promise.resolve(),finished:Promise.resolve()});};})();`);
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(500);
  check("133 no data-transitions -> default OFF (no VT)", await ev(c, "window.__vt"), 0);
  check("133 default still swaps instantly", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 138. No window.Sparke global is required or created.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  check("138 no window.Sparke global created", await ev(c, "typeof window.Sparke"), "undefined");
  // ...and Sparke still works without any global API.
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  check("138 works with no global API", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  c.close();
}

// 134-137. [F] LRU size / revalidate / preload scope / image scope - locked.
pending("134 data-cache-size sets the LRU cap; invalid -> default");
pending("135 data-revalidate parses seconds / 0 / off");
pending("136 data-preload scope all|page|none behave distinctly");
pending("137 data-preload-images scope all|page|off; bare attr = all");

report("config");
