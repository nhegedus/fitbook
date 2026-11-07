#!/usr/bin/env bash
# Builds the web app for Vercel and deploys it, with /api forwarded to an openGym API running
# elsewhere (Railway, Fly.io, a VPS — anything with a persistent ./data). Vercel takes the place
# of the `web` container: it serves the bundle and proxies /api, so the browser still sees one
# origin, which passkeys and the session cookie need. The exercise media comes from the jsDelivr
# CDN (as in the mobile build) instead of the `media` volume.
#
# Usage: scripts/deploy-vercel.sh <api-url> [vercel-project]
#   e.g. scripts/deploy-vercel.sh https://api-production-cbf8.up.railway.app opengym-app
#
# The API needs RP_ID and ORIGIN set to the Vercel address (see docs/SELF_HOSTING.md).
set -euo pipefail
api=${1:?api url}; api=${api%/}; project=${2:-opengym-app}
root=$(cd "$(dirname "$0")/.." && pwd)
dataset="https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd"
out=$(mktemp -d)

(cd "$root/frontend" && npm ci --ignore-scripts --no-audit --no-fund \
  && VITE_IMG_BASE="$dataset/images/" VITE_GIF_BASE="$dataset/videos/" npx vite build --outDir "$out" --emptyOutDir)

# Same headers as web/nginx.conf.template.
cat > "$out/vercel.json" <<EOF
{
  "framework": null,
  "buildCommand": null,
  "installCommand": null,
  "outputDirectory": ".",
  "rewrites": [
    { "source": "/api/:path*", "destination": "$api/api/:path*" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "same-origin" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "Cache-Control", "value": "no-cache, must-revalidate" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
EOF

vercel link --yes --project "$project" --cwd "$out" >/dev/null
vercel deploy --prod --yes --cwd "$out"
