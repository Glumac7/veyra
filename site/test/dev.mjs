// Local preview with fake leads: node test/dev.mjs, then http://127.0.0.1:5600 (password: dev)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { makeHandler } from "../api/index.js";

Object.assign(process.env, { SITE_PASSWORD: "dev", SESSION_SECRET: "dev", SYNC_KEY: "dev" });
const pg = new PGlite();
const api = makeHandler(async (t, p = []) => (await pg.query(t, p)).rows);
const pub = path.join(import.meta.dirname, "..", "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".txt": "text/plain" };

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return api(req, res);
  const file = path.join(pub, req.url === "/" ? "index.html" : path.normalize(req.url));
  if (!file.startsWith(pub) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(5600, async () => {
  const leads = ["Alpha Supply", "Beta Heating", "Gamma Parts", "Delta Electric"].map((name, i) => ({
    id: `c${i}`, name, domain: `${name.split(" ")[0].toLowerCase()}.example.com`, city: "Testville, IL",
    region: i === 3 ? "EU" : "US", batch: 2, fit: 6 + i, verdict: "keep", what: `${name} sells parts and service`,
    emails: `info@${name.split(" ")[0].toLowerCase()}.example.com`, subject: "Question about orders",
    draft: "Hello,\n\nA short fake draft.\n\nBest", profile_md: "# x\n## Verified facts\n- A fact — [https://example.com](https://example.com)\n## Hypotheses\n- **Unverified:** something" }));
  await fetch("http://127.0.0.1:5600/api/sync", { method: "POST", headers: { authorization: "Bearer dev", "content-type": "application/json" }, body: JSON.stringify({ leads }) });
  console.log("preview on http://127.0.0.1:5600 (password: dev)");
});
