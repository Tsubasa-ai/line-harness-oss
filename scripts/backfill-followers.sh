#!/usr/bin/env bash
# Webhook 設置前から友だちだったユーザーを friends テーブルに取り込む。
#
# 使い方:
#   scripts/backfill-followers.sh <accountId> [--dry-run]
#
# accountId は line_accounts.id（内部UUID。LINEのチャネルIDではない）。
#   AOプロジェクト          51838206-a0f3-4e11-be8e-ea92eea44fe8
#   PC・AI活用の専門家      8c413816-e29e-470b-b559-4d1c23793816
#
# APIキーは .env の LINE_HARNESS_API_KEY を使う。
# next が返らなくなるまで自動でページを進める（1ページ最大300件）。

set -euo pipefail

ACCOUNT_ID="${1:?accountId is required}"
DRY_RUN=""
[ "${2:-}" = "--dry-run" ] && DRY_RUN="&dryRun=1"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_DIR/.env"

BASE="https://line-harness.handrice-english2020.workers.dev/api/admin/backfill-followers"
TOKEN=""
PAGE=1

while :; do
  URL="$BASE?accountId=$ACCOUNT_ID$DRY_RUN"
  [ -n "$TOKEN" ] && URL="$URL&continuationToken=$TOKEN"

  RESPONSE="$(curl -sS -X POST "$URL" -H "Authorization: Bearer $LINE_HARNESS_API_KEY")"
  echo "--- page $PAGE ---"
  echo "$RESPONSE" | python3 -m json.tool

  if ! echo "$RESPONSE" | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('success') else 1)"; then
    echo "失敗したので中断します" >&2
    exit 1
  fi

  TOKEN="$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('next') or '')")"
  [ -z "$TOKEN" ] && break

  PAGE=$((PAGE + 1))
  sleep 1
done

echo "完了"
