// Group L - Per-page stylesheets (cases 77-82).
import { open, ev, sleep, check, ok, report } from "./cdp.mjs";

const RED = "rgb(255, 0, 0)";
const BLUE = "rgb(0, 0, 255)";

const c = await open(`http://localhost:8770/demo/_cssL_a`, ["Page", "Runtime", "Network"]);
await sleep(600);

// 77. Page-specific inline <style> applies on A.
check("77 A inline <style> applied (h1 red)", await ev(c, "getComputedStyle(document.querySelector('main h1')).color"), RED);
ok("77 A inline <style> present", await ev(c, `!!document.head.querySelector('style[data-marker=la]')`));

// 81. Runtime-injected (CSS-in-JS) style that Sparke never owned.
await ev(c, `(()=>{const s=document.createElement('style');s.id='cssinjs';s.textContent='body{background:rgb(1,2,3)}';document.head.appendChild(s);})()`);

// Watch for any re-download of the shared stylesheet during the swap.
const cssReqs = [];
c.on("Network.requestWillBeSent", (p) => { if (p.request.url.endsWith("/demo/style.css")) cssReqs.push(p.request.url); });
c.clearEvents();

await ev(c, `document.getElementById('toB').click()`);
await sleep(700); // allow the external page-specific stylesheet to load

// 78. Page-specific external <link> applies on B.
check("78 B external <link> applied (.l78 blue)", await ev(c, "getComputedStyle(document.querySelector('.l78')).color"), BLUE);

// 79. The left page's page-specific inline <style> is removed.
check("79 A's inline <style> removed on B", await ev(c, `!!document.head.querySelector('style[data-marker=la]')`), false);
ok("79 h1 no longer red on B", (await ev(c, "getComputedStyle(document.querySelector('main h1')).color")) !== RED);

// 80. Shared stylesheet kept, not removed, not re-downloaded.
check("80 shared style.css still present", await ev(c, `document.head.querySelectorAll('link[href$="style.css"]').length`), 1);
check("80 shared style.css NOT re-downloaded on swap", cssReqs.length, 0);

// 81. Runtime-injected <style> never touched.
check("81 CSS-in-JS <style> still present", await ev(c, `!!document.getElementById('cssinjs')`), true);
check("81 CSS-in-JS still applies", await ev(c, "getComputedStyle(document.body).backgroundColor"), "rgb(1, 2, 3)");

// 82. Page-specific CSS re-applies when navigating back to A.
await ev(c, `document.getElementById('toA').click()`);
await sleep(500);
check("82 back on A: inline <style> re-applied", await ev(c, `!!document.head.querySelector('style[data-marker=la]')`), true);
check("82 back on A: h1 red again", await ev(c, "getComputedStyle(document.querySelector('main h1')).color"), RED);

c.close();
report("csslink");
