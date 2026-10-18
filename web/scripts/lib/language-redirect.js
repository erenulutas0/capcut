/*
 * The page in the reader's language, from the first frame (ADR-048). Edit this
 * template, not the pages: scripts/apply-csp.mjs writes it — the part between
 * the two markers, CONFIG filled in, comment lines taken out — into every built
 * app page as the first script of <head>, and its hash into that page's
 * Content-Security-Policy (scripts/lib/languageScript.mjs).
 *
 * Every page exists in both languages, prerendered (`/yap/kes/` and
 * `/en/yap/kes/`; src/i18n/localePath.ts has the table). The language of THIS
 * page is its `<html lang>`. The language the reader wants is, in order:
 * 1. the address's `lang=tr|en` (what the language button opens): remembered
 *    in localStorage (`clip.language`, docs/privacy/DATA_INVENTORY.md) and
 *    taken off the address;
 * 2. what was remembered so;
 * 3. the browser's languages: the first of them that is Turkish or English
 *    decides; a browser that lists neither gets English; a browser that lists
 *    nothing at all stays where it is.
 * When that is not this page's language, the page is hidden (nothing of it is
 * drawn: no word of the wrong language flashes) and replaced by its twin,
 * query and hash kept — the share target's `/?paylasim=…` among them. If the
 * twin does not come within `showAfterMs`, this page shows itself after all.
 *
 * Nothing leaves the device: no request is made but the page itself.
 *
 * Keep it plain, as the page watchdog: `var`, functions, no syntax a browser of
 * 2019 lacks. Comments go on lines of their own (they are removed from the page).
 */
// @clip-language-begin
(function (win, doc, cfg) {
  try {
    var root = doc.documentElement;
    var page = root.getAttribute('lang') === 'en' ? 'en' : 'tr';
    var loc = win.location;
    var search = loc.search;
    var store = null;
    try {
      store = win.localStorage;
    } catch (error) {
      store = null;
    }

    function segment(path, prefix) {
      return path === prefix || path.indexOf(prefix + '/') === 0;
    }

    // The twin of `path` (with the base) in `want`; null outside the site.
    function twin(path, want) {
      var base = cfg.base;
      if (base && path !== base && path.indexOf(base + '/') !== 0) return null;
      var inside = path.slice(base.length) || '/';
      var bare = inside.length > 1 && inside.charAt(inside.length - 1) === '/' ? inside.slice(0, -1) : inside;
      var turkish = bare;
      if (segment(bare, '/gizlilik/en')) turkish = '/gizlilik' + bare.slice('/gizlilik/en'.length);
      else if (segment(bare, '/en')) turkish = bare.slice('/en'.length) || '/';
      var out = turkish;
      if (want === 'en') {
        if (segment(turkish, '/gizlilik')) out = '/gizlilik/en' + turkish.slice('/gizlilik'.length);
        else out = turkish === '/' ? '/en' : '/en' + turkish;
      }
      if (cfg.slash && out.charAt(out.length - 1) !== '/') out += '/';
      return base + out;
    }

    function preferred(nav) {
      var list = nav.languages && nav.languages.length ? nav.languages : nav.language ? [nav.language] : [];
      for (var i = 0; i < list.length; i += 1) {
        var primary = String(list[i]).toLowerCase().split('-')[0];
        if (primary === 'tr' || primary === 'en') return primary;
      }
      return list.length ? 'en' : null;
    }

    var asked = /(?:^\?|&)lang=(tr|en)(?=&|$)/.exec(search);
    var want = null;
    if (asked) {
      want = asked[1];
      try {
        if (store) store.setItem(cfg.key, want);
      } catch (error) {
        // Not remembered (private window, storage off): this page still opens in the asked language.
      }
      search = search.replace(/([?&])lang=(?:tr|en)(&|$)/, function (all, before, after) {
        return after ? before : '';
      });
      if (search === '?') search = '';
      try {
        win.history.replaceState(win.history.state, '', loc.pathname + search + loc.hash);
      } catch (error) {
        // The address keeps the word; nothing else changes.
      }
    }
    if (!want) {
      var saved = null;
      try {
        saved = store ? store.getItem(cfg.key) : null;
      } catch (error) {
        saved = null;
      }
      if (saved === 'tr' || saved === 'en') want = saved;
    }
    if (!want) want = preferred(win.navigator || {});
    if (!want || want === page) return;
    var target = twin(loc.pathname, want);
    if (!target) return;
    root.setAttribute('hidden', '');
    win.setTimeout(function () {
      root.removeAttribute('hidden');
    }, cfg.showAfterMs);
    loc.replace(target + search + loc.hash);
  } catch (error) {
    // Whatever went wrong, the page as it was built is shown.
  }
})(window, document, /* @clip-language-config */ {} /* @end */);
// @clip-language-end
