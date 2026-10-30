"""Veyra runs research-only: nothing it does may reach a prospect.

Every path that could contact someone, or touch a mailbox, calls ``refuse``
first: building a mail provider (so sending, reading replies and dashboard
approval all stop there), Instantly, LinkedIn, TrulyInbox warmup, Precleared,
email guessing and SMTP/verifier probes, the autonomous heartbeat loop and the
setup wizard.

There is deliberately no config switch. A missing, stale or malformed config
must never turn outreach back on, so the block is code: lifting it means a
reviewed change to this file.
"""

# Only the test suite flips this, so Harvey's original send logic stays
# tested against fakes. Production code never assigns it.
ACTIVE = True


class CommunicationBlocked(RuntimeError):
    """Raised instead of any outbound communication."""


def refuse(what: str) -> None:
    if ACTIVE:
        raise CommunicationBlocked(
            f"{what} is blocked: Veyra runs research-only. Nothing is sent, "
            "no mailbox is connected and no address is guessed or probed. "
            "See docs/veyra.md.")
