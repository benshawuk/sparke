# Sparke

Turns a standard MPA into an instantly snappy SPA by aggressively preloading
content and atomically swapping pages from memory, upon clicking links.
Just include the JS file - no build step, no config, instant super-snappy website.

Sparke uses progressive enhancement, so it fails safely:
if JavaScript is unavailable, the browser just behaves as a normal MPA.

## Installation

One `<script>` tag. No build step, no package.

```html
<!-- self-hosted (recommended) -->
<script src="/js/sparke.min.js" defer></script>

<!-- or via CDN -->
<script
  src="https://cdn.jsdelivr.net/gh/benshawuk/sparke@1/sparke.min.js"
  defer
></script>
```

Sparke works with plain HTML, AlpineJS, HTMX, or vanilla JS.
Just use `defer` and put it in the `<head>`.

## How it works

1. **Discovers** same-origin links.
2. **Preloads** those pages into memory while the browser is idle.
3. **Intercepts** plain left-click navigation.
4. **Swaps** the content in from memory.

The swap is simple atomic replacement - no diffing, no virtual DOM:

- If both pages have exactly one `<main>`, only `<main>` is replaced.
- Otherwise the `<body>` contents are replaced.

On each swap Sparke also updates `<title>` and `<meta name="description">`.

## What Sparke handles

Sparke intercepts same-origin `http`/`https` `<a href>` links. It lets the
browser handle everything else: `target` other than `_self`, `download`,
`rel="external"`, hash-only links, `mailto:`/`tel:`/`javascript:`, and any route
you exclude with `data-ignore`. Links Livewire owns for its own SPA navigation
(`wire:navigate`) are left to Livewire, so the two never fight (see
[Livewire & Alpine](#livewire--alpine)).

**Forms:** GET forms are intercepted and swapped like a link (fields serialized
into the query string). POST and other methods do an ordinary full submit - use
HTMX or Turbo if you need no-reload POST. Forms with `hx-*` attributes are skipped.

## Why

Alpine, Livewire, Inertia, and HTMX only hit the network *after* you click, so
every navigation is gated on a round trip - click, wait, then the page updates.
On a slow or distant connection that's a visible pause every single time.

Sparke flips the order: it preloads reachable same-origin pages into memory
while the browser is idle, *before* you click. So the click is an instant
in-memory swap with no request on the critical path.

|                                    | Network work happens         | A click feels like      |
| ---------------------------------- | ---------------------------- | ----------------------- |
| HTMX / Alpine / Livewire / Inertia | After the click              | Delay = round trip      |
| Sparke (true SPA)                  | Before the click, while idle | Instant swap from memory |

Those libraries solve a different problem (server-driven partials, reactivity,
no-reload forms) and run happily alongside Sparke. The only time you still see a
delay is the genuinely uncached case (see [Loading indicator](#loading-indicator)).

Every page Sparke serves is still a complete, server-rendered document - so you
keep the SEO, the no-JS fallback, and the progressive enhancement of an MPA.
Sparke just adds instant client-side swaps on top, with no hydration step and no
build, bundle, or framework to ship.

A side effect of holding pages in memory: once you've loaded the site and Sparke
has preloaded its links, you can drop offline and keep navigating - every
preloaded page still swaps in. Only genuinely server-side actions (POST forms,
fresh data) need the network.

## Common tasks

### Exclude routes

For pages a swap would break (admin, checkout, logout), opt out and they fall
back to full navigation:

```html
<!-- central: space-separated patterns; trailing * = prefix wildcard -->
<script
  src="sparke.min.js"
  defer
  data-ignore="/admin/* /checkout /logout"
></script>

<!-- per link: standard HTML, no Sparke API needed -->
<a href="/report.pdf" rel="external">Download report</a>
```

`/admin/*` matches everything under `/admin/` but not the bare `/admin` - list
both to cover the root. (To make a whole page Sparke-free, omit the `<script>` on it.)

### Re-run code after navigation

Sparke keeps the JS context alive across navigations, so scripts in fetched
pages **don't re-run** automatically. Mark a page's own script with
`data-sparke-rerun` and Sparke runs it on each swap. It must live in the swapped
region (inside `<main>`, or anywhere in `<body>`):

```html
<main>
  <canvas id="chart"></canvas>

  <!-- re-runs every time this page is swapped in -->
  <script data-sparke-rerun>
    initChart(document.getElementById("chart"));
  </script>

  <!-- run only on the first visit, then never again -->
  <script data-sparke-rerun="once" src="/widgets.js"></script>
</main>
```

A marked script re-runs in the same live context, so keep it idempotent: avoid
top-level `const`/`let`/`class`, and clean up old listeners/timers.

For site-wide logic (analytics, re-binding widgets) listen once instead of
repeating code on every page:

```js
window.addEventListener("sparke:after-swap", (e) => {
  initMyWidgets();
  // e.detail.from / e.detail.to are the URLs
});
```

### Active links

After navigation, the link to the current route gets `aria-current="page"`
(`/about`, `/about/`, `/about.html`, `/about/index.html` count as the same
route). Style it with no extra classes:

```css
nav a[aria-current="page"] {
  font-weight: 700;
}
```

To keep a parent link lit across a section, add `data-sparke-active`:

```html
<a href="/blog" data-sparke-active="/blog/*">Blog</a>
<!-- lit under /blog -->
<a href="/pricing" data-sparke-active="/plans">Pricing</a>
<!-- alias route -->
<a href="/shop" data-sparke-active="/shop/* /sale">Shop</a>
<!-- OR-ed -->
```

Trailing `*` = prefix wildcard; a plain value = an extra exact route. Matches
get the same `aria-current="page"`.

### Loading indicator

You rarely need one - preloaded navigation is instant. An indicator only shows
on the genuinely slow case (an uncached page on a slow connection). While a
navigation is in flight past a debounce, Sparke sets `<html data-sparke-loading>`,
so a CSS-only indicator works with zero JS:

```css
#progress {
  /* a fixed top bar, outside <main> so it survives swaps */
}
html[data-sparke-loading] #progress {
  transform: scaleX(0.8);
}

/* optionally dim controls so a link can't be hammered */
html[data-sparke-loading] a {
  pointer-events: none;
  opacity: 0.6;
}
```

It's debounced (default 150ms, set `data-loading-delay` on the script tag) so
instant navigations never flash. For richer behaviour, listen for
`sparke:loading` (`e.detail.active` is true/false).

### View transitions

Add `data-transitions` to animate swaps with the
[View Transitions API](https://developer.mozilla.org/docs/Web/API/View_Transitions_API):

```html
<script src="sparke.min.js" defer data-transitions></script>
```

Every swap gets a crossfade for free; give elements a matching
`view-transition-name` in CSS to morph them. Feature-detected and respects
`prefers-reduced-motion`. Off by default.

### Guard unsaved changes

A Sparke swap doesn't fire `beforeunload`, so guard `sparke:before-swap` instead

- `preventDefault()` keeps the user on the page with no reload:

```js
window.addEventListener("sparke:before-swap", (e) => {
  if (formIsDirty() && !confirm("Leave with unsaved changes?"))
    e.preventDefault();
});
```

Form values (text, selects, checkboxes/radios) are restored on Back/Forward,
matching the browser's back-forward cache. File and password fields are not.

## Stylesheets, scripts & accessibility

- **Stylesheets:** per-page `<head>` CSS works like an MPA - incoming page's
  `<style>`/`<link rel="stylesheet">` are applied, the page you leave drops its
  own, shared sheets stay put. Runtime-injected styles (themes, CSS-in-JS) are
  never touched. An external page-specific `<link>` may flash once on first visit
  (instant thereafter); inline `<style>` never flashes.
- **Scripts:** Sparke never executes scripts from fetched pages. Re-init via
  `sparke:after-swap` or `data-sparke-rerun` (above).
- **Alpine / Livewire:** components inside a swapped region are torn down cleanly
  and re-initialised - no config (see [Livewire & Alpine](#livewire--alpine)).
- **Accessibility:** after a swap, focus moves to `<main>` and the new `<title>`
  is announced via a visually-hidden `aria-live` region.
- **History & scroll:** navigation uses `pushState`; the address bar shows the
  final URL after a redirect (cross-origin redirects fall back to a full load);
  Back/forward restores from cache; forward navigation scrolls to top or the
  `#hash` target.

## Livewire & Alpine

Sparke works with [Alpine](https://alpinejs.dev) and [Livewire](https://livewire.laravel.com)
(which is built on Alpine) out of the box - no adapter, no config. When Alpine is
on the page, two things happen automatically on each swap:

- **New components initialise themselves.** Alpine's own observer picks up the
  swapped-in DOM and boots any Livewire/Alpine components in it, hydrating from
  the server-rendered markup. `@script` blocks re-run.
- **Removed components are torn down.** Sparke destroys the Alpine/Livewire
  components inside the region it swaps out (their effects, listeners,
  `wire:poll` timers, Echo subscriptions), so a long browsing session doesn't
  leak. This is the one thing Alpine's own observer misses when the swapped
  wrapper (e.g. `<main>`) isn't itself an Alpine root - so Sparke does it.

**Keep persistent components outside `<main>`.** Sparke swaps only `<main>` when
both pages have exactly one. A component in the shell around `<main>` (sidebar,
notifications, top bar) survives a swap untouched, keeping its state. A component
*inside* `<main>` is page-scoped: it is replaced wholesale on each navigation
(client-only state like a half-open dropdown resets, exactly as a real
navigation would).

**Don't use `wire:navigate`.** Sparke and Livewire's own SPA navigation both want
to drive navigation; running both is the one real conflict. Let Sparke own it and
leave `wire:navigate` off for a uniform, instant experience. If a `wire:navigate`
link slips through, Sparke leaves that specific link to Livewire so they never
fight - but a mixed page navigates inconsistently, so prefer all-Sparke.

```js
// Optional: some third-party Livewire/Alpine code listens for this. Sparke does
// not fire it; re-dispatch it after a swap if you need it.
window.addEventListener("sparke:after-swap", () =>
  document.dispatchEvent(new CustomEvent("livewire:navigated")),
);
```

**Known limits.** A component's JavaScript `@assets` are not loaded on swap
(Sparke never injects `<head>` scripts from fetched pages); load shared JS
globally. CSS `@assets` are fine - per-page stylesheets are handled like any MPA.

## Migrating an existing site

The one behavioural change: Sparke keeps the JS context alive across navigations
instead of throwing it away on each page load. Audit code that assumed every
navigation is a brand-new page:

- [ ] Per-page inline scripts (analytics, init) don't re-run after a swap - move
      them into a `sparke:after-swap` listener (plus one initial call), or mark
      them `data-sparke-rerun`.
- [ ] `DOMContentLoaded`/`load` fire only on the initial load, not on swaps.
- [ ] Global state, timers and `window`/`document` listeners persist - reset
      them in `after-swap` if a page assumed a clean slate.
- [ ] Listeners bound inside `<main>` are lost on swap - use event delegation or
      re-bind after each swap.

A site-wide "on every page view" hook, on for both Sparke and full loads:

```js
function onPageView(path) {
  /* analytics, etc. */
}

onPageView(location.pathname); // initial load + full-reload fallback
window.addEventListener("sparke:after-swap", (e) =>
  onPageView(new URL(e.detail.to).pathname),
); // every Sparke navigation
```

## API reference

Sparke is zero-config: everything here is optional, and there is **no JavaScript
API and no global object**. The only extension point is events.

**Naming:** dials on Sparke's own `<script>` tag are bare; attributes Sparke
reads or writes on **your** elements are namespaced `data-sparke-*`.

#### `<script>` tag config (read once at load)

| Attribute            | Default | Meaning                                                             |
| -------------------- | ------- | ------------------------------------------------------------------- |
| `data-transitions`   | off     | Opt into View Transitions.                                          |
| `data-loading-delay` | `150`   | Ms in flight before the loading state shows. `0` = immediate.       |
| `data-ignore`        | `""`    | Space-separated path patterns to exclude (trailing `*` = wildcard). |

#### Attributes on your elements

| Attribute            | On         | Meaning                                                                        |
| -------------------- | ---------- | ------------------------------------------------------------------------------ |
| `data-sparke-active` | `<a>`      | Active-link section highlighting (patterns; match gets `aria-current="page"`). |
| `data-sparke-rerun`  | `<script>` | Re-run this script on each swap. `="once"` = first visit only.                 |

#### Events (`CustomEvent` on `window`)

| Event                | Detail         | Cancelable | When                                                  |
| -------------------- | -------------- | ---------- | ----------------------------------------------------- |
| `sparke:navigate`    | `{ from, to }` | no         | A navigation is requested, before any network.        |
| `sparke:before-swap` | `{ from, to }` | **yes**    | About to swap. `preventDefault()` keeps the user put. |
| `sparke:after-swap`  | `{ from, to }` | no         | New content is in place.                              |
| `sparke:loading`     | `{ active }`   | no         | Loading state changed (debounced).                    |

#### State Sparke sets, and the header it sends

| Hook                                           | Meaning                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `<html data-sparke-loading>`                   | Present while a navigation is in flight past the delay.                |
| `a[aria-current="page"]`                       | The link to the current route (and `data-sparke-active` matches).      |
| `X-Sparke: preload \| navigate` request header | On every fetch - `preload` = idle prefetch, `navigate` = click/submit. |

## Clean URLs (server config)

Sparke just `fetch()`es whatever URL you link to. For extensionless URLs like
`/about`, your **server** must resolve them to `/about.html` (the browser
fallback would 404 otherwise). One-time config:

```nginx
# nginx
location / { try_files $uri $uri.html $uri/ =404; }
```

```caddy
# Caddy
try_files {path} {path}.html {path}/
```

```apache
# Apache (.htaccess) - simplest:
Options +MultiViews
```

**Static hosts:** Netlify serves `about.html` at `/about` by default; Vercel use
`"cleanUrls": true`; GitHub Pages has no rewrites - use folder pages
(`about/index.html`). For local dev of this repo's demo, `serve.py` does the same
fallback.

## Demo

`demo/` is a small multi-page site with a navbar and a Sparke ON/OFF toggle.
Because the demo uses clean URLs, run the included server from the project root:

```bash
python3 serve.py 8000   # open http://localhost:8000/
```

(Plain `python3 -m http.server` 404s on the extensionless links.) Watch the
**Header mounted** time freeze when Sparke is ON - proof the page's JS context
survives navigation. `demo/tabs-profile.html` shows tabs as real pages with no
tab-switching JS, styled purely from `aria-current="page"`.

## Browser support

Modern browsers with `fetch`, `DOMParser`, the History API and `CustomEvent`.
Anywhere older, Sparke quietly does nothing and the site behaves as a normal
multi-page website.

## Files

- `sparke.js` - the library (single file, no dependencies).
- `sparke.min.js` - minified build (~4.4 KB gzip). Use this in production.
- `build.sh` - regenerates the min build via `npx esbuild` (dev-only).
- `demo/` - the demo site. `serve.py` - local dev server with clean-URL fallback.
- `test/` - headless-Chrome test harness.

## License

[MIT](LICENSE) © Ben Shaw
