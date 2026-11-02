import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8099);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(res, status, filePath) {
  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(status, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buffer);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/") return send(res, 200, path.join(__dirname, "index.html"));
    if (pathname === "/mock-fetch.js") return send(res, 200, path.join(__dirname, "mock-fetch.js"));
    if (pathname === "/test-janny-card.png") {
      return send(res, 200, path.join(__dirname, "test-janny-card.png"));
    }
    if (pathname === "/script.js") return send(res, 200, path.join(__dirname, "script.js"));
    if (pathname === "/scripts/extensions.js") {
      return send(res, 200, path.join(__dirname, "scripts", "extensions.js"));
    }
    if (pathname.startsWith("/characters/")) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      return res.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
    }

    const prefix = "/scripts/extensions/third-party/datacat-sillytavern/";
    if (pathname.startsWith(prefix)) {
      const relative = pathname.slice(prefix.length);
      const target = path.resolve(root, relative);
      if (!target.startsWith(root)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      return send(res, 200, target);
    }

    send(res, 404, path.join(__dirname, "index.html"));
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Mock SillyTavern: http://localhost:${port}`);
  });
