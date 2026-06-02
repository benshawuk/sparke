// Group K - Attribute synchronisation (cases 73-76).
import { open, ev, sleep, check, report } from "./cdp.mjs";

const c = await open(`http://localhost:8770/demo/_attrA`);
await sleep(500);

check("setup: body class is page-a foo", await ev(c, "document.body.className"), "page-a foo");
check("setup: html lang en", await ev(c, "document.documentElement.lang"), "en");

// 76. A runtime-set <html> class (a theme toggle) must survive the swap.
await ev(c, "document.documentElement.classList.add('dark')");

await ev(c, `document.getElementById('toB').click()`);
await sleep(400);

// 73. <body> class synced.
check("73 body class synced to page-b", await ev(c, "document.body.className"), "page-b");

// 74. <body> data-*/id synced (incoming's added, outgoing's removed).
check("74 body id synced", await ev(c, "document.body.id"), "bodyB");
check("74 body data-y synced", await ev(c, "document.body.getAttribute('data-y')"), "2");
check("74 body data-x (only on A) removed", await ev(c, "document.body.hasAttribute('data-x')"), false);

// 75. <html> lang/dir synced.
check("75 html lang synced", await ev(c, "document.documentElement.lang"), "fr");
check("75 html dir synced", await ev(c, "document.documentElement.dir"), "rtl");

// 76. Runtime-set <html> class preserved (Sparke only syncs lang/dir on <html>).
check("76 runtime <html> 'dark' class preserved", await ev(c, "document.documentElement.classList.contains('dark')"), true);

c.close();
report("attr");
