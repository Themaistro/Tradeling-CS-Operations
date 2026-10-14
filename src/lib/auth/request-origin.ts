export function sameRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    // Next's internal request URL can use localhost behind a reverse proxy.
    // Host is supplied by the browser and preserved by the hosting proxy.
    const host = request.headers.get("host") || new URL(request.url).host;
    return source.host === new URL(`${source.protocol}//${host}`).host;
  } catch { return false; }
}
