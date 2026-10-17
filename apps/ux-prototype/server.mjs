import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const files = {
  "/brand-mark.svg": ["brand-mark.svg", "image/svg+xml"],
  "/wordmark.svg": ["wordmark.svg", "image/svg+xml"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};
const server = createServer(async (req, res) => {
  let file = files[new URL(req.url, "http://127.0.0.1").pathname];
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    let body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(12781, "127.0.0.1", () =>
  console.log("127Vaults UX prototype: http://127.0.0.1:12781"),
);
