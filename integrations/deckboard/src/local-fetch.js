import http from "node:http";

// Node HTTP works with Deckboard's Node 16+ runtime and never follows redirects.
export function localFetch(url, options) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method, headers: options.headers, signal: options.signal }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode });
    });
    request.on("error", () => reject(new Error("MusicDesktop request failed")));
    request.end(options.body);
  });
}
