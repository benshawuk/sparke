// Group M - Active links (cases 83-85).
import { open, ev, sleep, check, report } from "./cdp.mjs";

const cur = (id) => ev(c, `document.getElementById(${JSON.stringify(id)}).getAttribute('aria-current')`);

const c = await open(`http://localhost:8770/demo/_activeA`);
await sleep(500);

// 83 + 85. On A: every link form pointing at A is current; B is not.
check("83 clean self link is current", await cur("self"), "page");
check("85 .html self link is current", await cur("selfhtml"), "page");
check("85 index.html self link is current", await cur("selfindex"), "page");
check("84 other link (B) not current", await cur("other"), null);

// Navigate to B.
await ev(c, `document.getElementById('other').click()`);
await sleep(400);
check("setup: now on B", await ev(c, "document.querySelector('main h1').textContent"), "Active B");

// 83/84. After nav: B is current, all the A-forms are no longer current.
check("83 B link now current", await cur("other"), "page");
check("84 clean A link no longer current", await cur("self"), null);
check("84 .html A link no longer current", await cur("selfhtml"), null);
check("84 index.html A link no longer current", await cur("selfindex"), null);

c.close();
report("active");
