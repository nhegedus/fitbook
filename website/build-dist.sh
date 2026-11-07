#!/usr/bin/env bash
# Assembles the complete website into one folder, ready for any static host: the pages, the
# images (build-images.sh, needs ffmpeg with libwebp), the PWA icons, openapi.yaml, the signed
# APK from the GitLab package registry and the browser-only demo (same build as the `pages`
# job in ../.gitlab-ci.yml).
#
# Usage: website/build-dist.sh <dist> [site-url]
#
# With a site-url (e.g. https://my-copy.vercel.app) the copy in <dist> is made into a mirror:
# every absolute opengym.duarte-santos.ch URL (canonical, og:*, sitemap, robots) points at that
# address instead, and the upstream Umami analytics is left out. The sources here are untouched.
set -euo pipefail
dist=${1:?target dir}; site=${2:-}
here=$(cd "$(dirname "$0")" && pwd); root="$here/.."
version=$(node -p "require('$root/frontend/package.json').version")
dataset="https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd"

# Emptied, not removed: a host's link to the folder (Vercel's .vercel/) survives a rebuild.
mkdir -p "$dist"; find "$dist" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
rsync -a --exclude README.md --exclude 'build-*.sh' --exclude vercel.json "$here/" "$dist/"
[ -f "$here/vercel.json" ] && cp "$here/vercel.json" "$dist/vercel.json"
"$here/build-images.sh" "$dist/img"
cp "$root/frontend/public/icon-180.png" "$root/frontend/public/icon-512.png" "$root/api/openapi.yaml" "$dist/"

curl -fsSL -o "$dist/openGym.apk" \
  "https://gitlab.com/api/v4/projects/DuarteSantos8%2Fopengym/packages/generic/opengym-android/$version/openGym-$version.apk"

(cd "$root/frontend" && npm ci --ignore-scripts --no-audit --no-fund \
  && VITE_DEMO=1 VITE_IMG_BASE="$dataset/images/" VITE_GIF_BASE="$dataset/videos/" npm run build)
cp -R "$root/frontend/dist" "$dist/demo"

if [ -n "$site" ]; then
  site=${site%/}
  find "$dist" -maxdepth 1 -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' \) -print0 |
    xargs -0 perl -0pi -e '
      s#https://opengym\.duarte-santos\.ch#'"$site"'#g;
      s#[ \t]*<link rel="preconnect" href="https://stats\.duarte-santos\.ch">\n##g;
      s#[ \t]*<!-- Umami web analytics[^\n]*-->\n##g;
      s#[ \t]*<script[^>]*stats\.duarte-santos\.ch[^>]*></script>\n##g;'
fi
echo "site written to $dist (openGym $version${site:+, mirrored at $site})"
