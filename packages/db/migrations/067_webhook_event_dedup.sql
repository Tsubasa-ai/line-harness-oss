-- Migration 067: Webhook event dedup
--
-- LINE resends a webhook event (same webhookEventId, deliveryContext.isRedelivery
-- may or may not be set reliably by intermediaries) when our response isn't
-- received in time. Without a dedup guard, a redelivered `follow` event
-- re-runs the friend_add scenario enrollment and double-sends the welcome
-- message (observed 2026-08-13, ~1.2s apart, friend 三浦(橋本)なほ) — the
-- partial UNIQUE on friend_scenarios (WHERE status != 'completed') doesn't
-- block re-enrollment once the first delivery already completed the
-- single-step scenario, and skipCooldown:true on the friend_add path
-- bypasses the 60s duplicate-send probe by design (real re-follows must
-- still get a welcome).
--
-- Conventions follow booking_idempotency_keys (036_booking.sql): TEXT
-- primary key, JST created_at default, UTC ISO8601 expires_at with no
-- default (set by the Worker).

CREATE TABLE IF NOT EXISTS webhook_event_dedup (
  webhook_event_id TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL                  -- UTC ISO8601
);
CREATE INDEX IF NOT EXISTS idx_webhook_event_dedup_expires ON webhook_event_dedup (expires_at);
