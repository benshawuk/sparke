/*
 * Demo harness for Sparke. NOT part of the library.
 *
 * Responsibilities:
 *  - Load ../sparke.js unless the user has switched it off (localStorage).
 *  - Wire up the on/off toggle button in the navbar.
 *  - Render three indicators that make the SPA behaviour visible:
 *      #mounted : the time this header's JS first ran. With Sparke ON it stays
 *                 FROZEN across navigation (header is never re-parsed, content
 *                 is swapped from memory). With Sparke OFF it changes on every
 *                 click (each navigation is a full page load).
 *      #now     : a live clock, proof the JS context survives navigation.
 *      #swaps   : how many times Sparke swapped content (0 when OFF).
 */
(function () {
  var DISABLED_KEY = "sparke-disabled";
  var TRANSITIONS_KEY = "sparke-transitions";
  var enabled = localStorage.getItem(DISABLED_KEY) !== "1";
  var transitions = localStorage.getItem(TRANSITIONS_KEY) === "1";

  // Load the library itself, unless switched off. Pass data-transitions through
  // when the demo's Transitions toggle is on, so you can play with view
  // transitions live.
  if (enabled) {
    var s = document.createElement("script");
    s.src = "../sparke.js";
    if (transitions) s.setAttribute("data-transitions", "");
    document.head.appendChild(s);
  }

  // The header JS mount time. Captured once per real page load.
  var mountedAt = new Date();

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function clock(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Renders the submitted GET-form query on the Results page. This lives in the
  // site-wide script (not an inline <script> on results.html) precisely because
  // Sparke does not execute scripts from swapped-in pages - so we read the query
  // here, on initial load AND after every swap. Works whether Sparke is on or off.
  function renderResults() {
    var el = document.getElementById("results");
    if (!el) return;
    var entries = [];
    new URLSearchParams(location.search).forEach(function (v, k) { entries.push([k, v]); });
    if (!entries.length) {
      el.innerHTML = "<em>(no query submitted yet - go to Search and submit the form)</em>";
      return;
    }
    el.innerHTML =
      "<ul>" +
      entries
        .map(function (p) {
          return "<li><code>" + escapeHtml(p[0]) + "</code> = <strong>" + escapeHtml(p[1]) + "</strong></li>";
        })
        .join("") +
      "</ul>";
  }

  function wire() {
    var btn = document.getElementById("toggle");
    var mounted = document.getElementById("mounted");
    var nowEl = document.getElementById("now");
    var swapsEl = document.getElementById("swaps");
    var modeEl = document.getElementById("mode");

    if (mounted) mounted.textContent = clock(mountedAt);
    if (modeEl) modeEl.textContent = enabled ? "ON" : "OFF";

    if (btn) {
      btn.textContent = enabled ? "Sparke: ON" : "Sparke: OFF";
      btn.className = "toggle" + (enabled ? " on" : "");
      btn.addEventListener("click", function () {
        localStorage.setItem(DISABLED_KEY, enabled ? "1" : "0");
        location.reload();
      });

      // Inject a "Transitions" toggle next to the Sparke toggle (so we don't
      // have to edit every page's markup). Demo-only.
      var vt = document.createElement("button");
      vt.type = "button";
      vt.textContent = transitions ? "Transitions: ON" : "Transitions: OFF";
      vt.className = "toggle" + (transitions ? " on" : "");
      vt.title = "View Transitions (data-transitions). Needs Sparke ON.";
      vt.addEventListener("click", function () {
        localStorage.setItem(TRANSITIONS_KEY, transitions ? "0" : "1");
        location.reload();
      });
      btn.insertAdjacentElement("afterend", vt);
    }

    // Live clock so you can see the JS context is alive and uninterrupted.
    if (nowEl) {
      setInterval(function () { nowEl.textContent = clock(new Date()); }, 1000);
      nowEl.textContent = clock(new Date());
    }

    // Swap counter (persists across full reloads via sessionStorage).
    function renderSwaps() {
      if (swapsEl) swapsEl.textContent = sessionStorage.getItem("sparke-swaps") || "0";
    }
    renderSwaps();

    // Render the form results on initial load (covers Sparke OFF / full loads).
    renderResults();

    window.addEventListener("sparke:after-swap", function () {
      var n = (parseInt(sessionStorage.getItem("sparke-swaps") || "0", 10) || 0) + 1;
      sessionStorage.setItem("sparke-swaps", String(n));
      renderSwaps();
      // And re-render after every swap (covers Sparke ON navigations).
      renderResults();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
