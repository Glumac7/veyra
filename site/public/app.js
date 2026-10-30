// Veyra shared lead board (plain JS, no build step). Nothing here sends anything:
// people copy the draft and send it by hand, then record what they did.
const STATUSES = ["new", "contacted", "replied", "meeting", "won", "lost", "do_not_contact", "rejected"];
const LABELS = {new: "New", contacted: "Contacted", replied: "Replied", meeting: "Meeting booked", won: "Won",
                lost: "Lost", do_not_contact: "Do not contact", rejected: "Not a fit"};
const CLOSED = ["won", "lost", "do_not_contact", "rejected"];
const PLACEHOLDER = /\[[^\]\n]{2,40}\]/g;
// Drafts must not say how many we are or that we are small (same check as harvey/pilot.py HEADCOUNT).
const HEADCOUNT = /\b(zwei|drei|two|three)\b[^.\n]{0,40}(engineer|ingenieur|entwickler|developer|leute|people)|\b(einer|eine) davon\b|\bone of us\b|\bkleine[nmrs]? (österreichische[nmrs]? )?(gmbh|team|firma)|\bsmall (austrian )?(gmbh|team|company|firm)|\bwenige[n]? kunden|\bfew clients|\blimited capacity/i;

let leads = [], openId = null, current = null, myName = "", listScroll = 0;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = (id) => document.getElementById(id);
const me = () => { try { myName ||= localStorage.getItem("veyra-name") || ""; } catch {} return myName; };
const show = (id) => ["login", "ask-name", "app"].forEach((x) => ($(x).hidden = x !== id));
const hashId = () => decodeURIComponent((location.hash.match(/^#lead=(.+)$/) || [])[1] || "");
const ready = (l) => l.status === "new" && !l.owner;
const group = (l) => CLOSED.includes(l.status) ? "closed" : l.owner === me() ? "mine" : !l.owner ? "ready" : "others";
const GROUPS = [["mine", "Yours"], ["ready", "Ready to take"], ["others", "Taken by others"], ["closed", "Closed"]];

let toastTimer;
function say(text) { $("status").textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($("status").textContent = ""), 2500); }
function fail(text) { $("err").textContent = text; $("err").hidden = !text; }

async function api(path, opts = {}) {
  const r = await fetch(path, {credentials: "same-origin", ...opts,
    headers: opts.body ? {"Content-Type": "application/json"} : {}}).catch(() => null);
  if (!r) { fail("Can't reach the board. Check your connection and try again."); return null; }
  if (r.status === 401 && path !== "/api/login") { show("login"); return null; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { fail(data.error || "Something went wrong. Try again."); return null; }
  fail("");
  return data;
}

async function login(e) {
  e.preventDefault();
  const r = await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({password: $("pw").value})});
  if (!r.ok) { $("login-err").textContent = (await r.json().catch(() => ({}))).error || "Wrong password."; $("pw").select(); return; }
  $("pw").value = ""; $("login-err").textContent = ""; start();
}
async function logout() { await fetch("/api/logout", {method: "POST"}); show("login"); $("pw").focus(); }
function saveName(e) {
  e.preventDefault();
  myName = $("name-input").value.trim();
  try { localStorage.setItem("veyra-name", myName); } catch {}
  start();
}
function changeName() { $("name-input").value = me(); show("ask-name"); $("name-input").focus(); }

async function start() {
  const data = await api("/api/leads");
  if (!data) return;
  if (!me()) { show("ask-name"); $("name-input").focus(); return; }
  leads = data; $("me").textContent = me(); show("app");
  render();
  route(false);
}

// Re-rendering replaces elements; put keyboard focus back on the element with the same id.
function keepFocus(fn) {
  const id = document.activeElement?.id;
  fn();
  if (id && $(id) && document.activeElement !== $(id)) $(id).focus();
}

function rowHtml(l) {
  const who = l.owner ? (l.owner === me() ? "you" : esc(l.owner)) : "nobody yet";
  return `<li><a id="row-${esc(l.id)}" class="row" href="#lead=${encodeURIComponent(l.id)}"${l.id === openId ? ' aria-current="true"' : ""}>
    <span class="name">${esc(l.name)}</span>
    ${l.status === "new" ? "" : `<span class="state s-${l.status}">${LABELS[l.status] || esc(l.status)}</span>`}
    <span class="meta">${esc(l.city)} · fit ${l.fit ?? "—"} · ${who}</span></a></li>`;
}

function render() {
  const q = $("search").value.trim().toLowerCase(), s = $("f-status").value, g = $("f-region").value;
  const shown = leads.filter((l) =>
    (!q || [l.name, l.city, l.what, l.domain, l.owner].join(" ").toLowerCase().includes(q)) &&
    (s === "all" || (s === "open" ? !CLOSED.includes(l.status) : l.status === s)) && (!g || l.region === g));
  const filtered = q || s !== "open" || g;
  $("summary").textContent = `${leads.filter(ready).length} ready to take` + (filtered ? ` · ${shown.length} of ${leads.length} shown` : "");
  keepFocus(() => {
    $("rows").innerHTML = GROUPS.map(([key, title]) => {
      const rows = shown.filter((l) => group(l) === key);
      return rows.length ? `<section class="group g-${key}" aria-labelledby="g-${key}"><h2 id="g-${key}">${title} <span>${rows.length}</span></h2>
        <ul>${rows.map(rowHtml).join("")}</ul></section>` : "";
    }).join("") || `<p class="none">No leads match. <button type="button" class="link" onclick="clearFilters()">Show all leads</button></p>`;
  });
}
function clearFilters() { $("search").value = ""; $("f-status").value = "all"; $("f-region").value = ""; render(); $("search").focus(); }

// Small Markdown → HTML for profiles (headings, lists, bold, links, code). Escaped first.
function md(text) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  let out = "", list = false, code = null;
  for (const line of String(text || "").split("\n")) {
    if (code !== null) {
      if (line.startsWith("```")) { out += `<pre>${esc(code)}</pre>`; code = null; } else code += (code ? "\n" : "") + line;
      continue;
    }
    if (line.startsWith("```")) { code = ""; continue; }
    const li = line.match(/^- (.*)/);
    if (!li && list) { out += "</ul>"; list = false; }
    if (li) { if (!list) { out += "<ul>"; list = true; } out += `<li>${inline(li[1])}</li>`; }
    else if (line.startsWith("# ")) continue;
    else if (line.startsWith("## ")) out += `<h3>${inline(line.slice(3))}</h3>`;
    else if (line.startsWith("> ")) out += `<p class="hint">${inline(line.slice(2))}</p>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

const EMPTY = `<div class="empty"><h2>Pick a lead</h2>
  <ol class="how"><li>Take one from <b>Ready to take</b>.</li><li>Copy the email into your own mailbox and send it.</li><li>Come back and mark it as sent.</li></ol></div>`;

// The hash says which lead is open (#lead=<id>), so back, reload and shared links all work.
function route(byUser) {
  const id = hashId();
  if (id && byUser && !openId) listScroll = window.scrollY;
  $("app").classList.toggle("reading", !!id);
  if (!id) {
    const was = openId; openId = null; current = null; render();
    $("detail").innerHTML = EMPTY;
    if (byUser) { window.scrollTo(0, listScroll); $("row-" + was)?.focus(); }
    return;
  }
  openLead(id, byUser);
}
addEventListener("hashchange", () => route(true));
addEventListener("keydown", (e) => { const m = document.querySelector(".menu[open]"); if (e.key === "Escape" && m) { m.open = false; m.querySelector("summary").focus(); } });
addEventListener("click", (e) => { const m = document.querySelector(".menu[open]"); if (m && (!m.contains(e.target) || e.target.closest(".menu-list"))) m.open = false; });

async function openLead(id, focus) {
  openId = id; render();
  const l = await api("/api/lead?id=" + encodeURIComponent(id));
  if (!l || openId !== id) return;
  current = l;
  const note = document.querySelector("#note-text")?.value || "";
  const inside = $("detail").contains(document.activeElement);
  keepFocus(() => ($("detail").innerHTML = detailHtml(l)));
  if (inside && !$("detail").contains(document.activeElement)) $("lead-title").focus();   // its button went away
  if (note) $("note-text").value = note;
  if (focus) { window.scrollTo(0, 0); $("lead-title").focus(); }
}

// Claim → send it by hand and mark it → record what came back. One button for the step you're on.
function stepsHtml(l) {
  const mine = l.owner === me(), sent = l.status !== "new";
  const steps = [
    ["Claim it", !!l.owner, l.owner ? (mine ? "It's yours." : `${esc(l.owner)} has it.`) : "Nobody has it yet."],
    ["Send the email from your own mailbox, then mark it as sent", sent, ""],
    ["Record what comes back", CLOSED.includes(l.status) || ["replied", "meeting"].includes(l.status), ""],
  ];
  const at = steps.findIndex(([, done]) => !done);
  let act = "";
  if (!l.owner) act = `<button id="claim" class="primary" onclick="update({owner: me()}, 'Claimed. It\\'s yours.')">Claim this lead</button>`;
  else if (!mine) act = `<button id="take-over" class="secondary" onclick="takeOver()">Take over from ${esc(l.owner)}</button>`;
  else if (!sent) act = `<button id="mark-sent" class="primary" onclick="update({status: 'contacted'}, 'Marked as sent.')">I sent it</button>`;
  return `<ol class="steps">${steps.map(([text, done, sub], i) =>
      `<li class="${done ? "done" : i === at ? "now" : ""}"${i === at ? ' aria-current="step"' : ""}>
        <span class="tick" aria-hidden="true"></span><span>${text}${done ? '<span class="sr"> (done)</span>' : ""}${sub ? `<small>${sub}</small>` : ""}</span></li>`).join("")}</ol>
    <div class="controls">
    ${act}
    <div class="field">
      <label for="status-select">Status</label>
      <select id="status-select" onchange="update({status: this.value}, 'Status: ' + this.options[this.selectedIndex].text + '.')">
        ${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${LABELS[s]}</option>`).join("")}
      </select>
    </div>
    ${mine ? `<button id="unclaim" type="button" class="link quiet" onclick="update({owner: ''}, 'Unclaimed.')">Give it back</button>` : ""}
    </div>`;
}

function detailHtml(l) {
  const site = /^https?:\/\//i.test(l.website) ? l.website : "https://" + l.domain;
  const emails = String(l.emails || "").split(/[,;\s]+/).filter(Boolean);
  const phones = String(l.phones || "").split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  const holes = [...new Set(String(l.draft || "").match(PLACEHOLDER) || [])];
  const checks = [];
  if (holes.length) checks.push(`fill in ${holes.map((h) => `<mark>${esc(h)}</mark>`).join(" and ")}`);
  if (HEADCOUNT.test(`${l.subject}\n${l.draft}`)) checks.push("rewrite the sentence that says how many we are. Say what we do instead");
  const copyBtn = (id, text, label, done) =>
    `<button id="${id}" type="button" class="copy" data-copy="${esc(text)}" onclick="copy(this.dataset.copy, '${done}')">Copy<span class="sr"> ${label}</span></button>`;

  return `
    <a class="back" href="#">All leads</a>
    <header class="lead-head">
      <h2 id="lead-title" tabindex="-1">${esc(l.name)}</h2>
      <p class="what">${esc(l.what || "")}</p>
      <p class="facts">${esc(l.city)}${l.region ? ", " + esc(l.region) : ""}
        · <a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(l.domain)}<span class="sr"> (opens in a new tab)</span></a>
        ${phones.map((p) => `· <a href="tel:${esc(p.replace(/[^\d+]/g, ""))}">${esc(p)}</a>`).join(" ")}
        · fit ${l.fit ?? "—"}/10, reviewer says ${esc(l.verdict || "—")}</p>
    </header>
    <div class="lead">
      <aside class="side" aria-label="What to do next">
        <h3>Next step</h3>
        ${stepsHtml(l)}
      </aside>

      <section class="email" aria-labelledby="h-email">
        <h3 id="h-email">The email</h3>
        ${checks.length && l.status === "new" ? `<p class="before"><b>Before you send:</b> ${checks.join("; ")}.</p>` : ""}
        <div class="letter">
          <div class="line"><span class="k">To</span>${emails.length
            ? `<span class="v">${emails.map(esc).join(", ")}</span>${copyBtn("copy-to", emails[0], "address", "Address copied.")}`
            : `<span class="v none">No address on their site. Call instead.</span>`}</div>
          <div class="line"><span class="k">Subject</span><span class="v">${esc(l.subject)}</span>${copyBtn("copy-subject", l.subject, "subject", "Subject copied.")}</div>
          <pre class="body">${esc(l.draft).replace(PLACEHOLDER, (m) => `<mark>${m}</mark>`)}</pre>
          <div class="foot">
            <button id="copy-body" type="button" class="secondary" onclick="copy(current.draft, 'Email text copied.')">Copy email text</button>
            <span>REVIEW DRAFT — NOT APPROVED FOR SENDING. Edit it in your mail app before it goes out.</span>
          </div>
        </div>
        <details class="research"><summary>Why this lead: facts, guesses and open questions</summary>${md(l.profile_md)}</details>
      </section>

      <section class="notes" aria-labelledby="h-notes">
        <h3 id="h-notes">Notes</h3>
        <form class="note" onsubmit="event.preventDefault(); update({note: this.n.value}, 'Note added.').then((ok) => ok && ($('note-text').value = ''))">
          <label class="sr" for="note-text">Add a note</label>
          <textarea id="note-text" name="n" rows="2" placeholder="Sent from my mailbox, called, call back Tuesday…" required></textarea>
          <button id="add-note" type="submit" class="secondary">Add note</button>
        </form>
        <ul class="events">${l.events.map((e) => `<li><span class="when">${new Date(e.at).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})} · ${esc(e.who)}</span>${esc(e.text)}</li>`).join("")}</ul>
      </section>
    </div>`;
}

function takeOver() {
  if (confirm(`${current.owner} has claimed ${current.name}. Take it over?`)) update({owner: me()}, "It's yours now.");
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); say(done); }
  catch { say("Couldn't copy. Select the text and copy it by hand."); }
}

async function update(change, done) {
  const ok = await api("/api/lead", {method: "POST", body: JSON.stringify({id: openId, by: me(), ...change})});
  if (!ok) return false;
  const data = await api("/api/leads");
  if (data) { leads = data; render(); }
  await openLead(openId, false);
  if (done) say(done);
  return true;
}

start();
setInterval(() => { if (!document.hidden && !$("app").hidden) api("/api/leads").then((d) => { if (d) { leads = d; render(); } }); }, 30000);
