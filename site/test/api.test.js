// The site API against an in-memory Postgres (PGlite). Fixture data only.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { makeHandler } from "../api/index.js";

process.env.SITE_PASSWORD = "test-password";
process.env.SESSION_SECRET = "test-secret";
process.env.SYNC_KEY = "test-sync-key";

const LEAD = { id: "c1", domain: "alpha-supply.example.com", name: "Alpha Supply", city: "Testville, IL",
               region: "US", batch: 2, fit: 7, verdict: "keep", what: "sells parts", emails: "info@alpha-supply.example.com",
               subject: "Quotes", draft: "Hello", profile_md: "# Alpha\n## Facts\n- one" };

async function server() {
  const pg = new PGlite();
  const srv = http.createServer(makeHandler(async (t, p = []) => (await pg.query(t, p)).rows));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = "";
  const call = async (path, opts = {}) => {
    const r = await fetch(base + path, { ...opts, headers: { "Content-Type": "application/json", cookie, ...(opts.headers || {}) } });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
  };
  return { call, close: () => srv.close() };
}

const post = (body, headers) => ({ method: "POST", body: JSON.stringify(body), headers });

test("password, sync, claim, status, notes and download", async () => {
  const { call, close } = await server();
  try {
    assert.equal((await call("/api/leads")).status, 401);                       // locked
    assert.equal((await call("/api/sync", post({ leads: [LEAD] }))).status, 401);  // sync needs its key
    assert.equal((await call("/api/login", post({ password: "nope" }))).status, 401);

    const sync = post({ leads: [LEAD] }, { authorization: "Bearer test-sync-key" });
    assert.equal((await call("/api/sync", sync)).body.added, 1);
    assert.equal((await call("/api/sync", sync)).body.added, 0);              // re-sync doesn't duplicate

    assert.equal((await call("/api/login", post({ password: "test-password" }))).status, 200);
    const list = (await call("/api/leads")).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].status, "new");
    assert.equal(list[0].profile_md, undefined);                              // list stays light

    assert.equal((await call("/api/lead", post({ id: "c1", owner: "Ana" }))).status, 400);  // needs a name
    await call("/api/lead", post({ id: "c1", by: "Ana", owner: "Ana" }));
    await call("/api/lead", post({ id: "c1", by: "Ana", status: "contacted", note: "sent from Max's mailbox" }));
    assert.equal((await call("/api/lead", post({ id: "c1", by: "Ana", status: "emailed" }))).status, 400);

    const lead = (await call("/api/lead?id=c1")).body;
    assert.equal(lead.owner, "Ana");
    assert.equal(lead.status, "contacted");
    assert.deepEqual(lead.events.map((e) => e.kind).sort(), ["added", "note", "owner", "status"]);

    // a re-sync refreshes content but never resets what people decided
    const again = await call("/api/sync", post({ leads: [{ ...LEAD, fit: 8 }] }, { authorization: "Bearer test-sync-key" }));
    assert.deepEqual(again.body.decisions.map((d) => [d.id, d.status, d.owner]), [["c1", "contacted", "Ana"]]);
    assert.equal((await call("/api/lead?id=c1")).body.status, "contacted");

    const csv = (await call("/api/leads.csv")).body;
    assert.match(csv, /Alpha Supply/);
    assert.match(csv, /contacted/);

    await call("/api/logout", { method: "POST" });
    assert.equal((await call("/api/leads")).status, 401);
  } finally {
    close();
  }
});
