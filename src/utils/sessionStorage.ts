const COOKIE_NAME = 'bms-session-id';
const URL_PARAM = 'bms-session-id';
const COOKIE_DAYS = 7;

export function setSessionCookie(sessionId: string): void {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; expires=${expires}; path=/; SameSite=Lax${secure}`;
}

export function getSessionCookie(): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : null;
}

export function removeSessionCookie(): void {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export function getSessionFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get(URL_PARAM);
  return value && value.trim() ? value.trim() : null;
}

export function removeSessionFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(URL_PARAM)) return;
  url.searchParams.delete(URL_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
}

/** Extract from URL → store in cookie → clean URL. Returns the session id from URL, if any. */
export function handleUrlSession(): string | null {
  const sessionId = getSessionFromUrl();
  if (sessionId) {
    setSessionCookie(sessionId);
    removeSessionFromUrl();
  }
  return sessionId;
}
