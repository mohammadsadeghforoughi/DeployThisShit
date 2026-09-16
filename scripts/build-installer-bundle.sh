#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd -- "${script_dir}/.." && pwd)
bundle_temp=$(mktemp -d /tmp/deploythisshit-bundle.XXXXXX)
cleanup() { rm -rf "${bundle_temp}"; }
trap cleanup EXIT

cd "${source_root}"
npm run build

stage="${bundle_temp}/stage"
mkdir -p \
  "${stage}/apps/server" \
  "${stage}/apps/dashboard" \
  "${stage}/packages/shared" \
  "${stage}/packages/cli" \
  "${stage}/deploy" \
  "${stage}/scripts"

cp package.json package-lock.json "${stage}/"
cp apps/server/package.json "${stage}/apps/server/"
cp apps/dashboard/package.json "${stage}/apps/dashboard/"
cp packages/shared/package.json "${stage}/packages/shared/"
cp packages/cli/package.json "${stage}/packages/cli/"
cp -a apps/server/dist "${stage}/apps/server/dist"
cp -a apps/dashboard/dist "${stage}/apps/dashboard/dist"
cp -a packages/shared/dist "${stage}/packages/shared/dist"
cp deploy/deploythisshit.service deploy/nginx-dashboard-http.conf deploy/nginx-dashboard-tls.conf "${stage}/deploy/"
cp scripts/install-server.sh scripts/configure-wildcard-tls.sh "${stage}/scripts/"
chmod 0755 "${stage}/scripts/install-server.sh" "${stage}/scripts/configure-wildcard-tls.sh"

tar -czf "${bundle_temp}/payload.tar.gz" -C "${stage}" .
mkdir -p "${source_root}/release"
cp "${source_root}/scripts/bootstrap-server.sh" "${source_root}/release/deploythisshit-installer.sh"
printf '\n__DEPLOYTHISSHIT_ARCHIVE_BELOW__\n' >> "${source_root}/release/deploythisshit-installer.sh"
cat "${bundle_temp}/payload.tar.gz" >> "${source_root}/release/deploythisshit-installer.sh"
chmod 0755 "${source_root}/release/deploythisshit-installer.sh"

printf 'Created %s (%s)\n' \
  "${source_root}/release/deploythisshit-installer.sh" \
  "$(du -h "${source_root}/release/deploythisshit-installer.sh" | cut -f1)"
