/*
 * Sparke v1.1
 * -----------------------------------------------------------------------------
 * Turn an ordinary multi-page website into an instant-feeling SPA by preloading
 * pages and swapping their content from memory.
 *
 * This is NOT a framework, router, or component system. It is a small browser
 * enhancement that fails safely to ordinary browser navigation in every error
 * case. If anything goes wrong, the browser does what it always would.
 *
 * Usage:
 *
 *     <script src="sparke.js"></script>
 *
 * No configuration. No attributes. No build step.
 *
 * The library does exactly four things:
 *   1. Discover same-origin links
 *   2. Preload those pages into memory
 *   3. Intercept navigation
 *   4. Swap content from memory
 */
(function () {
  "use strict";

  // -- Guard: bail out quietly in unsupported environments. ------------------
  // We need the History API and fetch. Without them the site simply behaves as
  // an ordinary multi-page website, which is the desired fallback anyway.
  if (
    typeof window === "undefined" ||
    typeof window.history === "undefined" ||
    typeof window.history.pushState !== "function" ||
    typeof window.fetch !== "function" ||
    typeof window.DOMParser === "undefined"
  ) {
    return;
  }

  // Avoid initialising twice if the script is included more than once.
  if (window.__sparkeInstalled) return;
  window.__sparkeInstalled = true;

  /**
   * In-memory page cache. Keyed by normalised URL.
   * Each entry: { url: string, html: string, document: Document }
   * No persistence, no TTL, no invalidation. The browser HTTP cache is enough.
   */
  var pages = new Map();

  // Configuration via data-* attributes on the <script> tag (read once, here,
  // while document.currentScript still points at us). Tier-1 config only.
  var dataset = (document.currentScript && document.currentScript.dataset) || {};

  // navigator.connection.saveData: a data-conscious visitor (mainly Android
  // data-saver). When set, Sparke backs off automatically - no image warming and
  // the crawl drops to a single hop. Best-effort (Chromium-only signal).
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  var config = {
    // data-transitions: opt into the View Transitions API (crossfade + any
    // author-defined shared-element morphs). Off unless the attribute present.
    transitions: dataset.transitions != null,
    // data-preload: how far ahead Sparke preloads page HTML.
    //   all  (default) - crawl the whole same-origin site, bounded by cacheSize
    //   page           - only the links on each visited page (one hop)
    //   visible        - a link's page when it scrolls near the viewport
    //   hover          - a link's page when it's hovered/focused (just-in-time)
    //   none           - no preloading (Sparke still swaps on click)
    // An explicit narrow scope is respected as-is; "all" (or anything
    // unrecognised) is the bold default, which saveData trims to one hop.
    preload: (function () {
      var v = (dataset.preload || "all").toLowerCase();
      if (v === "none" || v === "page" || v === "visible" || v === "hover") return v;
      return saveData ? "page" : "all";
    })(),
    // data-preload-images: warm images on preloaded pages so a swap has no
    // pop-in. all (default) = every <img>; off = none. saveData forces off.
    // (page/visible are reserved; treated as "all" for now.)
    preloadImages: (function () {
      if (saveData) return "off";
      var v = (dataset.preloadImages || "all").toLowerCase();
      return v === "off" || v === "none" ? "off" : "all";
    })(),
    // data-cache-size: LRU cap on parsed documents kept in memory; also bounds
    // the crawl. Default 100; minimum 1 (the page being viewed).
    cacheSize: (function () {
      var n = parseInt(dataset.cacheSize, 10);
      return isNaN(n) || n < 1 ? 100 : n;
    })(),
    // data-revalidate: stale-while-revalidate freshness. After each swap, the
    // links on the new page that are already cached get a quiet background
    // re-check (through the browser HTTP cache, so an unchanged page is a free
    // 304); a changed page updates the in-memory copy for next time, never
    // disturbing the page you're viewing. This is the throttle in SECONDS - an
    // entry checked more recently than this is skipped. Default 60; 0 = check
    // every navigation; "off" = never (a pure session cache). Stored as ms,
    // with Infinity meaning "never".
    revalidateMs: (function () {
      var raw = (dataset.revalidate || "").toLowerCase();
      if (raw === "off") return Infinity;
      var n = parseInt(dataset.revalidate, 10);
      if (isNaN(n) || n < 0) return 60000;
      return n * 1000;
    })(),
    // data-loading-delay: how long (ms) a navigation must be in flight before
    // Sparke sets <html data-sparke-loading>. The debounce stops fast/cached
    // navigations from flashing an indicator. Default 150ms; override with the
    // attribute (0 = show immediately).
    loadingDelay: (function () {
      var d = parseInt(dataset.loadingDelay, 10);
      return isNaN(d) || d < 0 ? 150 : d;
    })(),
    // data-ignore: a space-separated list of path patterns Sparke must never
    // preload or intercept (same matcher as data-sparke-active: a trailing "*"
    // is a prefix wildcard, any other value is an exact route). A link or GET
    // form whose path matches is left entirely to the browser - an ordinary
    // full-page navigation - so a route can opt out of Sparke centrally,
    // without per-link markup. Absent -> "" -> nothing excluded.
    ignore: dataset.ignore || "",
  };

  // The URL of the page currently rendered. Tracked independently of
  // window.location (which moves before our popstate handler runs) so we always
  // know which cached document we are leaving - used for stylesheet diffing.
  var currentUrl;

  // ===========================================================================
  // URL helpers
  // ===========================================================================

  /**
   * Normalise a pathname so that /about, /about/ and /about/index.html are all
   * treated as the same route. Used for cache keys and active-link matching.
   */
  function normalizePath(pathname) {
    var path = pathname || "/";
    // Strip a trailing index.html (or index.htm) -> "/foo/".
    path = path.replace(/\/index\.html?$/i, "/");
    // Treat "/about.html" and the clean URL "/about" as the same route, so a
    // site that mixes extensions and clean URLs shares one cache entry and
    // highlights active links correctly regardless of which form is linked.
    path = path.replace(/\.html?$/i, "");
    // Collapse a trailing slash (but keep the root "/").
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (path === "") path = "/";
    return path;
  }

  /**
   * Cache key for a URL: normalised pathname + search. We deliberately ignore
   * the hash, since the hash never changes which document we fetch.
   */
  function cacheKey(url) {
    try {
      var u = new URL(url, window.location.href);
      return normalizePath(u.pathname) + u.search;
    } catch (e) {
      return url;
    }
  }

  /**
   * Resolve an href to an absolute URL string, or null if it cannot parse.
   * `base` defaults to the live document; pass a page's own URL to resolve
   * links/images discovered inside a cached (inert) document.
   */
  function resolveUrl(href, base) {
    try {
      return new URL(href, base || window.location.href).href;
    } catch (e) {
      return null;
    }
  }

  // ===========================================================================
  // Link discovery / eligibility
  // ===========================================================================

  /**
   * True if a link is claimed by Livewire's own SPA navigation (wire:navigate,
   * with or without modifiers like .hover). Such links are left entirely to
   * Livewire, so Sparke and wire:navigate never both intercept the same click.
   * (Same principle as the hx-* deference for HTMX-managed forms.) For the best,
   * uniform experience, don't use wire:navigate with Sparke at all - let Sparke
   * own every navigation.
   */
  function hasWireNavigate(a) {
    var attrs = a.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var n = attrs[i].name;
      if (n === "wire:navigate" || n.indexOf("wire:navigate.") === 0) return true;
    }
    return false;
  }

  /**
   * Decide whether a given <a> element is one Sparke should handle.
   * Anything that returns false is left entirely to the browser.
   */
  function isEligibleLink(a, baseHref) {
    if (!a || a.tagName !== "A") return false;
    baseHref = baseHref || window.location.href;

    // Must have a concrete href attribute (not a JS link or anchor with none).
    var hrefAttr = a.getAttribute("href");
    if (!hrefAttr) return false;

    // Honour explicit opt-outs. Read via getAttribute so this also works on
    // anchors inside a parsed (inert) document during the crawl.
    var target = a.getAttribute("target");
    if (target && target !== "" && target !== "_self") return false;
    if (a.hasAttribute("download")) return false;
    var rel = (a.getAttribute("rel") || "").toLowerCase();
    if (rel.split(/\s+/).indexOf("external") !== -1) return false;

    // Leave links Livewire owns for its own SPA navigation to Livewire, so the
    // two navigation systems can never both intercept the same click.
    if (hasWireNavigate(a)) return false;

    var url = resolveUrl(hrefAttr, baseHref);
    if (!url) return false;

    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return false;
    }

    // Only http(s). Skips mailto:, tel:, javascript:, etc.
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;

    // Same-origin only.
    if (u.origin !== window.location.origin) return false;

    // Author-excluded route (data-ignore): leave it to the browser entirely.
    if (config.ignore && activeLinkMatch(config.ignore, normalizePath(u.pathname)))
      return false;

    // Ignore hash-only links (same document, just a different fragment).
    var here = new URL(baseHref);
    if (
      u.hash &&
      normalizePath(u.pathname) === normalizePath(here.pathname) &&
      u.search === here.search
    ) {
      return false;
    }

    return true;
  }

  /** Collect every eligible link currently in the document. */
  function discoverLinks(root, baseHref) {
    root = root || document;
    var anchors = root.querySelectorAll("a[href]");
    var urls = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (!isEligibleLink(a, baseHref)) continue;
      var url = resolveUrl(a.getAttribute("href"), baseHref);
      if (!url) continue;
      var key = cacheKey(url);
      if (seen[key]) continue;
      seen[key] = true;
      urls.push(url);
    }
    return urls;
  }

  // ===========================================================================
  // Preloading
  // ===========================================================================

  // In-flight requests, keyed by URL, so a click on a link that is still
  // preloading JOINS that request instead of firing a duplicate fetch (which
  // would roughly double the wait on a slow connection).
  var inflight = new Map();

  /**
   * Fetch and parse a page. Resolves to a cache entry on success, or null on
   * any reason it can't be swapped in (network error, non-HTML, or a redirect
   * that left the origin) - in which case the caller falls back to the browser.
   */
  function fetchPage(url, mode) {
    return fetch(url, { credentials: "same-origin", headers: { "X-Sparke": mode } })
      .then(function (res) {
        if (!res.ok) return null;
        var type = res.headers.get("content-type") || "";
        if (type.indexOf("text/html") === -1) return null;
        var cc = (res.headers.get("cache-control") || "").toLowerCase();
        var noStore = cc.indexOf("no-store") !== -1;
        return res.text().then(function (html) {
          return { html: html, finalUrl: res.url || url, noStore: noStore };
        });
      })
      .then(function (data) {
        if (!data) return null;
        if (new URL(data.finalUrl).origin !== window.location.origin) return null;
        var doc = new DOMParser().parseFromString(data.html, "text/html");
        var entry = { url: data.finalUrl, html: data.html, document: doc, checkedAt: Date.now() };
        // A no-store page must always be fetched fresh: return it for this
        // navigation, but never add it to the warm set.
        if (!data.noStore) cacheSet(cacheKey(data.finalUrl), entry); // key by FINAL url
        return entry;
      })
      .catch(function () {
        return null;
      });
  }

  /** Load a page, reusing a ready cache entry or an in-flight request. */
  function loadPage(url, mode) {
    var key = cacheKey(url);
    if (pages.get(key)) return Promise.resolve(pages.get(key));
    if (inflight.has(key)) return inflight.get(key);
    var promise = fetchPage(url, mode).then(function (entry) {
      inflight.delete(key);
      return entry;
    });
    inflight.set(key, promise);
    return promise;
  }

  /** Run a callback when the browser is idle (or shortly after, as a fallback). */
  var schedule =
    window.requestIdleCallback ||
    function (cb) {
      return window.setTimeout(function () {
        cb({ timeRemaining: function () { return 50; } });
      }, 200);
    };

  // ---- LRU cache ------------------------------------------------------------
  // A Map keeps insertion order, so the oldest key is the least-recently-used.
  // We re-insert on write and on hit, and evict from the front over the cap.

  /** Add or refresh a cache entry, evicting cold pages over `cacheSize`. */
  function cacheSet(key, entry) {
    if (pages.has(key)) pages.delete(key);
    pages.set(key, entry);
    var currentKey = cacheKey(currentUrl);
    var step;
    var it = pages.keys();
    while (pages.size > config.cacheSize && !(step = it.next()).done) {
      if (step.value !== currentKey) pages.delete(step.value); // never evict the live page
    }
  }

  /** Mark a cached entry most-recently-used so the cap evicts colder ones. */
  function cacheTouch(key) {
    if (!pages.has(key)) return;
    var entry = pages.get(key);
    pages.delete(key);
    pages.set(key, entry);
  }

  // ---- Image warming --------------------------------------------------------
  // Warms the BROWSER HTTP cache (not Sparke's heap), so a swap has no pop-in.

  var warmedImages = {}; // resolved image URLs already queued/requested
  var imageQueue = []; // URLs waiting to be warmed
  var imageActive = 0; // new Image() loads currently in flight
  var MAX_IMAGE_WARMS = 4; // concurrency cap: never flood (and rate-limit) a host

  /** First candidate URL in a srcset ("a.jpg 1x, b.jpg 2x" -> "a.jpg"). */
  function firstSrcsetUrl(srcset) {
    var first = srcset.split(",")[0];
    return first ? first.trim().split(/\s+/)[0] : null;
  }

  /**
   * Queue every <img> on a cached (inert) page for background warming, then
   * pump the queue. Includes loading="lazy" - the whole point is an instant,
   * local feel. <img src> plus the first srcset candidate; CSS backgrounds and
   * art-direction are out of scope.
   */
  function warmImages(entry) {
    if (config.preloadImages === "off" || !entry || !entry.document) return;
    var imgs = entry.document.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var ref = img.getAttribute("src");
      if (!ref) {
        var ss = img.getAttribute("srcset");
        ref = ss ? firstSrcsetUrl(ss) : null;
      }
      if (!ref) continue;
      var url = resolveUrl(ref, entry.url);
      if (!url || warmedImages[url]) continue;
      warmedImages[url] = true; // mark queued so it's never enqueued twice
      imageQueue.push(url);
    }
    schedule(pumpImages);
  }

  /** Free a warm slot when an image settles (load OR error) and pump the next. */
  function imageSettled() {
    imageActive--;
    pumpImages();
  }

  /**
   * Warm queued images at most MAX_IMAGE_WARMS at a time, via new Image()
   * (download + decode ahead). Capping concurrency is what stops an aggressive
   * crawl from flooding - and being rate-limited by - an image host, which would
   * otherwise break the very images it is trying to warm.
   */
  function pumpImages() {
    while (imageActive < MAX_IMAGE_WARMS && imageQueue.length) {
      imageActive++;
      var pre = new Image();
      pre.onload = imageSettled;
      pre.onerror = imageSettled;
      pre.src = imageQueue.shift();
    }
  }

  // ---- Preloading + whole-site crawl ---------------------------------------
  // data-preload "all" fans out into a bounded breadth-first crawl: preload a
  // page's HTML, warm its images, then discover its links and repeat - capped
  // by cacheSize. "page" stops after one hop; "none" disables it.

  var crawlSeen = {}; // cacheKeys already discovered (queued or cached)
  var crawlQueue = [];
  var crawlPending = false;
  var CRAWL_BATCH = 4; // pages started per idle tick; HTML stays ahead of images

  /** Queue eligible URLs for preloading, skipping ones already seen/cached. */
  function enqueue(urls) {
    if (config.preload === "none") return;
    for (var i = 0; i < urls.length; i++) {
      var key = cacheKey(urls[i]);
      if (crawlSeen[key]) continue;
      crawlSeen[key] = true;
      if (pages.has(key)) continue; // already warm
      crawlQueue.push(urls[i]);
    }
    scheduleCrawl();
  }

  function scheduleCrawl() {
    if (crawlPending || !crawlQueue.length || pages.size >= config.cacheSize) return;
    crawlPending = true;
    schedule(crawlStep);
  }

  function crawlStep() {
    crawlPending = false;
    var n = 0;
    while (crawlQueue.length && n < CRAWL_BATCH && pages.size < config.cacheSize) {
      loadPage(crawlQueue.shift(), "preload").then(onCrawled);
      n++;
    }
    scheduleCrawl(); // drain the rest on later ticks (no-op once empty/capped)
  }

  function onCrawled(entry) {
    if (!entry) return;
    warmImages(entry);
    if (config.preload === "all") {
      // Transitive: follow this page's links too, resolved against its own URL.
      enqueue(discoverLinks(entry.document, entry.url));
    }
  }

  // ---- Just-in-time scopes: visible (viewport) + hover ----------------------

  /** Preload one URL right away (no transitive crawl); used by visible/hover. */
  function preloadUrl(url) {
    var key = cacheKey(url);
    if (crawlSeen[key] || pages.has(key)) return;
    crawlSeen[key] = true;
    loadPage(url, "preload").then(onCrawled); // warms images; transitive only if "all"
  }

  var linkObserver = null;
  var observedLinks = typeof WeakSet === "function" ? new WeakSet() : null;

  /**
   * data-preload="visible": preload a link's page as it scrolls near the
   * viewport (rootMargin warms it a little early). Falls back to one-hop
   * preloading where IntersectionObserver is unavailable. Called again after
   * each swap to pick up the new page's links.
   */
  function observeLinks() {
    if (typeof IntersectionObserver === "undefined") {
      enqueue(discoverLinks(document, window.location.href)); // graceful fallback
      return;
    }
    if (!linkObserver) {
      linkObserver = new IntersectionObserver(
        function (entries) {
          for (var j = 0; j < entries.length; j++) {
            if (!entries[j].isIntersecting) continue;
            var a = entries[j].target;
            linkObserver.unobserve(a);
            if (isEligibleLink(a)) {
              var url = resolveUrl(a.getAttribute("href"));
              if (url) preloadUrl(url);
            }
          }
        },
        { rootMargin: "200px" }
      );
    }
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (observedLinks && observedLinks.has(a)) continue;
      if (!isEligibleLink(a)) continue;
      if (observedLinks) observedLinks.add(a);
      linkObserver.observe(a);
    }
  }

  /**
   * data-preload="hover": preload a link the moment it's hovered or focused
   * (just-in-time, before the click). One delegated listener, so swapped-in
   * links are covered automatically.
   */
  var hoverArmed = false;
  function armHover() {
    if (hoverArmed) return;
    hoverArmed = true;
    var onIntent = function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a && isEligibleLink(a)) {
        var url = resolveUrl(a.getAttribute("href"));
        if (url) preloadUrl(url);
      }
    };
    document.addEventListener("pointerover", onIntent);
    document.addEventListener("focusin", onIntent);
    document.addEventListener("touchstart", onIntent, { passive: true });
  }

  /**
   * Begin preloading from the current page, per data-preload:
   *   all     - bounded whole-site crawl (transitive)
   *   page    - the current page's links only (one hop, re-run per navigation)
   *   visible - links as they scroll near the viewport
   *   hover   - a link when it's hovered/focused
   *   none    - nothing
   */
  function preloadAll() {
    switch (config.preload) {
      case "none":
        return;
      case "hover":
        armHover();
        return;
      case "visible":
        observeLinks();
        return;
      default: // all + page
        enqueue(discoverLinks(document, window.location.href));
    }
  }

  // ---- Revalidation (stale-while-revalidate) --------------------------------
  // After each swap, re-check the cached pages reachable from the new one, so a
  // long browsing session can't drift stale. Activity-driven (no timers): the
  // browser HTTP cache makes an unchanged page a free 304; a changed page
  // updates the in-memory copy for next time. The page being viewed is never
  // re-fetched or re-rendered.

  var revalQueue = [];
  var revalPending = false;

  function scheduleReval() {
    if (revalPending || !revalQueue.length) return;
    revalPending = true;
    schedule(revalStep);
  }

  function revalStep() {
    revalPending = false;
    var n = 0;
    while (revalQueue.length && n < CRAWL_BATCH) {
      revalidateEntry(revalQueue.shift());
      n++;
    }
    scheduleReval();
  }

  /** Re-fetch one cached page; update its in-memory copy only if it changed. */
  function revalidateEntry(url) {
    var key = cacheKey(url);
    if (!pages.has(key)) return; // evicted since queued
    fetch(url, { credentials: "same-origin", headers: { "X-Sparke": "preload" } })
      .then(function (res) {
        if (!res.ok) return null;
        var type = res.headers.get("content-type") || "";
        if (type.indexOf("text/html") === -1) return null;
        var cc = (res.headers.get("cache-control") || "").toLowerCase();
        if (cc.indexOf("no-store") !== -1) {
          pages.delete(key); // turned no-store: drop it, always fetch fresh next time
          return null;
        }
        if (new URL(res.url || url).origin !== window.location.origin) return null;
        return res.text();
      })
      .then(function (html) {
        var entry = pages.get(key);
        if (!entry || html == null || html === entry.html) return; // unchanged
        entry.html = html;
        entry.document = new DOMParser().parseFromString(html, "text/html");
        warmImages(entry); // freshen any newly-referenced images
      })
      .catch(function () {});
  }

  /**
   * Queue stale cached links from the current page for a background re-check,
   * honouring the data-revalidate throttle. Runs after every swap.
   */
  function revalidateLinks() {
    if (config.revalidateMs === Infinity) return; // off
    var urls = discoverLinks(document, window.location.href);
    var now = Date.now();
    var currentKey = cacheKey(currentUrl);
    for (var i = 0; i < urls.length; i++) {
      var key = cacheKey(urls[i]);
      if (key === currentKey) continue; // never re-fetch the page being viewed
      var entry = pages.get(key);
      if (!entry) continue; // not cached -> the preload path owns it
      if (now - (entry.checkedAt || 0) < config.revalidateMs) continue; // throttled
      entry.checkedAt = now; // mark checked now, so one nav queues it at most once
      revalQueue.push(urls[i]);
    }
    scheduleReval();
  }

  // ===========================================================================
  // Head synchronisation
  // ===========================================================================

  /**
   * Copy a small, safe set of head elements from the incoming document.
   * We never touch scripts or stylesheets.
   */
  function syncHead(incoming) {
    // <title> is always updated.
    var newTitle = incoming.querySelector("title");
    document.title = newTitle ? newTitle.textContent : document.title;

    // <meta name="description"> and <link rel="canonical"> are replaced if
    // present in the incoming document.
    syncHeadEl('meta[name="description"]', incoming);
    syncHeadEl('link[rel="canonical"]', incoming);
  }

  function syncHeadEl(selector, incoming) {
    var next = incoming.querySelector(selector);
    var current = document.head.querySelector(selector);
    if (next) {
      var clone = document.importNode(next, true);
      if (current) current.replaceWith(clone);
      else document.head.appendChild(clone);
    } else if (current) {
      current.remove();
    }
  }

  /**
   * Bring across per-page attributes so CSS keyed off them stays correct.
   *  - <body>: full attribute sync (the common `<body class="page-about">` case).
   *  - <html>: only lang/dir. We deliberately leave <html> class/style alone so
   *    runtime-managed attributes (e.g. a `dark` theme class) survive a swap.
   */
  function syncAttributes(incoming) {
    var inHtml = incoming.documentElement;
    if (inHtml) {
      var htmlAttrs = ["lang", "dir"];
      for (var i = 0; i < htmlAttrs.length; i++) {
        var name = htmlAttrs[i];
        if (inHtml.hasAttribute(name)) {
          document.documentElement.setAttribute(name, inHtml.getAttribute(name));
        } else {
          document.documentElement.removeAttribute(name);
        }
      }
    }
    if (incoming.body) copyAttributes(incoming.body, document.body);
  }

  function copyAttributes(from, to) {
    // Remove attributes the incoming element no longer has.
    var current = Array.prototype.slice.call(to.attributes);
    for (var i = 0; i < current.length; i++) {
      if (!from.hasAttribute(current[i].name)) to.removeAttribute(current[i].name);
    }
    // Add/update from the incoming element.
    for (var j = 0; j < from.attributes.length; j++) {
      var a = from.attributes[j];
      if (to.getAttribute(a.name) !== a.value) to.setAttribute(a.name, a.value);
    }
  }

  // ===========================================================================
  // Per-page stylesheets
  // ===========================================================================
  //
  // Make page-specific <head> CSS (<style> blocks and <link rel="stylesheet">)
  // behave like an ordinary MPA: present the new page's styles, drop the old
  // page's. We diff the OUTGOING and INCOMING cached documents (both owned by
  // Sparke), never the live DOM - so shared global stylesheets (in both) are
  // left in place, and runtime-injected styles (in neither) are never touched.
  // A <style> inside <main> already travels with the swapped content, so only
  // head-level CSS needs handling here.

  /** A stable identity for a stylesheet node: its href, or its inline text. */
  function cssKey(el) {
    if (el.tagName === "LINK") {
      try {
        return "L:" + new URL(el.getAttribute("href"), window.location.href).href;
      } catch (e) {
        return "L:" + el.getAttribute("href");
      }
    }
    return "S:" + el.textContent;
  }

  function cssNodes(doc) {
    var out = [];
    if (!doc || !doc.head) return out;
    var nodes = doc.head.querySelectorAll('link[rel~="stylesheet"][href], style');
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
    return out;
  }

  function syncStylesheets(fromDoc, toDoc) {
    // Index what the new page wants, and what is live right now.
    var want = {};
    var toList = cssNodes(toDoc);
    for (var i = 0; i < toList.length; i++) want[cssKey(toList[i])] = true;

    var live = {};
    var liveNodes = cssNodes(document);
    for (var j = 0; j < liveNodes.length; j++) live[cssKey(liveNodes[j])] = liveNodes[j];

    // Remove styles the OUTGOING page had that the incoming page does not want.
    var fromList = cssNodes(fromDoc);
    for (var k = 0; k < fromList.length; k++) {
      var key = cssKey(fromList[k]);
      if (!want[key] && live[key]) {
        live[key].remove();
        delete live[key];
      }
    }
    // Add styles the incoming page wants that are not already present.
    for (var m = 0; m < toList.length; m++) {
      if (!live[cssKey(toList[m])]) {
        document.head.appendChild(document.importNode(toList[m], true));
      }
    }
  }

  // ===========================================================================
  // Active links
  // ===========================================================================

  /**
   * Test a `data-sparke-active` pattern against the current route. A trailing
   * "*" is a wildcard (prefix match: `/blog/*` lights on `/blog/anything`);
   * any other value is an extra exact route (a clean-URL alias). Multiple
   * space-separated patterns are OR-ed, so one nav item can cover several
   * URL groups. Opt-in: only links carrying the attribute are considered.
   */
  function activeLinkMatch(pattern, current) {
    var parts = pattern.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (p.charAt(p.length - 1) === "*") {
        if (current.indexOf(p.slice(0, -1)) === 0) return true;
      } else if (current === normalizePath(p)) {
        return true;
      }
    }
    return false;
  }

  /** Mark links pointing at the current route with aria-current="page". */
  function updateActiveLinks() {
    var current = normalizePath(window.location.pathname);
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var url = resolveUrl(a.getAttribute("href"));
      var match = false;
      if (url) {
        try {
          var u = new URL(url);
          match =
            u.origin === window.location.origin &&
            normalizePath(u.pathname) === current;
        } catch (e) {
          match = false;
        }
      }
      // Opt-in section highlighting: a link with data-sparke-active also lights
      // up when its pattern matches, so a nav parent can stay current across
      // all of its child pages without any author JS.
      if (!match) {
        var pattern = a.getAttribute("data-sparke-active");
        if (pattern) match = activeLinkMatch(pattern, current);
      }
      if (match) a.setAttribute("aria-current", "page");
      else if (a.getAttribute("aria-current") === "page")
        a.removeAttribute("aria-current");
    }
  }

  // ===========================================================================
  // Swapping
  // ===========================================================================

  /**
   * Swap the current document's content for the incoming document's content.
   *
   * Rule 1: if both documents contain exactly one <main>, swap only <main>.
   * Rule 2: otherwise replace the whole <body>'s children.
   *
   * Returns true on success, false if the caller should fall back to native
   * navigation.
   */
  /**
   * Can we swap this incoming document? Mirrors swap()'s decision so we can
   * check feasibility BEFORE starting an (async) view transition.
   */
  function canSwap(incoming) {
    var cm = document.querySelectorAll("main").length;
    var im = incoming.querySelectorAll("main").length;
    if (cm === 1 && im === 1) return true;
    return !!incoming.body; // body-swap path needs an incoming <body>
  }

  function swap(incoming) {
    var currentMains = document.querySelectorAll("main");
    var incomingMains = incoming.querySelectorAll("main");

    if (currentMains.length === 1 && incomingMains.length === 1) {
      var incomingMain = document.importNode(incomingMains[0], true);
      currentMains[0].replaceWith(incomingMain);
    } else {
      var incomingBody = incoming.body;
      if (!incomingBody) return false;
      var nodes = [];
      var children = incomingBody.childNodes;
      for (var i = 0; i < children.length; i++) {
        nodes.push(document.importNode(children[i], true));
      }
      document.body.replaceChildren.apply(document.body, nodes);
    }
    return true;
  }

  // ===========================================================================
  // Per-page script re-execution (opt-in)
  // ===========================================================================

  // Scripts in swapped-in content never run on their own (inserted markup is
  // inert). By default Sparke leaves it that way. Opt a script in with
  // `data-sparke-rerun` and it is re-executed on every swap; `="once"` runs it
  // only the first time its page is shown. The author owns idempotency.
  var ranOnce = {};
  function runPageScripts() {
    var list = document.querySelectorAll("script[data-sparke-rerun]");
    for (var i = 0; i < list.length; i++) {
      var old = list[i];
      var key = old.src || old.textContent;
      if (old.getAttribute("data-sparke-rerun") === "once") {
        if (ranOnce[key]) continue;
        ranOnce[key] = true;
      }
      // Clone into a fresh element so the browser actually executes it.
      var s = document.createElement("script");
      for (var j = 0; j < old.attributes.length; j++)
        s.setAttribute(old.attributes[j].name, old.attributes[j].value);
      s.text = old.textContent;
      s.async = false; // preserve order for src scripts
      old.replaceWith(s);
    }
  }

  // ===========================================================================
  // Alpine teardown (no-op unless Alpine is on the page)
  // ===========================================================================
  //
  // A swap removes whole DOM subtrees. Alpine - which Livewire is built on -
  // tears an element down (running its cleanups: effects, listeners, wire:poll
  // timers, Echo subscriptions) via its MutationObserver only when the *removed*
  // node was itself Alpine-initialised. A plain wrapper like <main> sitting above
  // the component roots is never marked, so Alpine skips it and the components
  // inside it would leak on every navigation.
  //
  // So Sparke cleans up after its own swaps: snapshot the live Alpine/Livewire
  // roots before a swap, then destroy any the swap left detached. Roots that
  // survive the swap (a persistent shell outside the swapped <main>) stay
  // connected and are left untouched, keeping their state. Freshly swapped-in
  // roots re-initialise themselves through Alpine's own observer, so only
  // teardown is ours to do. Uses only the public Alpine.destroyTree, wrapped so a
  // future Alpine change can at worst degrade to the old (leaky) behaviour -
  // never break navigation.

  var alpineRoots = [];

  /** Record the live Alpine/Livewire roots just before a swap replaces the DOM. */
  function alpineSnapshot() {
    if (!window.Alpine) return;
    alpineRoots = Array.prototype.slice.call(
      document.querySelectorAll("[wire\\:id],[x-data]")
    );
  }

  /** Destroy the snapshotted roots the swap detached; leave survivors alone. */
  function alpineCleanup() {
    if (window.Alpine && typeof window.Alpine.destroyTree === "function") {
      for (var i = 0; i < alpineRoots.length; i++) {
        if (!alpineRoots[i].isConnected) {
          try {
            window.Alpine.destroyTree(alpineRoots[i]);
          } catch (e) {}
        }
      }
    }
    alpineRoots = [];
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  function emit(name, detail) {
    return window.dispatchEvent(
      new CustomEvent(name, { detail: detail, cancelable: true })
    );
  }

  // ===========================================================================
  // Navigation
  // ===========================================================================

  /** Hard fallback: hand control back to the browser. */
  function fallback(url) {
    window.location.href = url;
  }

  /** Scroll to the target's #hash element if present, otherwise to the top. */
  function scrollToTarget(to) {
    var hash = "";
    try {
      hash = new URL(to, window.location.href).hash;
    } catch (e) {}
    if (hash && hash.length > 1) {
      var el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }

  /**
   * Announce the new page to assistive technology, the way a real navigation
   * would. A visually-hidden aria-live region speaks the new title.
   */
  function announce(text) {
    var region = document.getElementById("sparke-live-region");
    if (!region) {
      region = document.createElement("div");
      region.id = "sparke-live-region";
      region.setAttribute("aria-live", "assertive");
      region.setAttribute("aria-atomic", "true");
      region.setAttribute("role", "status");
      region.style.cssText =
        "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
        "overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
      document.body.appendChild(region);
    }
    region.textContent = "";
    // Set on a later tick so the change is detected and announced.
    window.setTimeout(function () {
      region.textContent = text || "";
    }, 50);
  }

  /** Move focus to <main> so keyboard and screen-reader users land on content. */
  function focusMain() {
    var target = document.querySelector("main") || document.body;
    var addedTabindex = !target.hasAttribute("tabindex");
    if (addedTabindex) target.setAttribute("tabindex", "-1");

    // Suppress the focus ring for this programmatic focus: <main> is a landmark,
    // not an interactive control, so an outline on every navigation is just
    // visual noise. Focus (and the announcement) still happen for assistive tech.
    var prevOutline = target.style.outline;
    target.style.outline = "none";

    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      target.focus();
    }

    // Tidy up once focus leaves: drop the temp tabindex and restore the outline.
    target.addEventListener("blur", function handler() {
      if (addedTabindex) target.removeAttribute("tabindex");
      target.style.outline = prevOutline;
      target.removeEventListener("blur", handler);
    });
  }

  // ===========================================================================
  // Form state (restore on back/forward)
  // ===========================================================================
  //
  // A real browser restores typed-in form values when you press Back. A swap
  // isn't a real navigation, so we replicate it: capture field values when
  // leaving a page, and restore them ONLY on history navigation (popstate) -
  // never on a fresh forward visit, exactly as the platform behaves. This is
  // form values only, not full page-state keep-alive.

  var formState = {};
  // File and password fields are intentionally not captured/restored.
  var FORM_SELECTOR =
    "input:not([type=file]):not([type=password]):not([type=submit]):not([type=button]), textarea, select";

  function formControls() {
    var scope = document.querySelector("main") || document.body;
    return scope.querySelectorAll(FORM_SELECTOR);
  }

  function captureFormState(url) {
    var controls = formControls();
    if (!controls.length) {
      delete formState[cacheKey(url)];
      return;
    }
    var data = [];
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      if (el.type === "checkbox" || el.type === "radio") {
        data.push({ c: el.checked });
      } else if (el.tagName === "SELECT" && el.multiple) {
        var sel = [];
        for (var o = 0; o < el.options.length; o++) if (el.options[o].selected) sel.push(o);
        data.push({ m: sel });
      } else {
        data.push({ v: el.value });
      }
    }
    formState[cacheKey(url)] = data;
  }

  function restoreFormState(url) {
    var data = formState[cacheKey(url)];
    if (!data) return;
    var controls = formControls();
    // Only restore if the structure matches what we captured (same cached doc),
    // so positional restore is reliable.
    if (controls.length !== data.length) return;
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      var d = data[i];
      if ("c" in d) el.checked = d.c;
      else if ("m" in d) {
        for (var o = 0; o < el.options.length; o++) el.options[o].selected = d.m.indexOf(o) !== -1;
      } else if ("v" in d) {
        el.value = d.v;
      }
    }
  }

  /**
   * Render a cached (or freshly fetched) page entry into the live document.
   * `toUrl` is the URL to show in the address bar (may differ from the cached
   * entry's URL, e.g. it carries a #hash, or the entry was reached via a
   * redirect). `push` controls history; `restoreScroll` lets popstate leave
   * scrolling and focus to the browser.
   */
  function render(entry, toUrl, push, restoreScroll) {
    // `currentUrl` is the page we're leaving (reliable even on popstate).
    var from = currentUrl;
    var to = toUrl || entry.url;
    var fromEntry = pages.get(cacheKey(currentUrl));
    var fromDoc = fromEntry ? fromEntry.document : null;

    // before-swap is cancelable: a listener can preventDefault to KEEP the user
    // on the current page (e.g. an unsaved-changes guard). A cancel is distinct
    // from a failure - we must not fall back to a full load in that case.
    if (!emit("sparke:before-swap", { from: from, to: to })) {
      return "cancelled";
    }

    // Check feasibility before any (async) view transition starts.
    if (!canSwap(entry.document)) {
      return "failed";
    }

    // Capture the outgoing page's form values before we replace its DOM, so a
    // later Back can restore them (see onPopState).
    captureFormState(currentUrl);

    // Record the live Alpine/Livewire roots now, so once the swap detaches the
    // outgoing ones we can tear them down (Alpine's observer misses them).
    alpineSnapshot();

    // The DOM mutation itself. Wrapped in a view transition when enabled, so
    // the browser can crossfade (and animate any author-defined shared elements
    // via `view-transition-name`).
    function applyChanges() {
      // Stylesheets first so external <link>s start loading as early as possible.
      syncStylesheets(fromDoc, entry.document);
      swap(entry.document);
      syncHead(entry.document);
      syncAttributes(entry.document);
    }

    // Everything that should happen once the new content is in place.
    function finish() {
      if (push) history.pushState({ sparke: true }, "", to);
      currentUrl = to;
      // The swap has detached the outgoing DOM; tear down any Alpine/Livewire
      // components it removed (Alpine's own observer would miss them).
      alpineCleanup();
      updateActiveLinks();
      runPageScripts();
      if (!restoreScroll) {
        scrollToTarget(to);
        focusMain();
      }
      // Announce the new page to assistive technology (forward + back/forward).
      announce(document.title);
      emit("sparke:after-swap", { from: from, to: to });
      // Pick up links revealed by this swap, per scope: "page" re-discovers the
      // now-live page (one hop), "visible" observes its new links. "all" already
      // crawled transitively from the entry page; "hover" uses a delegated
      // listener that covers swapped-in links; "none" preloads nothing.
      if (config.preload === "page") enqueue(discoverLinks(document, window.location.href));
      else if (config.preload === "visible") observeLinks();
      // Quietly re-check the now-reachable cached pages for freshness.
      revalidateLinks();
    }

    if (useTransitions()) {
      // startViewTransition runs the callback asynchronously, so sequence the
      // post-swap work off updateCallbackDone. If the swap throws mid-transition
      // (rare), recover with a full navigation.
      var vt = document.startViewTransition(applyChanges);
      activeTransition = vt;
      var clearActive = function () {
        if (activeTransition === vt) activeTransition = null;
      };
      vt.finished.then(clearActive, clearActive);
      vt.updateCallbackDone.then(finish, function () {
        fallback(to);
      });
    } else {
      try {
        applyChanges();
      } catch (e) {
        return "failed";
      }
      finish();
    }
    return "ok";
  }

  /**
   * Whether to animate this swap with the View Transitions API. Opt-in
   * (data-transitions), feature-detected, and disabled under reduced-motion.
   */
  function useTransitions() {
    return (
      config.transitions &&
      typeof document.startViewTransition === "function" &&
      !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );
  }

  // Monotonic navigation token. Each navigation (or popstate) bumps it; a
  // pending on-demand fetch only renders if it is still the latest navigation.
  // This prevents a slow earlier fetch from landing on top of a later one.
  var navToken = 0;

  // The in-progress view transition (if any), so a pointerdown can skip it and
  // restore interactivity immediately.
  var activeTransition = null;

  // Loading state. While a navigation is in flight past `loadingDelay`, Sparke
  // sets <html data-sparke-loading> AND fires a `sparke:loading` event with
  // detail.active toggling true/false - the attribute drives a CSS-only
  // indicator (zero JS), the event is the hook for richer behaviour. The
  // debounce means fast/cached navigations never flash. `loadingActive` tracks
  // whether we are currently showing, so the off-transition only fires once and
  // only when an on-transition actually happened.
  var loadingTimer = 0;
  var loadingActive = false;

  function loadingStart(token) {
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(function () {
      if (token !== navToken || loadingActive) return;
      loadingActive = true;
      document.documentElement.setAttribute("data-sparke-loading", "");
      emit("sparke:loading", { active: true });
    }, config.loadingDelay);
  }

  function loadingStop() {
    clearTimeout(loadingTimer);
    if (!loadingActive) return;
    loadingActive = false;
    document.documentElement.removeAttribute("data-sparke-loading");
    emit("sparke:loading", { active: false });
  }

  /**
   * Navigate to a URL using the cache. If the page is not cached yet, fetch it
   * on demand. A failed swap falls back to native navigation; a cancelled
   * before-swap leaves the user where they are.
   */
  function navigate(url, push, restoreScroll) {
    var token = ++navToken;

    // Fire a navigation-requested event up front (before any network), so a
    // site can show a loading indicator for the slow, not-yet-cached case.
    emit("sparke:navigate", { from: window.location.href, to: url });

    var key = cacheKey(url);
    var entry = pages.get(key);

    if (entry) {
      // Cached, same-origin page. Show exactly what was requested (keeps #hash).
      // Cancel any indicator left over from a superseded in-flight navigation.
      cacheTouch(key); // most-recently-used
      loadingStop();
      if (render(entry, url, push, restoreScroll) === "failed") fallback(url);
      return;
    }

    // Not cached: real fetch ahead, so arm the (debounced) loading indicator.
    // Joins an in-flight preload if there is one.
    loadingStart(token);
    loadPage(url, "navigate").then(function (fresh) {
      if (token !== navToken) return; // superseded: a later navigation owns the indicator
      loadingStop();
      // null = error / non-HTML / cross-origin redirect: hand off to the browser.
      if (!fresh) {
        fallback(url);
        return;
      }
      // If redirected, show the final URL; otherwise keep the requested URL
      // (so any #hash is preserved for scroll + history).
      var redirected = cacheKey(fresh.url) !== cacheKey(url);
      var toUrl = redirected ? fresh.url : url;
      if (render(fresh, toUrl, push, restoreScroll) === "failed") fallback(url);
    });
  }

  // ===========================================================================
  // Click interception
  // ===========================================================================

  function onClick(event) {
    // Only plain left-clicks with no modifier keys.
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    // Find the anchor that was clicked (the target may be a child element).
    var a = event.target.closest ? event.target.closest("a[href]") : null;
    if (!a || !isEligibleLink(a)) return;

    var url = resolveUrl(a.getAttribute("href"));
    if (!url) return;

    // We are handling it: stop the browser's own navigation.
    event.preventDefault();
    navigate(url, true, false);
  }

  // ===========================================================================
  // Form interception (GET only)
  // ===========================================================================
  //
  // A GET form is just "a link with a computed URL", so we can swap it like any
  // other navigation. POST (and other non-GET) forms have side effects, history
  // and validation semantics that belong in a purpose-built tool (HTMX/Turbo),
  // so we leave them entirely to the browser - an ordinary full-page submit.

  /** True if the element carries HTMX-style attributes (leave it to that tool). */
  function hasHxAttr(el) {
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var n = attrs[i].name;
      if (n.indexOf("hx-") === 0 || n.indexOf("data-hx-") === 0) return true;
    }
    return false;
  }

  /** Resolve the effective form action, honouring a submitter's formaction. */
  function formActionFor(form, submitter) {
    if (submitter && submitter.hasAttribute("formaction")) return submitter.formAction;
    return form.action;
  }

  /**
   * Serialize a form's fields into a query string, exactly as a native GET
   * submit would. Includes the activating submit button's name/value; omits
   * unchecked checkboxes (FormData already does). Returns null if a file field
   * holds a file (GET can't carry files -> caller falls back to native submit).
   */
  function serializeForm(form, submitter) {
    var params = new URLSearchParams();
    var data = new FormData(form);
    var entries = data.entries();
    var next;
    while (!(next = entries.next()).done) {
      // GET forms cannot carry files; if one is present, signal a fallback.
      if (typeof File !== "undefined" && next.value[1] instanceof File) return null;
      params.append(next.value[0], next.value[1]);
    }
    // FormData omits submit buttons; include the activating button if named.
    if (submitter && submitter.name) params.append(submitter.name, submitter.value);
    return params.toString();
  }

  /** Decide whether a form submission is one Sparke should handle. */
  function isEligibleForm(form, submitter) {
    if (!form || form.tagName !== "FORM") return false;

    // Effective method; a submit button can override it via formmethod.
    var method = (
      (submitter && submitter.getAttribute("formmethod")) ||
      form.getAttribute("method") ||
      "get"
    ).toLowerCase();
    if (method !== "get") return false; // POST etc. -> browser handles it

    // Leave forms managed by another tool (e.g. HTMX) untouched.
    if (hasHxAttr(form)) return false;

    // Target must be the current document.
    var target = (submitter && submitter.getAttribute("formtarget")) || form.target;
    if (target && target !== "" && target !== "_self") return false;

    // Action must resolve to a same-origin http(s) URL. Note: a submitter's
    // .formAction returns the document URL when it has no formaction attribute,
    // so only trust it when the attribute is actually present.
    var action = formActionFor(form, submitter);
    var u;
    try {
      u = new URL(action, window.location.href);
    } catch (e) {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.origin !== window.location.origin) return false;

    // Author-excluded route (data-ignore): leave the submit to the browser.
    if (config.ignore && activeLinkMatch(config.ignore, normalizePath(u.pathname)))
      return false;

    return true;
  }

  function onSubmit(event) {
    if (event.defaultPrevented) return;

    var form = event.target;
    var submitter = event.submitter;
    if (!isEligibleForm(form, submitter)) return;

    var action = formActionFor(form, submitter);
    var url;
    try {
      url = new URL(action, window.location.href);
      // Build the query string from the form's fields. This replaces any query
      // already present in the action, exactly as a native GET submit does.
      var qs = serializeForm(form, submitter);
      if (qs === null) return; // a file field is present -> native submit
      url.search = qs;
    } catch (e) {
      return; // anything unexpected -> let the browser submit normally
    }

    event.preventDefault();
    navigate(url.href, true, false);
  }

  // ===========================================================================
  // History (back / forward)
  // ===========================================================================

  function onPopState() {
    ++navToken; // a history move supersedes any in-flight on-demand fetch
    loadingStop(); // and clears any loading indicator that fetch had shown
    var url = window.location.href;
    var key = cacheKey(url);
    if (pages.has(key) && pages.get(key)) {
      // Cached: restore from memory. Do not push (the browser already moved
      // the history pointer). Let the browser handle scroll restoration.
      if (render(pages.get(key), url, false, true) === "ok") {
        // Restore typed-in form values, the way bfcache would on a real Back.
        restoreFormState(url);
      }
    } else {
      // Not cached: the simplest correct behaviour is a real reload.
      window.location.reload();
    }
  }

  // ===========================================================================
  // Initialisation
  // ===========================================================================

  function init() {
    // Let the browser manage scroll position across history navigation.
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "auto";
    }

    // Seed the cache with the current page so back/forward to it is instant.
    // We must store an INDEPENDENT snapshot, not the live `document`: every
    // swap mutates the live document, which would otherwise poison this entry
    // and make a later return to this page show stale content.
    var snapshot = "<!doctype html>\n" + document.documentElement.outerHTML;
    pages.set(cacheKey(window.location.href), {
      url: window.location.href,
      html: snapshot,
      document: new DOMParser().parseFromString(snapshot, "text/html"),
      checkedAt: Date.now(),
    });
    currentUrl = window.location.href;

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPopState);

    // During a view transition the whole page is captured as a snapshot, so the
    // live DOM is inert (not hit-testable) for the animation's duration - a
    // click on it would be lost. So if the user presses during a transition, let
    // that press TAKE OVER: skip the current transition, then once the live DOM
    // is interactive again, hit-test under the pointer and navigate to whatever
    // link was there. The old transition stops and the new navigation begins.
    if (config.transitions && typeof document.startViewTransition === "function") {
      document.addEventListener(
        "pointerdown",
        function (event) {
          var t = activeTransition;
          if (!t) return;

          // Any interaction skips the transition so the page isn't frozen.
          try {
            t.skipTransition();
          } catch (e) {}

          // Only the primary, unmodified mouse/pen press "takes over" and
          // navigates to the link under it. Touch is excluded (a touchstart is
          // often a scroll, not a tap - don't hijack it); the native tap
          // navigates once interactivity is restored.
          if (
            event.button !== 0 ||
            event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
            event.pointerType === "touch"
          ) {
            return;
          }
          var x = event.clientX;
          var y = event.clientY;
          t.finished.then(takeOver, takeOver);
          function takeOver() {
            var el = document.elementFromPoint(x, y);
            var a = el && el.closest ? el.closest("a[href]") : null;
            if (a && isEligibleLink(a)) {
              var url = resolveUrl(a.getAttribute("href"));
              if (url) navigate(url, true, false);
            }
          }
        },
        true
      );
    }

    updateActiveLinks();
    // A data-sparke-rerun="once" script on the landing page already ran during
    // the initial parse, so record it now and it won't re-run on a swap back.
    var seed = document.querySelectorAll('script[data-sparke-rerun="once"]');
    for (var i = 0; i < seed.length; i++)
      ranOnce[seed[i].src || seed[i].textContent] = true;
    preloadAll();

    // Test hook: expose the pure internal helpers for unit testing, but ONLY
    // when the script tag carries a `data-test` marker. Never present in normal
    // use, so it can't be relied on as a public API.
    if (dataset.test != null) {
      window.__sparkeInternals = {
        normalizePath: normalizePath,
        activeLinkMatch: activeLinkMatch,
        cacheKey: cacheKey,
        resolveUrl: resolveUrl,
        isEligibleLink: isEligibleLink,
        discoverLinks: discoverLinks,
        cssKey: cssKey,
        canSwap: canSwap,
        isEligibleForm: isEligibleForm,
        formActionFor: formActionFor,
        hasHxAttr: hasHxAttr,
        hasWireNavigate: hasWireNavigate,
        serializeForm: serializeForm,
        captureFormState: captureFormState,
        restoreFormState: restoreFormState,
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
