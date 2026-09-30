import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { localApi } from "./vite.config.js";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export function createAppServer({ env = process.env, distDir = resolve("dist"), fetchImpl = fetch } = {}) {
  const routes = [];
  localApi(env, { fetchImpl }).configureServer({
    middlewares: { use: (path, handler) => routes.push({ path, handler }) },
  });

  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }

    const route = routes.find(({ path }) => pathname === path);
    if (route) {
      req.url = req.url.slice(route.path.length) || "/";
      route.handler(req, res);
      return;
    }
    if (pathname.startsWith("/api/")) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }

    const root = resolve(distDir);
    const file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      res.writeHead(403).end();
      return;
    }

    let target = file;
    try {
      if (!(await stat(target)).isFile()) target = resolve(root, "index.html");
    } catch {
      if (extname(pathname)) {
        res.writeHead(404).end();
        return;
      }
      target = resolve(root, "index.html");
    }

    try {
      const info = await stat(target);
      res.setHeader("Content-Type", contentTypes[extname(target)] || "application/octet-stream");
      res.setHeader("Content-Length", info.size);
      res.setHeader("Cache-Control", target.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
      res.writeHead(200);
      if (req.method === "HEAD") res.end();
      else createReadStream(target).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const credentials = process.env.CREDENTIALS_FILE
    ? JSON.parse(readFileSync(process.env.CREDENTIALS_FILE, "utf8"))
    : {};
  createAppServer({ env: { ...process.env, ...credentials } })
    .listen(Number(process.env.PORT || 8080), "0.0.0.0");
}