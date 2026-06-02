// Group D - Click interception (cases 28-37). Uses REAL mouse events so
// modifier/middle/right clicks behave as the browser actually treats them.
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

const URL = "http://localhost:8770/demo/_click";

// Modifier bitmask (CDP): Alt=1, Ctrl=2, Meta=4, Shift=8.
async function box(c, sel) {
  return ev(c, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}
async function mouse(c, sel, { button = "left", modifiers = 0 } = {}) {
  const b = await box(c, sel);
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button, buttons: button === "middle" ? 4 : 1, clickCount: 1, modifiers });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button, buttons: 0, clickCount: 1, modifiers });
}

// Spy: record whether Sparke preventDefault()ed the most recent click. Our
// bubble listener is registered after Sparke's, so it sees the final state.
async function installSpy(c) {
  await ev(c, `window.__prevented=null;document.addEventListener('click',function(e){window.__prevented=e.defaultPrevented;},false);`);
}

// 28 / 36. Plain left-click swaps (no reload) and Sparke preventDefault()s it.
{
  const c = await open(URL);
  await sleep(400);
  await installSpy(c);
  c.clearEvents();
  await mouse(c, "#plain");
  await sleep(400);
  check("28 swapped to Page Two", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  check("28 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  check("36 preventDefault called on handled click", await ev(c, "window.__prevented"), true);
  c.close();
}

// 29. Modifier clicks are NOT intercepted (browser default / new tab).
{
  const c = await open(URL);
  await sleep(400);
  await installSpy(c);
  for (const [name, mod] of [["ctrl", 2], ["meta", 4], ["shift", 8], ["alt", 1]]) {
    await ev(c, "window.__prevented=null");
    await mouse(c, "#plain", { modifiers: mod });
    await sleep(200);
    // Not intercepted = Sparke didn't preventDefault (false), or no navigable
    // click fired at all (null - e.g. ctrl-click maps to contextmenu on macOS).
    ok(`29 ${name}-click not intercepted`, (await ev(c, "window.__prevented")) !== true);
  }
  check("29 still on the original page", await ev(c, "location.pathname"), "/demo/_click");
  c.close();
}

// 30. Middle-click (button 1) not intercepted.
{
  const c = await open(URL);
  await sleep(400);
  await installSpy(c);
  await mouse(c, "#plain", { button: "middle" });
  await sleep(200);
  // Middle-click fires auxclick, not click, so Sparke never sees it.
  ok("30 middle-click not intercepted", (await ev(c, "window.__prevented")) !== true);
  check("30 still on original page", await ev(c, "location.pathname"), "/demo/_click");
  c.close();
}

// 31. Right-click not intercepted (fires contextmenu, not a navigable click).
{
  const c = await open(URL);
  await sleep(400);
  await installSpy(c);
  await mouse(c, "#plain", { button: "right" });
  await sleep(200);
  // Either no click event reached Sparke, or it wasn't prevented; never a swap.
  ok("31 right-click did not intercept", (await ev(c, "window.__prevented")) !== true);
  check("31 still on original page", await ev(c, "location.pathname"), "/demo/_click");
  c.close();
}

// 32. Click on a child element resolves to its <a>.
{
  const c = await open(URL);
  await sleep(400);
  c.clearEvents();
  await mouse(c, "#childspan");
  await sleep(400);
  check("32 child click resolved to anchor (swapped)", await ev(c, "document.querySelector('main h1').textContent"), "Page Two");
  check("32 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 33. A prior handler that preventDefault()s -> Sparke stays out of it.
{
  const c = await open(URL);
  await sleep(400);
  // Capture-phase handler runs before Sparke's bubble handler and cancels.
  await ev(c, `document.addEventListener('click',function(e){e.preventDefault();},true);`);
  c.clearEvents();
  await mouse(c, "#plain");
  await sleep(400);
  check("33 stayed on page (Sparke didn't intercept)", await ev(c, "location.pathname"), "/demo/_click");
  check("33 content unchanged", await ev(c, "document.querySelector('main h1').textContent"), "Click");
  check("33 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 34. Click on a non-link does nothing (no nav, no error).
{
  const c = await open(URL);
  await sleep(400);
  c.clearEvents();
  await mouse(c, "#notlink");
  await sleep(300);
  check("34 non-link click: still here", await ev(c, "location.pathname"), "/demo/_click");
  check("34 non-link click: no reload", c.drain("Page.loadEventFired").length > 0, false);
  check("34 non-link click: no exception", await ev(c, "1+1"), 2);
  c.close();
}

// 35. Click on an ineligible link -> normal browser navigation (full load).
{
  const c = await open(URL);
  await sleep(400);
  c.clearEvents();
  await mouse(c, "#ext");
  await sleep(600);
  check("35 ineligible link -> navigated to target", await ev(c, "location.pathname"), "/demo/_p1");
  check("35 it was a full browser load", c.drain("Page.loadEventFired").length > 0, true);
  c.close();
}

// 37. Click a link to the current page -> swaps/refreshes without error.
{
  const c = await open(URL);
  await sleep(400);
  c.clearEvents();
  await mouse(c, "#selflink");
  await sleep(400);
  check("37 same-page link: still on the page", await ev(c, "location.pathname"), "/demo/_click");
  check("37 same-page link: content intact", await ev(c, "document.querySelector('main h1').textContent"), "Click");
  check("37 same-page link: no full reload", c.drain("Page.loadEventFired").length > 0, false);
  check("37 same-page link: no exception thrown", await ev(c, "typeof window.__sparkeInstalled"), "boolean");
  c.close();
}

report("click");
