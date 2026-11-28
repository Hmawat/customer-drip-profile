(() => {
  'use strict';

  const canHide = /^https?:$/.test(location.protocol) && window.top === window;
  const root = location.origin + '/';
  const pathOf = url => url.pathname + url.search + url.hash;
  const readEntry = () => {
    const value = history.state?.dripRoute;
    return new URL(canHide && location.href === root && typeof value === 'string' &&
      /^\/(?![\\/])/.test(value) ? value : location.href, location.href);
  };
  let route = readEntry();

  function writeEntry(method) {
    if (!canHide) return;
    try {
      history[method]({...history.state, dripRoute: pathOf(route)}, '', root);
    } catch {}
  }

  window.DripRoute = {
    get pathname() { return route.pathname; },
    get search() { return route.search; },
    get hash() { return route.hash; },
    get href() { return route.href; },
    set hash(value) {
      if (!canHide) {
        location.hash = value;
        route = new URL(location.href);
        return;
      }
      const before = route.hash;
      route.hash = value;
      if (route.hash === before) return;
      writeEntry('pushState');
      window.dispatchEvent(new Event('hashchange'));
    },
    replace(path) {
      const next = new URL(path, route.href);
      if (next.origin !== route.origin) return;
      route = next;
      if (canHide) writeEntry('replaceState');
      else history.replaceState(null, '', route.href);
    },
  };

  window.addEventListener('popstate', () => {
    if (!canHide || location.href !== root || !history.state?.dripRoute) return;
    const before = route.hash;
    route = readEntry();
    if (route.hash !== before) window.dispatchEvent(new Event('hashchange'));
  });

  window.addEventListener('hashchange', () => {
    if (location.href === root) return;
    route.hash = location.hash;
    writeEntry('replaceState');
  });

  writeEntry('replaceState');
})();
