import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

/** Minimal hash router: "#/path?key=value". Hash routing keeps the app servable as static files. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function routeHref(path: string, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) qs.set(k, v);
  const q = qs.toString();
  return `#${path}${q ? `?${q}` : ''}`;
}

export function navigate(path: string, params?: Record<string, string | undefined>) {
  window.location.hash = routeHref(path, params);
}
