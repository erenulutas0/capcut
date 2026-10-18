/*
 * A page that was served but never came alive says so, and tries once to
 * recover (ADR-044). Edit this template, not the pages: scripts/apply-csp.mjs
 * writes it — the part between the two markers, CONFIG filled in, comment
 * lines taken out — into every built page as the first script of <head>,
 * and its hash into that page's Content-Security-Policy
 * (scripts/lib/pageWatchdogScript.mjs).
 *
 * Why it exists. The app's pages are prerendered HTML: the words and the
 * buttons are on the screen before any of the app's code has run. When one
 * build file does not arrive (a dropped connection, a broken stored copy) the
 * browser still fires `load`, nothing on the screen changes, and "Video seç"
 * stays disabled for ever (docs/quality/2026-10-13-hydration-faults.md). No
 * framework is alive to notice — so this runs without one, before everything
 * else in the page, and the notice it shows is plain prerendered HTML
 * (src/components/PageWatchdog.tsx).
 *
 * Why first in <head>, and not rendered by the layout: an inline script
 * waits for the stylesheets before it; a build file that fails while they
 * load would fire its `error` event before the script could listen. Here
 * nothing is before it but the charset and the policy.
 *
 * What counts as alive: `<html data-clip-alive>` (set by an effect of the
 * root layout, src/components/PageAlive.tsx — so React has taken the page
 * over) and no element left that says it still waits for its code
 * (`data-clip-pending`: a wizard's first screen until it is hydrated).
 *
 * What it does:
 * - A build script of the page fails to load (an `error` event, seen in the
 *   capture phase) and the page is not alive `errorS` seconds later — the
 *   bundler tries such a file once more by itself — or `load` has fired and
 *   the page is not alive `graceS` seconds later: reload, once.
 * - A stylesheet of the page fails (nothing retries those): reload, once, at
 *   once.
 * - Not alive after that one reload: show the notice with a real "Yeniden
 *   yükle" button. No second automatic reload, whatever happens.
 * - `load` itself has not come after `stuckS` seconds (a request that stands
 *   still): show the notice, do not reload — on a slow connection a reload
 *   would throw away what has already arrived.
 * - The page IS alive and a part of it fails later with nobody telling the
 *   user (an unhandled `ChunkLoadError`, a stylesheet): show the notice,
 *   never reload — an open video or a choice would be lost.
 *
 * Seconds are counted in one-second ticks that actually ran, so a tab that
 * was frozen or asleep is not judged by the time it spent asleep.
 *
 * The one reload is remembered for this tab in sessionStorage
 * (`clip:page-recovery`, docs/privacy/DATA_INVENTORY.md §2.4a): the page that
 * comes back knows it is the second try. Where sessionStorage cannot be used
 * there is no automatic reload at all, only the notice.
 *
 * Keep it plain: `var`, functions, no syntax a browser of 2019 lacks — a
 * script that fails to parse protects nobody. Comments go on lines of their
 * own (they are removed from the page).
 */
// @clip-watchdog-begin
(function (win, doc, cfg) {
  var root = doc.documentElement;
  var retry = false;
  var leaving = false;
  var shown = '';
  var bound = false;
  var notice = null;
  var ticks = 0;
  var loadedAt = -1;
  var errorAt = -1;
  var styleFailed = false;
  var beat = 0;

  // The flag; null when there is none; undefined when sessionStorage cannot be used.
  function read() {
    try {
      var raw = win.sessionStorage.getItem(cfg.key);
      if (!raw) return null;
      var value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      return undefined;
    }
  }

  function write(state, why, at) {
    try {
      win.sessionStorage.setItem(cfg.key, JSON.stringify({ s: state, t: at, p: win.location.pathname, why: why }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function alive() {
    return root.hasAttribute(cfg.aliveAttr) && !doc.querySelector('[' + cfg.pendingAttr + ']');
  }

  function find() {
    if (!notice) notice = doc.getElementById(cfg.noticeId);
    return notice;
  }

  function hide() {
    var box = find();
    shown = '';
    if (!box) return;
    box.setAttribute('data-state', 'hidden');
    var panels = box.querySelectorAll('[data-clip-lang]');
    for (var i = 0; i < panels.length; i += 1) panels[i].hidden = true;
  }

  function reload(why) {
    leaving = true;
    write('reloading', why, Date.now());
    win.location.reload();
  }

  // Takes the stored app shell away (this app's worker and its "clip-app-" caches: not the user's
  // videos or projects, not the speech model, not another app on the same origin), then reloads.
  function reset() {
    var jobs = [];
    try {
      var workers = win.navigator.serviceWorker;
      if (workers) {
        jobs.push(
          workers.getRegistrations().then(function (list) {
            return Promise.all(
              list
                .filter(function (item) {
                  return new URL(item.scope).pathname === cfg.scope;
                })
                .map(function (item) {
                  return item.unregister();
                })
            );
          })
        );
      }
      if (win.caches) {
        jobs.push(
          win.caches.keys().then(function (names) {
            return Promise.all(
              names
                .filter(function (name) {
                  return name.indexOf(cfg.cachePrefix) === 0;
                })
                .map(function (name) {
                  return win.caches.delete(name);
                })
            );
          })
        );
      }
    } catch (error) {
      jobs = [];
    }
    var done = false;
    var go = function () {
      if (done) return;
      done = true;
      reload('reset');
    };
    win.setTimeout(go, 4000);
    Promise.all(jobs).then(go, go);
  }

  function onClick(event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('[data-clip-do]') : null;
    var action = button ? button.getAttribute('data-clip-do') : '';
    if (action === 'reload') reload('button');
    else if (action === 'reset') reset();
    else if (action === 'close') hide();
  }

  // 'dead': the page did not come alive. 'late': it is alive, a part of it could not be loaded.
  function show(kind) {
    var box = find();
    if (!box || shown === 'dead' || shown === kind) return;
    // A page that crashed while starting may have had its body replaced.
    if (!box.isConnected && doc.body) doc.body.appendChild(box);
    shown = kind;
    // The page's own language (ADR-048: `<html lang="en">` on every English page).
    var english = root.getAttribute('lang') === 'en';
    var controlled = false;
    try {
      controlled = Boolean(win.navigator.serviceWorker && win.navigator.serviceWorker.controller) && win.navigator.onLine !== false;
    } catch (error) {
      controlled = false;
    }
    var panels = box.querySelectorAll('[data-clip-lang]');
    for (var i = 0; i < panels.length; i += 1) {
      panels[i].hidden = (panels[i].getAttribute('data-clip-lang') === 'en') !== english;
    }
    // "reset" (take the stored copy away) is offered only where a stored copy may be what is broken,
    // and not offline, where it is all there is.
    var parts = box.querySelectorAll('[data-clip-when]');
    for (var j = 0; j < parts.length; j += 1) {
      var when = parts[j].getAttribute('data-clip-when');
      parts[j].hidden = !(when === kind || (when === 'reset' && kind === 'dead' && controlled));
    }
    box.setAttribute('data-state', kind);
    if (!bound) {
      bound = true;
      box.addEventListener('click', onClick);
    }
  }

  // One automatic reload: never on the second try, never twice within quietMs, never where the tab
  // cannot remember it.
  function mayReload() {
    if (retry) return false;
    var flag = read();
    if (flag === undefined) return false;
    var now = Date.now();
    return !(flag && typeof flag.t === 'number' && now >= flag.t && now - flag.t < cfg.quietMs);
  }

  // The page is not alive and will not become so by itself.
  function dead(why) {
    if (leaving || shown || alive()) return;
    if (mayReload() && write('reloading', why, Date.now())) {
      leaving = true;
      win.location.reload();
      return;
    }
    show('dead');
  }

  // A stylesheet of the page itself did not load: nothing retries it, and alive or not the page is
  // not what it should be.
  function styleBroke() {
    if (styleFailed) return;
    styleFailed = true;
    if (alive()) show('late');
    else if (mayReload()) dead('style');
    else if (errorAt < 0) errorAt = ticks;
  }

  function own(address) {
    try {
      var url = new URL(address, win.location.href);
      return url.origin === win.location.origin && url.pathname.indexOf(cfg.staticPrefix) === 0;
    } catch (error) {
      return false;
    }
  }

  var first = read();
  if (first && first.s === 'reloading') {
    retry = true;
    write('retried', typeof first.why === 'string' ? first.why : '', typeof first.t === 'number' ? first.t : Date.now());
  }

  win.addEventListener(
    'error',
    function (event) {
      var element = event.target;
      if (!element || !element.tagName) {
        // Not a file: an error nobody caught. Only a part of the app that could not be loaded is
        // this script's to report.
        var thrown = event.error;
        if (thrown && thrown.name === 'ChunkLoadError') {
          if (alive()) show('late');
          else if (errorAt < 0) errorAt = ticks;
        }
        return;
      }
      var style = element.tagName === 'LINK' && /stylesheet/i.test(element.rel || '');
      var address = element.tagName === 'SCRIPT' ? element.src : style ? element.href : '';
      if (!address || !own(address)) return;
      if (style && element.hasAttribute('data-precedence')) {
        styleBroke();
        return;
      }
      // A script (or a stylesheet asked for later): the bundler tries once more by itself, and an
      // alive app speaks for itself.
      if (!alive() && errorAt < 0) errorAt = ticks;
    },
    true
  );

  win.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (!reason || reason.name !== 'ChunkLoadError') return;
    if (alive()) show('late');
    else if (errorAt < 0) errorAt = ticks;
  });

  function loaded() {
    loadedAt = ticks;
    // By now every stylesheet of the document has loaded or failed; one without a sheet failed
    // (its error event may have been missed, or the browser fired none).
    var links = doc.querySelectorAll('link[rel="stylesheet"][data-precedence]');
    for (var i = 0; i < links.length; i += 1) {
      if (!links[i].sheet && own(links[i].href)) styleBroke();
    }
  }
  if (doc.readyState === 'complete') loaded();
  else win.addEventListener('load', loaded);
  doc.addEventListener('DOMContentLoaded', find);

  beat = win.setInterval(function () {
    ticks += 1;
    if (leaving) return;
    if (alive()) {
      if (shown === 'dead') hide();
      // Alive without its stylesheet (the one reload did not bring it): said, with a way to close it.
      if (styleFailed) show('late');
      win.clearInterval(beat);
      return;
    }
    if (shown) return;
    if (errorAt >= 0 && ticks - errorAt >= cfg.errorS) dead(styleFailed ? 'style' : 'file');
    else if (loadedAt >= 0 && ticks - loadedAt >= cfg.graceS) dead('timeout');
    else if (loadedAt < 0 && ticks >= cfg.stuckS) show('dead');
  }, 1000);
})(window, document, /* @clip-watchdog-config */ {} /* @end */);
// @clip-watchdog-end
