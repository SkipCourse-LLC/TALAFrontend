#!/usr/bin/env bash
# Fails when a tracked file contains something shaped like a credential.
# Prints file names only, so a found secret is never copied into CI logs.
# Example files (.env.example) must hold placeholders, never real values.
set -euo pipefail

pattern='GOCSPX-[A-Za-z0-9_-]{10,}'                      # Google OAuth client secret
pattern+='|1//0[A-Za-z0-9_-]{20,}'                       # Google OAuth refresh token
pattern+='|ya29\.[A-Za-z0-9_-]{20,}'                     # Google OAuth access token
pattern+='|AIza[0-9A-Za-z_-]{35}'                        # Google API key
pattern+='|-----BEGIN [A-Z ]*PRIVATE KEY-----'           # private keys
pattern+='|script\.google\.com/macros/s/[A-Za-z0-9_-]{20,}' # Apps Script web app endpoints
pattern+='|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}' # GitHub tokens
pattern+='|sk_live_[0-9A-Za-z]{10,}|rk_live_[0-9A-Za-z]{10,}'      # Stripe live keys
pattern+='|xox[abprs]-[A-Za-z0-9-]{10,}'                 # Slack tokens
pattern+='|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}'   # SendGrid keys

# --staged checks what is about to be committed (used by the local pre-commit hook).
scope=()
[ "${1:-}" = "--staged" ] && scope=(--cached)

if files=$(git grep "${scope[@]}" -lIE "$pattern" -- . ':!.github/scripts/leak-scan.sh'); then
  echo "Possible secrets in tracked files (values not shown):"
  echo "$files"
  echo "::error::Remove the values, revoke them with their provider, and use environment variables instead."
  exit 1
fi
echo "No credential-shaped values found in tracked files."
