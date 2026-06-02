// Group R - View transitions (cases 113-122). Real mouse events are used for
// the mid-transition takeover cases (synthetic clicks bypass hit-testing).
import { open, ev, sleep, realClick, check, ok, report } from "./cdp.mjs";

// Spy that counts startViewTransition calls, calls through, and records whether
// the transition's finished promise resolved (vs rejected/aborted).
const SPY = `
  window.__vt = 0; window.__vtFinished = null;
  (function(){
    var o = document.startViewTransition && document.startViewTransition.bind(document);
    document.startViewTransition = function(cb){
      window.__vt++;
      if (!o) { cb(); return { updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition(){} }; }
      var vt = o(cb);
      vt.finished.then(function(){ window.__vtFinished = true; }, function(){ window.__vtFinished = 'rejected'; });
      return vt;
    };
  })();
`;

// 113. data-transitions ABSENT -> startViewTransition never called.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, SPY);
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  check("113 no data-transitions: swap happened", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  check("113 startViewTransition NOT called", await ev(c, "window.__vt"), 0);
  c.close();
}

// 114 / 117 / 119. data-transitions present -> used; named elements animate as
// their own group without aborting the transition.
{
  const c = await open(`http://localhost:8770/demo/_vtA`, ["Page", "Runtime", "Log"]);
  await sleep(700);
  await ev(c, SPY);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(1300); // 1s transition + margin
  check("114 opted-in: content swapped", await ev(c, "document.querySelector('main h1').textContent"), "VT B");
  ok("114 startViewTransition was used", (await ev(c, "window.__vt")) > 0);
  check("117 default crossfade engaged + named group OK (finished resolved)", await ev(c, "window.__vtFinished"), true);
  const errs = c.drain("Log.entryAdded").filter((e) => e.params.entry.level === "error").map((e) => e.params.entry.text);
  ok("119 distinct h1/h2 names did NOT abort (no duplicate-name error)", errs.every((t) => !/transition-name|duplicate/i.test(t)));
  c.close();
}

// 118. Heading instant-swap: after the (named) transition completes, the live
//      DOM holds exactly one heading showing the new text (no leftover overlap;
//      the old snapshot layering is handled by the browser's VT pseudo-elements).
{
  const c = await open(`http://localhost:8770/demo/_vtA`);
  await sleep(700);
  await ev(c, SPY);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(1300);
  check("118 exactly one h1 in the live DOM (no overlap)", await ev(c, "document.querySelectorAll('main h1').length"), 1);
  check("118 heading shows the new text", await ev(c, "document.querySelector('main h1').textContent"), "VT B");
  check("118 transition completed cleanly", await ev(c, "window.__vtFinished"), true);
  c.close();
}

// 115. Feature-detected: if startViewTransition is unavailable, it still swaps.
{
  const c = await open(`http://localhost:8770/demo/_vtA`);
  await sleep(600);
  await ev(c, "document.startViewTransition = undefined;");
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(400);
  check("115 unsupported VT: swap still happened", await ev(c, "document.querySelector('main h1').textContent"), "VT B");
  check("115 unsupported VT: no full reload / error", await ev(c, "typeof window.__sparkeInstalled"), "boolean");
  c.close();
}

// 116. prefers-reduced-motion -> transition skipped, swap still happens.
{
  const c = await open(`http://localhost:8770/demo/_vtA`, ["Page", "Runtime"]);
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(600);
  await ev(c, SPY);
  await ev(c, `document.getElementById('toB').click()`);
  await sleep(500);
  check("116 reduced-motion: swap happened", await ev(c, "document.querySelector('main h1').textContent"), "VT B");
  check("116 reduced-motion: startViewTransition NOT used", await ev(c, "window.__vt"), 0);
  c.close();
}

// 120 / 121. Mid-transition the page is inert; a real click takes over: skip the
// old transition and navigate to the link under the pointer.
{
  const c = await open(`http://localhost:8770/demo/_vtA`);
  await sleep(700);
  await realClick(c, "#toB"); // start the 1s transition to _vtB
  await sleep(250);
  check("121 first nav underway (on _vtB)", await ev(c, "location.pathname"), "/demo/_vtB");
  // During the transition the live DOM is inert (the #toA link isn't hit-testable).
  const inert = await ev(c, `(()=>{const e=document.querySelector('#toA');if(!e)return 'no-link';const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&hit.closest&&hit.closest('#toA')?'hittable':'inert';})()`);
  ok("121 mid-transition page is inert", inert !== "hittable");
  await realClick(c, "#toA", 120); // press during transition -> takeover
  await sleep(700);
  check("120 mid-transition click took over and navigated", await ev(c, "location.pathname"), "/demo/_vtA");
  c.close();
}

// 122. A touch that is a SCROLL (press, move, release) must NOT be hijacked
// into a navigation. Sparke's pointerdown takeover is excluded for touch, and a
// moving touch produces no click - so we stay on the transition's target.
// (A stationary touch TAP is a legitimate navigation by design, so we move.)
{
  const c = await open(`http://localhost:8770/demo/_vtA`);
  await sleep(700);
  await realClick(c, "#toB"); // start transition to _vtB
  await sleep(200);
  const box = await ev(c, `(()=>{const e=document.querySelector('#toA');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (box && typeof box === "object") {
    // press on the link, then drag well away (a scroll), then lift.
    await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x, y: box.y + 300 }] });
    await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await sleep(900);
  // The scrolling touch must NOT have navigated back to _vtA.
  check("122 scrolling touch was not hijacked into a nav (still on _vtB)", await ev(c, "location.pathname"), "/demo/_vtB");
  c.close();
}

report("viewtrans");
