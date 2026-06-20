const URL_KEY = 'room-remote:haUrl';
const TOKEN_KEY = 'room-remote:haToken';

export function normaliseHassUrl(input: string): string {
  return input
    .trim()
    .replace(/\/api\/websocket\/?$/, '')
    .replace(/\/$/, '');
}

export function loadCredentials(): { url: string; token: string } | null {
  const url = localStorage.getItem(URL_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  if (!url || !token) return null;
  return { url, token };
}

export function saveCredentials(url: string, token: string): void {
  localStorage.setItem(URL_KEY, normaliseHassUrl(url));
  localStorage.setItem(TOKEN_KEY, token);
}

export function credentialsValid(url: string, token: string): boolean {
  return url.trim().length > 0 && token.trim().length > 0;
}

export function clearCredentials(): void {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
