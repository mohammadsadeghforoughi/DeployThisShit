#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

management_host=${1:-}
if [[ -z ${management_host} || ! ${management_host} =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "Usage: sudo ./scripts/install-server.sh deploy.example.com" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd -- "${script_dir}/.." && pwd)
install_root=/opt/deploythisshit
config_root=/etc/deploythisshit
data_root=/var/lib/deploythisshit
node_path=$(command -v node || true)

if [[ -z ${node_path} ]]; then
  echo "Node.js 22 or newer is required before installation." >&2
  exit 1
fi

node_major=$(${node_path} -p 'process.versions.node.split(".")[0]')
if (( node_major < 22 )); then
  echo "Node.js 22 or newer is required; found $(${node_path} --version)." >&2
  exit 1
fi

for path in \
  "${source_root}/apps/server/dist/index.js" \
  "${source_root}/apps/dashboard/dist/index.html" \
  "${source_root}/packages/shared/dist/index.js"; do
  if [[ ! -f ${path} ]]; then
    echo "Build artifacts are missing. Run 'npm ci && npm run build' as your normal user first." >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates docker.io nginx apache2-utils certbot python3-certbot-dns-cloudflare
systemctl enable --now docker nginx

install -d -m 0755 \
  "${install_root}/apps/server" \
  "${install_root}/apps/dashboard" \
  "${install_root}/packages/shared" \
  "${install_root}/packages/cli" \
  "${config_root}"
install -d -m 0700 "${data_root}"

install -m 0644 "${source_root}/package.json" "${install_root}/package.json"
install -m 0644 "${source_root}/package-lock.json" "${install_root}/package-lock.json"
install -m 0644 "${source_root}/apps/server/package.json" "${install_root}/apps/server/package.json"
install -m 0644 "${source_root}/apps/dashboard/package.json" "${install_root}/apps/dashboard/package.json"
install -m 0644 "${source_root}/packages/shared/package.json" "${install_root}/packages/shared/package.json"
install -m 0644 "${source_root}/packages/cli/package.json" "${install_root}/packages/cli/package.json"

rm -rf \
  "${install_root}/apps/server/dist" \
  "${install_root}/apps/dashboard/dist" \
  "${install_root}/packages/shared/dist"
cp -a "${source_root}/apps/server/dist" "${install_root}/apps/server/dist"
cp -a "${source_root}/apps/dashboard/dist" "${install_root}/apps/dashboard/dist"
cp -a "${source_root}/packages/shared/dist" "${install_root}/packages/shared/dist"

(
  cd "${install_root}"
  npm ci --omit=dev --ignore-scripts
)

environment_file=${config_root}/server.env
if [[ ! -f ${environment_file} ]]; then
  admin_token=$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=')
  master_key=$(openssl rand -base64 32)
  install -m 0600 /dev/null "${environment_file}"
  {
    echo "DTS_HOST=127.0.0.1"
    echo "DTS_PORT=8787"
    echo "DTS_PUBLIC_URL=https://${management_host}"
    echo "DTS_DATA_DIR=${data_root}"
    echo "DTS_DASHBOARD_DIR=${install_root}/apps/dashboard/dist"
    echo "DTS_DRIVER=system"
    echo "DTS_ADMIN_TOKEN=${admin_token}"
    echo "DTS_MASTER_KEY=${master_key}"
  } >> "${environment_file}"
else
  echo "Keeping the existing ${environment_file}."
fi

sed "s|@NODE_PATH@|${node_path}|g" \
  "${source_root}/deploy/deploythisshit.service" \
  > /etc/systemd/system/deploythisshit.service

sed "s|@MANAGEMENT_HOST@|${management_host}|g" \
  "${source_root}/deploy/nginx-dashboard-http.conf" \
  > /etc/nginx/sites-available/deploythisshit.conf
ln -sfn /etc/nginx/sites-available/deploythisshit.conf /etc/nginx/sites-enabled/deploythisshit.conf
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable --now deploythisshit
systemctl reload nginx

echo
echo "DeployThisShit is installed and listening through Nginx."
echo "Next: point ${management_host} to this server, then run:"
echo "  sudo ./scripts/configure-wildcard-tls.sh ${management_host} apps.example.com you@example.com"
echo
echo "The dashboard admin token is stored in ${environment_file}."
