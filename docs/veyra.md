# Veyra operator guide

Veyra is our private, **research-only** B2B prospecting tool. It is an
adaptation of [Harvey](https://github.com/ethanplusai/harvey) by Ethan Rogers,
used under Harvey's MIT licence (see `LICENSE`, kept unchanged). We did not
write Harvey; Veyra adds a send block, a research pilot and these docs on top
of it. Upstream base: `ethanplusai/harvey` commit
`4237f07f5873e270c362b43aec76e60fc4faa9cf` (full history is kept; the remote
is named `upstream` and pushing to it is disabled).

## Research-only mode (always on)

Veyra never contacts anyone. `harvey/research_only.py` raises
`CommunicationBlocked` before any of these can happen:

| Path | Where it is blocked |
|---|---|
| Gmail / Microsoft 365 / SMTP sending, reply reading, outbox drain | `MailProvider.__new__`: no mailbox object can exist |
| Gmail / Microsoft OAuth login (`harvey gmail auth`, `harvey microsoft auth`) | `run_auth_flow` |
| Instantly campaigns and replies | `InstantlyClient.__init__` |
| LinkedIn automation | `LinkedInAutomation.__init__` |
| TrulyInbox warmup | `TrulyInbox.__init__` |
| Precleared (sends recipient addresses to a third party) | `PreclearedClient.__init__` |
| Email guessing, verifier APIs, SMTP probes | `find_email`, `verify_*`, Hunter lookups |
| Autonomous heartbeat loop (`harvey run`, dashboard Start) | `main.main`, `/api/harvey/start` |
| Setup wizard (`harvey setup`) | `cmd_setup` |

There is **no config switch**: a missing or wrong config cannot restore
sending. Dashboard approval only changes a database row; the Sender that would
send it cannot be constructed. Harvey never submitted contact forms, and Veyra
adds no such path. Lifting the block means a reviewed code change to
`research_only.py`. The tracked `harvey.yaml` also has `channels.email.enabled:
false`.

Tests: `tests/test_veyra_research_only.py` (each path refuses, with an
autopilot-style config and fake credentials set; nothing is sent). Harvey's
original send-logic tests still run against fakes because `tests/conftest.py`
lifts the block for every test file except `test_veyra_*`.

## Names we kept from Harvey

The Python package (`harvey`), the CLI command (`harvey ...`), `harvey.yaml`,
`data/harvey.db`, the `.env` variable names and log prefixes are unchanged.
Renaming them would touch hundreds of imports and tests for no functional
gain, and would make pulling upstream fixes harder. "Veyra" is the project and
product name; `harvey` is an internal name.

## The research pilot

Settings are in `veyra.yaml` (tracked, non-secret): sender placeholders, our
offer, regions, cities, search terms, shortlist size and the model-call budget.

```bash
source .venv/bin/activate
harvey signals --confirm free   # once per database: lets free collectors record facts
harvey pilot run                # start or resume the current batch
harvey pilot status             # stage counts, model calls used, token usage
harvey pilot mark acme.example.com --state reviewed        # record decisions by hand
harvey pilot mark acme.example.com --state contacted --note "emailed by hand 2026-11-02"
harvey pilot mark acme.example.com --state do_not_contact --note "asked not to"
harvey pilot new-batch          # only when we decide to research another batch
harvey pilot run
```

Stages (saved per company, so Ctrl-C or a crash loses nothing):
`candidate → evidence → triaged → shortlisted → drafted → reviewed` (or
`no_evidence`, `not_shortlisted`, `dropped` by review).

1. **Discover** (free): OpenStreetMap `shop=wholesale|trade` and HVAC /
   plumbing / electrician trades around the configured cities. Only companies
   with a website. Harvey's junk filter and do-not-contact list apply; already
   researched companies are never re-added (dedup by domain/OSM id).
2. **Evidence** (free): Harvey's profiler, plus the homepage and up to three
   relevant same-site pages (quote, order, catalogue, portal, contact...),
   honouring robots.txt. Cached in `data/research/evidence/`, reused on resume.
   Only addresses/phones the company publishes on its own site are recorded.
3. **Triage** (model, 5 companies per call): facts must cite a fetched page;
   anything else is moved to unknowns by code.
4. **Shortlist**: up to 5 with fit ≥ 6 and at least one sourced fact; never a
   `do_not_contact` or `contacted` company.
5. **Profile + draft** (model, one call each), then **one review call** that
   challenges all of them.

**Budget.** `pilot.model_call_budget` (15) counts every model attempt,
including retries, per batch, stored in the database before each call, so a
resume never gets a fresh allowance. At the limit the run pauses with
everything saved; raising it is your decision. A call that gets no reply at
all (logged out, outage, timeout) counts as one attempt and pauses the run
instead of burning the rest of the budget; check `claude login` and resume.
Run the pilot from your own terminal: a child `claude` started from inside
another tool's session may not have a valid login of its own. Token counts come from the
Claude CLI's own report (`usage_events`, agent `veyra_pilot`); dollar cost is
not measurable on a subscription plan.

**Outreach states** (`unreviewed`, `reviewed`, `contacted`, `do_not_contact`,
`rejected`) are only ever set by `harvey pilot mark`. Veyra never infers that
outreach happened.

## Outputs

- `data/research/SHORTLIST.md`: index of the batch, linking each profile.
- `data/research/profiles/<company>.md`: one profile per shortlisted company:
  facts with source links and dates, hypotheses, unknowns, review, contact
  route or UNKNOWN, first engagement, the draft (labelled **REVIEW DRAFT —
  NOT APPROVED FOR SENDING**), legal flags and the next manual action.
- The same draft is stored with the company in `veyra_research`
  (`data/harvey.db`).

All of `data/` is ignored by Git: real prospects and drafts never get
committed.

## Setting up another Mac (Apple Silicon or Intel)

```bash
xcode-select --install                     # git, if missing
brew install python@3.13                   # or any Python >= 3.11
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code CLI, then:
claude login                               # with that machine's own account
git clone https://github.com/Glumac7/veyra.git && cd veyra
python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'
pytest -q tests/test_veyra_research_only.py tests/test_veyra_pilot.py
harvey pilot status
```

No `.env` is needed for research. Don't copy credentials between machines;
each machine uses its own login. Nothing in the repo contains a username or
absolute path.

## Backup and restore

Git holds code. It does not sync the database. Everything operational
(companies, observations, research rows, drafts, outreach and suppression
states, model-call budget) is in `data/harvey.db`; profiles and cached
evidence are in `data/research/`; a do-not-contact list may also be in
`harvey.local.yaml`.

```bash
# backup (safe while nothing is writing; sqlite .backup is consistent)
mkdir -p backups
sqlite3 data/harvey.db ".backup backups/harvey-$(date +%F).db"
tar czf "backups/research-$(date +%F).tar.gz" data/research $(ls harvey.local.yaml 2>/dev/null)

# restore (on the same or another machine, after cloning)
mkdir -p data
cp backups/harvey-2026-10-29.db data/harvey.db
tar xzf backups/research-2026-10-29.tar.gz
```

`backups/` is ignored by Git. Keep copies somewhere private (encrypted disk or
private storage), since they contain business contact data.

## One pipeline, one host

Each clone has its own independent database: two laptops running the pilot
would research, budget and mark companies separately and drift apart. For a
shared pipeline, pick **one host** (later a Mac Mini) and run Veyra only
there; the other engineer works on that host (SSH / screen sharing) or reviews
the Markdown it produces. To move: stop runs on the old host, back up as
above, clone and set up on the Mac Mini, restore the backup, run `harvey pilot
status` to confirm counts, then stop using the old copy. We are not building
synchronisation or multi-user features.
