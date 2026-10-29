"""Veyra's research-only block holds on every communication path, whatever
the config says. No test here sends anything: each path must refuse before
any network call (the block raises first)."""

import asyncio
import types

import pytest

from harvey import research_only
from harvey.research_only import CommunicationBlocked


def test_block_is_on_without_any_config():
    assert research_only.ACTIVE is True


def _autopilot_config():
    """The most permissive config Harvey knows: autopilot, every channel on."""
    email = types.SimpleNamespace(provider="gmail", enabled=True, require_approval=False)
    return types.SimpleNamespace(channels=types.SimpleNamespace(email=email))


@pytest.mark.parametrize("provider", ["gmail", "smtp", "microsoft"])
def test_no_mail_provider_can_be_built(provider, monkeypatch):
    from harvey.integrations.mail_provider import get_mail_provider
    monkeypatch.setenv("GMAIL_CLIENT_ID", "x")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    config = _autopilot_config()
    config.channels.email.provider = provider
    with pytest.raises(CommunicationBlocked):
        get_mail_provider(config, types.SimpleNamespace())


def test_even_a_custom_provider_cannot_exist():
    from harvey.integrations.mail_provider import MailProvider

    class Fake(MailProvider):
        def is_configured(self): return True
        async def send_email(self, *a, **k): raise AssertionError("sent")
        async def get_replies(self, limit=50): return []
        async def test_connection(self): return True, ""

    with pytest.raises(CommunicationBlocked):
        Fake()


def test_integrations_refuse():
    from harvey.integrations.instantly import InstantlyClient
    from harvey.integrations.linkedin import LinkedInAutomation
    from harvey.integrations.precleared import PreclearedClient
    from harvey.integrations.trulyinbox import TrulyInbox
    for build in (lambda: InstantlyClient("key"),
                  lambda: LinkedInAutomation("a@example.com", "pw"),
                  lambda: TrulyInbox("key"),
                  lambda: PreclearedClient("GB")):
        with pytest.raises(CommunicationBlocked):
            build()


def test_no_guessing_or_probing():
    from harvey.integrations import email_finder as ef
    calls = [ef.find_email("Ada", "Lovelace", "example.com"),
             ef.verify_email_smtp("info@example.com"),
             ef.verify_published_address("info@example.com"),
             ef.verify_reoon("info@example.com", "k"),
             ef.verify_zerobounce("info@example.com", "k"),
             ef.verify_hunter("info@example.com", "k")]
    for coro in calls:
        with pytest.raises(CommunicationBlocked):
            asyncio.run(coro)


def test_oauth_logins_refuse():
    from harvey.integrations.gmail import run_auth_flow as gmail_auth
    from harvey.integrations.microsoft import run_auth_flow as ms_auth
    with pytest.raises(CommunicationBlocked):
        gmail_auth("id", "secret")
    with pytest.raises(CommunicationBlocked):
        ms_auth("id")


def test_loop_and_setup_refuse():
    from harvey import cli, main
    with pytest.raises(CommunicationBlocked):
        main.main()
    with pytest.raises(CommunicationBlocked):
        cli.cmd_setup(None)


def test_dashboard_cannot_start_the_loop(monkeypatch):
    import harvey.dashboard as dash
    monkeypatch.setattr(dash, "_check_harvey_pid", lambda: None)
    popen = []
    monkeypatch.setattr(dash.subprocess, "Popen", lambda *a, **k: popen.append(a))
    out = asyncio.run(dash.start_harvey())
    assert out["success"] is False and "research-only" in out["message"]
    assert popen == []


def test_dashboard_approval_cannot_send(tmp_path):
    """Approving in the Outbox changes a row; the Sender that would send it can't be built."""
    from harvey.agents.sender import Sender
    from harvey.state import StateManager

    state = StateManager(str(tmp_path / "t.db"))
    asyncio.run(state.init_db())
    with pytest.raises(CommunicationBlocked):
        Sender(None, state, _autopilot_config(), types.SimpleNamespace(instantly_api_key="k"))
