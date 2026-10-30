// Veyra shared lead board: one function behind /api/* (see vercel.json).
// One shared password, everyone has the same rights. Leads arrive from the
// scouting Mac via /api/sync; people claim them, set a status and add notes.
// Nothing here sends anything to a lead.

import crypto from "node:crypto";

export const STATUSES = ["new", "contacted", "replied", "meeting", "won", "lost", "do_not_contact", "rejected"];
const DAY = 86400;
const LEAD_FIELDS = ["domain", "name", "website", "city", "region", "batch", "fit", "verdict", "what",
                     "emails", "phones", "subject", "draft", "profile_md"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, domain TEXT DEFAULT '', name TEXT DEFAULT '', website TEXT DEFAULT '',
  city TEXT DEFAULT '', region TEXT DEFAULT '', batch INT DEFAULT 0, fit REAL, verdict TEXT DEFAULT '',
  what TEXT DEFAULT '', emails TEXT DEFAULT '', phones TEXT DEFAULT '', subject TEXT DEFAULT '',
  draft TEXT DEFAULT '', profile_md TEXT DEFAULT '', owner TEXT DEFAULT '', status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL, at TIMESTAMPTZ DEFAULT now(),
  who TEXT DEFAULT '', kind TEXT NOT NULL, text TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS events_lead ON events(lead_id);`;

const hmac = (s) => crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(s).digest("hex");
const same = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

function cookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function loggedIn(req) {
  const [exp, sig] = cookie(req, "veyra").split(".");
  return !!(exp && sig && process.env.SESSION_SECRET && Number(exp) > Date.now() / 1000 && same(sig, hmac(exp)));
}

async function body(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res, code, data, headers = {}) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(code, {"Content-Type": "application/json", "Cache-Control": "no-store",
                       "X-Robots-Tag": "noindex, nofollow", ...headers});
  res.end(text);
}

const clip = (s, n) => String(s ?? "").slice(0, n);
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function makeHandler(q) {
  let ready = null;
  const db = async (text, params = []) => {
    ready ??= (async () => {
      for (const stmt of SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await q(stmt);
    })().catch((e) => { ready = null; throw e; });
    await ready;
    return q(text, params);
  };

  return async function handler(req, res) {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/\/+$/, "");
    try {
      if (path === "/api/login" && req.method === "POST") {
        const { password } = await body(req);
        if (!process.env.SITE_PASSWORD || !process.env.SESSION_SECRET) return send(res, 503, {error: "Site password not set up yet."});
        if (!same(password || "", process.env.SITE_PASSWORD)) {
          await new Promise((r) => setTimeout(r, 800));   // ponytail: no lockout; a slow guess is enough for a shared link
          return send(res, 401, {error: "Wrong password."});
        }
        const exp = String(Math.floor(Date.now() / 1000) + 30 * DAY);
        return send(res, 200, {ok: true}, {"Set-Cookie":
          `veyra=${exp}.${hmac(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * DAY}`});
      }
      if (path === "/api/logout") {
        return send(res, 200, {ok: true}, {"Set-Cookie": "veyra=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"});
      }

      if (path === "/api/sync" && req.method === "POST") {
        const key = (req.headers.authorization || "").replace(/^Bearer /, "");
        if (!process.env.SYNC_KEY || !same(key, process.env.SYNC_KEY)) return send(res, 401, {error: "Bad sync key."});
        const { leads = [], remove = [] } = await body(req);
        let added = 0;
        for (const id of remove) {
          await db("DELETE FROM leads WHERE id = $1 AND status = 'new' AND owner = '' AND NOT EXISTS " +
                   "(SELECT 1 FROM events WHERE lead_id = $1 AND kind <> 'added')", [String(id)]);
        }
        for (const l of leads) {
          const vals = LEAD_FIELDS.map((f) => l[f] ?? (f === "batch" ? 0 : f === "fit" ? null : ""));
          const r = await db(
            `INSERT INTO leads (id, ${LEAD_FIELDS.join(", ")}) VALUES ($1, ${LEAD_FIELDS.map((_, i) => `$${i + 2}`).join(", ")})
             ON CONFLICT (id) DO UPDATE SET ${LEAD_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(", ")}
             RETURNING (xmax = 0) AS inserted`, [String(l.id), ...vals]);
          if (r[0]?.inserted) {
            added++;
            await db("INSERT INTO events (lead_id, who, kind, text) VALUES ($1, 'Veyra', 'added', $2)",
                     [String(l.id), `Found in batch ${l.batch ?? ""}`]);
          }
        }
        const decisions = await db("SELECT id, domain, status, owner FROM leads WHERE status <> 'new'");
        return send(res, 200, {added, decisions});
      }

      if (!loggedIn(req)) return send(res, 401, {error: "Log in first."});

      if (path === "/api/leads" && req.method === "GET") {
        return send(res, 200, await db(
          `SELECT id, domain, name, website, city, region, batch, fit, verdict, what, emails, owner, status,
                  created_at, updated_at FROM leads ORDER BY batch DESC, fit DESC NULLS LAST, name`));
      }
      if (path === "/api/lead" && req.method === "GET") {
        const id = url.searchParams.get("id") || "";
        const [lead] = await db("SELECT * FROM leads WHERE id = $1", [id]);
        if (!lead) return send(res, 404, {error: "No such lead."});
        lead.events = await db("SELECT at, who, kind, text FROM events WHERE lead_id = $1 ORDER BY at DESC, id DESC", [id]);
        return send(res, 200, lead);
      }
      if (path === "/api/lead" && req.method === "POST") {
        const b = await body(req);
        const who = clip(b.by, 60).trim();
        if (!who) return send(res, 400, {error: "Tell us your name first."});
        const [lead] = await db("SELECT id, owner, status FROM leads WHERE id = $1", [String(b.id || "")]);
        if (!lead) return send(res, 404, {error: "No such lead."});
        if (b.owner !== undefined && clip(b.owner, 60) !== lead.owner) {
          const owner = clip(b.owner, 60).trim();
          await db("UPDATE leads SET owner = $2, updated_at = now() WHERE id = $1", [lead.id, owner]);
          await db("INSERT INTO events (lead_id, who, kind, text) VALUES ($1, $2, 'owner', $3)",
                   [lead.id, who, owner ? `Claimed by ${owner}` : "Unclaimed"]);
        }
        if (b.status !== undefined && b.status !== lead.status) {
          if (!STATUSES.includes(b.status)) return send(res, 400, {error: "Unknown status."});
          await db("UPDATE leads SET status = $2, updated_at = now() WHERE id = $1", [lead.id, b.status]);
          await db("INSERT INTO events (lead_id, who, kind, text) VALUES ($1, $2, 'status', $3)",
                   [lead.id, who, `Status: ${b.status.replace(/_/g, " ")}`]);
        }
        if (clip(b.note, 4000).trim()) {
          await db("INSERT INTO events (lead_id, who, kind, text) VALUES ($1, $2, 'note', $3)",
                   [lead.id, who, clip(b.note, 4000).trim()]);
        }
        return send(res, 200, {ok: true});
      }
      if (path === "/api/leads.csv") {
        const rows = await db("SELECT * FROM leads ORDER BY batch DESC, fit DESC NULLS LAST");
        const cols = ["name", "website", "city", "region", "fit", "verdict", "owner", "status", "emails", "phones", "subject", "draft", "batch"];
        const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
        return send(res, 200, csv, {"Content-Type": "text/csv; charset=utf-8",
                                    "Content-Disposition": 'attachment; filename="veyra-leads.csv"'});
      }
      return send(res, 404, {error: "Not found."});
    } catch (e) {
      console.error(e);
      return send(res, 500, {error: "Server error."});
    }
  };
}

let live = null;
export default async function handler(req, res) {
  if (!live) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    live = makeHandler((text, params = []) => sql.query(text, params));
  }
  return live(req, res);
}
