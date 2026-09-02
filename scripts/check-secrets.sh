#!/bin/sh
# Fails the build if anything that must stay inside Edge Function secrets leaks into
# the app, the repo, or the build config. Runs in CI and before every commit.
#
#  1. The four Google/Drive secret NAMES and the service-role key must not be referenced
#     anywhere the app bundle is built from.
#  2. Secret-shaped VALUES must not appear anywhere in the repo at all, functions included
#     (functions read them from Deno.env, never from source).
set -eu
cd "$(dirname "$0")/.."

APP_PATHS="app src app.config.ts eas.json package.json"
# whole-token matches only: the generated types legitimately mention the is_service_role() helper
NAMES='GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN|DRIVE_ROOT_FOLDER_ID|SUPABASE_SERVICE_ROLE_KEY|(^|[^[:alnum:]_])service_role([^[:alnum:]_]|$)'
# GOCSPX- = Google client secret, ya29. = Google access token, 1//0 = Google refresh token,
# eyJhbGciOi = a JWT (Supabase service_role / anon keys are JWTs; anon must come from env, not source)
VALUES='GOCSPX-[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|1//0[A-Za-z0-9_-]{20,}|eyJhbGciOi[A-Za-z0-9_-]{20,}'

status=0
if hits=$(grep -rnE "$NAMES" $APP_PATHS 2>/dev/null); then
  echo "FAIL: secret names referenced in app code or build config:"; echo "$hits"; status=1
fi
if hits=$(grep -rnE "$VALUES" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.expo \
      --exclude-dir=.temp --exclude='.env' --exclude='.env.*' 2>/dev/null); then
  echo "FAIL: secret-shaped values found in the repo:"; echo "$hits"; status=1
fi
[ "$status" -eq 0 ] && echo "secrets check: clean"
exit $status
