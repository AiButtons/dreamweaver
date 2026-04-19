"""
Unit tests for `deep.factory._build_checkpointer` (infra #2).

The factory must:
  1. Fall back to MemorySaver when STORYBOARD_CHECKPOINT_POSTGRES_URI is
     unset — we don't want local dev or ephemeral CI jobs to fail because
     they have no Postgres.
  2. Build a PostgresSaver over a `psycopg_pool.ConnectionPool` when the
     env var is set AND the driver imports succeed.
  3. Fall back to MemorySaver cleanly when `ConnectionPool(...)` raises
     (bad URI, DNS, auth, network) — a misconfigured URI must not kill
     the entire server.
  4. Stash the pool handle on `_checkpointer_pool` so
     `close_checkpointer()` can release it on shutdown, and `None` it
     out on fall-back paths.
  5. `close_checkpointer()` is idempotent — callable multiple times + a
     no-op in MemorySaver mode.
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from langgraph.checkpoint.memory import MemorySaver

from deep import factory


class BuildCheckpointerTests(unittest.TestCase):
    def setUp(self) -> None:
        # Reset the module-level singletons between tests so each case runs
        # from a clean slate. The real code initializes them at import
        # time but the public API only reads through `_resolve_checkpointer`.
        factory._checkpointer_singleton = None
        factory._checkpointer_pool = None

    def test_unset_uri_returns_memory_saver(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            import os

            os.environ.pop("STORYBOARD_CHECKPOINT_POSTGRES_URI", None)
            saver = factory._build_checkpointer()
        self.assertIsInstance(saver, MemorySaver)
        self.assertIsNone(factory._checkpointer_pool)

    def test_blank_uri_returns_memory_saver(self) -> None:
        with patch.dict(
            "os.environ",
            {"STORYBOARD_CHECKPOINT_POSTGRES_URI": "   "},
            clear=False,
        ):
            saver = factory._build_checkpointer()
        self.assertIsInstance(saver, MemorySaver)

    def test_uri_with_bad_connection_falls_back_to_memory(self) -> None:
        # Simulate `ConnectionPool(...)` raising — e.g. unreachable DB.
        # The factory should swallow the error and keep the server alive
        # with MemorySaver, not crash graph startup.
        with patch.dict(
            "os.environ",
            {
                "STORYBOARD_CHECKPOINT_POSTGRES_URI": (
                    "postgresql://fake:fake@no-such-host:5432/db"
                ),
            },
            clear=False,
        ):
            with patch("psycopg_pool.ConnectionPool") as pool_cls:
                pool_cls.side_effect = RuntimeError("DNS failure")
                saver = factory._build_checkpointer()
        self.assertIsInstance(saver, MemorySaver)
        self.assertIsNone(factory._checkpointer_pool)

    def test_successful_uri_returns_postgres_saver(self) -> None:
        # Patch both the pool constructor and the PostgresSaver class so we
        # don't need a live Postgres. We verify that:
        #   - the pool is instantiated with the configured max_size
        #   - setup() is called
        #   - the factory stashes the pool so close_checkpointer can find it
        fake_pool = MagicMock()
        fake_saver = MagicMock()
        with patch.dict(
            "os.environ",
            {
                "STORYBOARD_CHECKPOINT_POSTGRES_URI": (
                    "postgresql://storyboard:storyboard@localhost:5433/sb"
                ),
                "STORYBOARD_CHECKPOINT_POSTGRES_MAX_CONN": "5",
            },
            clear=False,
        ):
            with (
                patch("psycopg_pool.ConnectionPool", return_value=fake_pool) as pool_cls,
                patch(
                    "langgraph.checkpoint.postgres.PostgresSaver",
                    return_value=fake_saver,
                ) as saver_cls,
            ):
                saver = factory._build_checkpointer()

        self.assertIs(saver, fake_saver)
        pool_cls.assert_called_once()
        self.assertEqual(pool_cls.call_args.kwargs["max_size"], 5)
        saver_cls.assert_called_once_with(fake_pool)
        fake_saver.setup.assert_called_once()
        self.assertIs(factory._checkpointer_pool, fake_pool)

    def test_invalid_max_conn_defaults_to_ten(self) -> None:
        # A non-numeric STORYBOARD_CHECKPOINT_POSTGRES_MAX_CONN must not
        # crash the factory — it falls back to the documented default.
        fake_pool = MagicMock()
        fake_saver = MagicMock()
        with patch.dict(
            "os.environ",
            {
                "STORYBOARD_CHECKPOINT_POSTGRES_URI": (
                    "postgresql://s:s@localhost:5433/sb"
                ),
                "STORYBOARD_CHECKPOINT_POSTGRES_MAX_CONN": "not-a-number",
            },
            clear=False,
        ):
            with (
                patch("psycopg_pool.ConnectionPool", return_value=fake_pool) as pool_cls,
                patch("langgraph.checkpoint.postgres.PostgresSaver", return_value=fake_saver),
            ):
                factory._build_checkpointer()

        self.assertEqual(pool_cls.call_args.kwargs["max_size"], 10)


class CloseCheckpointerTests(unittest.TestCase):
    def setUp(self) -> None:
        factory._checkpointer_singleton = None
        factory._checkpointer_pool = None

    def test_close_is_noop_when_pool_is_none(self) -> None:
        # No pool → nothing to close. Must not raise.
        factory.close_checkpointer()
        self.assertIsNone(factory._checkpointer_pool)

    def test_close_releases_pool_and_clears_handle(self) -> None:
        fake_pool = MagicMock()
        factory._checkpointer_pool = fake_pool
        factory.close_checkpointer()
        fake_pool.close.assert_called_once()
        self.assertIsNone(factory._checkpointer_pool)

    def test_close_is_idempotent(self) -> None:
        fake_pool = MagicMock()
        factory._checkpointer_pool = fake_pool
        factory.close_checkpointer()
        factory.close_checkpointer()
        # Pool close should only fire once despite the second call.
        self.assertEqual(fake_pool.close.call_count, 1)

    def test_close_swallows_pool_close_errors(self) -> None:
        fake_pool = MagicMock()
        fake_pool.close.side_effect = RuntimeError("pool already gone")
        factory._checkpointer_pool = fake_pool
        # Must not re-raise — we're shutting down, any error is informational.
        factory.close_checkpointer()
        self.assertIsNone(factory._checkpointer_pool)


if __name__ == "__main__":
    unittest.main()
