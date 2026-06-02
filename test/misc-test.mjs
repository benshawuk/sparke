// Group Z - Misc edge cases (cases 161-168).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

const addLink = (c, id, href) =>
  ev(c, `(()=>{const a=document.createElement('a');a.id=${JSON.stringify(id)};a.href=${JSON.stringify(href)};a.textContent=${JSON.stringify(id)};document.querySelector('main').appendChild(a);})()`);

// 161. Same URL, different #hash: scrolls without a full swap fight (Sparke
// leaves same-page hashes to the browser - no fetch/swap flow kicked off).
{
  const c = await open(`http://localhost:8770/demo/_hashes`);
  await sleep(500);
  await ev(c, `window.__nav=0;window.addEventListener('sparke:navigate',()=>window.__nav++);`);
  c.clearEvents();
  await ev(c, `document.getElementById('toOne').click()`);
  await sleep(200);
  const y1 = await ev(c, "window.scrollY");
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(200);
  const y2 = await ev(c, "window.scrollY");
  ok("161 scrolled to #one then #two (different positions)", y2 > y1 && y1 > 0);
  check("161 no Sparke navigation flow triggered", await ev(c, "window.__nav"), 0);
  check("161 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  check("161 content stable", await ev(c, "document.getElementById('hashmark').textContent"), "Hashes");
  c.close();
}

// 162. Malformed/partial HTML parses without throwing (DOMParser is lenient).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await addLink(c, "toMal", "/demo/_malformed");
  c.clearEvents();
  await ev(c, `document.getElementById('toMal').click()`);
  await sleep(500);
  check("162 malformed HTML swapped without throwing", await ev(c, "document.getElementById('malmark') && document.getElementById('malmark').textContent"), "Malformed");
  check("162 no full reload (parsed + swapped)", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 163. Empty <main> swaps cleanly.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await addLink(c, "toEmpty", "/demo/_emptymain");
  c.clearEvents();
  await ev(c, `document.getElementById('toEmpty').click()`);
  await sleep(400);
  check("163 <main> present after swap", await ev(c, "!!document.querySelector('main')"), true);
  check("163 <main> is empty", await ev(c, "document.querySelector('main').children.length"), 0);
  check("163 no full reload / error", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 164. A very large page swaps without error (stress).
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await addLink(c, "toBig", "/demo/_big");
  c.clearEvents();
  await ev(c, `document.getElementById('toBig').click()`);
  await sleep(900);
  check("164 large page swapped in", await ev(c, "document.getElementById('bigmark') && document.getElementById('bigmark').textContent"), "Big page");
  check("164 no full reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 165. The beforeunload-style guard recipe: a dirty-form before-swap listener
// can cancel and keep the user put.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await ev(c, `window.__dirty=true;window.addEventListener('sparke:before-swap',function(e){ if(window.__dirty) e.preventDefault(); });`);
  c.clearEvents();
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(400);
  check("165 dirty guard kept the user on the page", await ev(c, "location.pathname"), "/demo/_p1");
  check("165 content unchanged", await ev(c, "document.querySelector('main h1').textContent"), "Page One");
  check("165 no reload", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

// 166. Rapid Back/Forward mashing stays consistent (token + cache).
{
  const c = await open(`http://localhost:8770/demo/_histA`);
  await sleep(500);
  await ev(c, `document.getElementById('toB').click()`); await sleep(300); // [_histA,_histB]
  await ev(c, `document.getElementById('toA').click()`); await sleep(300); // [_histA,_histB,_histA]
  // Mash history quickly.
  for (const step of ["back", "back", "forward", "back", "forward", "forward"]) {
    await ev(c, `history.${step}()`);
    await sleep(120);
  }
  await sleep(400);
  // Whatever entry we settle on, the content must match the URL (consistency).
  const path = await ev(c, "location.pathname");
  const h1 = await ev(c, "document.querySelector('main h1').textContent");
  const expected = path.endsWith("_histB") ? "Hist B" : "Hist A";
  check("166 after mashing, content matches the settled URL", h1, expected);
  c.close();
}

// 167. A link whose href changes between preload and click is re-resolved.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(600); // #toTwo (-> _p2) preloaded
  await ev(c, `document.getElementById('toTwo').setAttribute('href','/demo/about')`);
  c.clearEvents();
  await ev(c, `document.getElementById('toTwo').click()`);
  await sleep(600);
  check("167 navigated to the NEW href (re-resolved at click)", await ev(c, "location.pathname"), "/demo/about");
  check("167 content is the new target", await ev(c, "document.querySelector('main h1').textContent"), "About");
  c.close();
}

// 168. Query-string-only navigations cache and restore correctly.
{
  const c = await open(`http://localhost:8770/demo/_p1`);
  await sleep(500);
  await addLink(c, "q1", "/demo/_p2?x=1");
  c.clearEvents();
  await ev(c, `document.getElementById('q1').click()`);
  await sleep(400);
  check("168 navigated to ?x=1", await ev(c, "location.search"), "?x=1");
  await addLink(c, "q2", "/demo/_p2?x=2");
  await ev(c, `document.getElementById('q2').click()`);
  await sleep(400);
  check("168 navigated to ?x=2", await ev(c, "location.search"), "?x=2");
  await ev(c, "history.back()");
  await sleep(400);
  check("168 Back restores the ?x=1 entry", await ev(c, "location.search"), "?x=1");
  check("168 Back was from cache (no reload)", c.drain("Page.loadEventFired").length > 0, false);
  c.close();
}

report("misc");
