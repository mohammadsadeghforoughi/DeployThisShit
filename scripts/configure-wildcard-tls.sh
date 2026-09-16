#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this command with sudo." >&2
  exit 1
fi

management_host=${1:-}
apps_base_domain=${2:-}
account_email=${3:-}

domain_pattern='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
if [[ -z ${management_host} || -z ${apps_base_domain} || -z ${account_email} || \
      ! ${management_host} =~ ${domain_pattern} || ! ${apps_base_domain} =~ ${domain_pattern} ]]; then
  echo "Usage: sudo ./scripts/configure-wildcard-tls.sh deploy.example.com apps.example.com you@example.com" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd -- "${script_dir}/.." && pwd)
environment_file=/etc/deploythisshit/server.env
credentials_file=/etc/deploythisshit/cloudflare-certbot.ini

if [[ ! -f ${environment_file} ]]; then
  echo "Install the server agent before configuring TLS." >&2
  exit 1
fi

cloudflare_token=${CLOUDFLARE_API_TOKEN:-}
if [[ -z ${cloudflare_token} ]]; then
  read -r -s -p "Cloudflare API token for DNS validation: " cloudflare_token
  echo
fi
if [[ -z ${cloudflare_token} ]]; then
  echo "A Cloudflare API token is required." >&2
  exit 1
fi

install -m 0600 /dev/null "${credentials_file}"
printf 'dns_cloudflare_api_token = %s\n' "${cloudflare_token}" > "${credentials_file}"

certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials "${credentials_file}" \
  --dns-cloudflare-propagation-seconds 30 \
  --cert-name deploythisshit \
  --domain "${management_host}" \
  --domain "*.${apps_base_domain}" \
  --email "${account_email}" \
  --agree-tos \
  --non-interactive

next_environment=$(mktemp)
grep -Ev '^DTS_(TLS_DOMAIN_SUFFIX|TLS_CERTIFICATE|TLS_KEY)=' "${environment_file}" > "${next_environment}" || true
{
  echo "DTS_TLS_DOMAIN_SUFFIX=${apps_base_domain}"
  echo "DTS_TLS_CERTIFICATE=/etc/letsencrypt/live/deploythisshit/fullchain.pem"
  echo "DTS_TLS_KEY=/etc/letsencrypt/live/deploythisshit/privkey.pem"
} >> "${next_environment}"
install -m 0600 "${next_environment}" "${environment_file}"
rm -f "${next_environment}"

sed "s|@MANAGEMENT_HOST@|${management_host}|g" \
  "${source_root}/deploy/nginx-dashboard-tls.conf" \
  > /etc/nginx/sites-available/deploythisshit.conf

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/50-deploythisshit-nginx <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
nginx -t
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/50-deploythisshit-nginx

nginx -t
systemctl restart deploythisshit
systemctl reload nginx

echo
echo "HTTPS is active for ${management_host} and *.${apps_base_domain}."
echo "Use a separate Cloudflare token in the dashboard to let deployments create application DNS records."
