#!/usr/bin/env bash
set -euo pipefail

readonly red='\033[0;31m'
readonly green='\033[0;32m'
readonly amber='\033[0;33m'
readonly bold='\033[1m'
readonly reset='\033[0m'
readonly project_repository='https://github.com/mohammadsadeghforoughi/DeployThisShit'

info() { printf '%b\n' "${bold}→${reset} $*"; }
success() { printf '%b\n' "${green}✓${reset} $*"; }
warn() { printf '%b\n' "${amber}!${reset} $*"; }
fail() { printf '%b\n' "${red}✗ $*${reset}" >&2; exit 1; }

verify_bundle=false
case ${1:-} in
  '') ;;
  --verify-bundle) verify_bundle=true ;;
  *) fail "Unknown option: ${1}. Supported option: --verify-bundle" ;;
esac

bootstrap_temp=$(mktemp -d /tmp/deploythisshit-bootstrap.XXXXXX)
cleanup() {
  rm -rf "${bootstrap_temp}"
}
trap cleanup EXIT

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(cd -- "${script_dir}/.." && pwd)
payload_line=$(awk '$0 == "__DEPLOYTHISSHIT_ARCHIVE_BELOW__" { print NR + 1; exit }' "$0")
embedded_payload=false

if [[ -n ${payload_line} ]]; then
  embedded_payload=true
  mkdir -p "${bootstrap_temp}/source"
  tail -n +"${payload_line}" "$0" | tar -xzf - -C "${bootstrap_temp}/source"
  source_root="${bootstrap_temp}/source"
elif [[ ! -f ${source_root}/deploy/deploythisshit.service ]]; then
  fail "The installer payload is missing. Run this script from the repository or use the bundled installer."
fi

required_payload=(
  package.json
  package-lock.json
  deploy/deploythisshit.service
  scripts/install-server.sh
  scripts/configure-wildcard-tls.sh
)
if [[ ${embedded_payload} == true || ${verify_bundle} == true ]]; then
  required_payload+=(
    apps/server/dist/index.js
    apps/dashboard/dist/index.html
    packages/shared/dist/index.js
  )
fi
for required_path in "${required_payload[@]}"; do
  [[ -f ${source_root}/${required_path} ]] || fail "Installer payload is incomplete: ${required_path} is missing."
done

if [[ ${verify_bundle} == true ]]; then
  success "Installer payload verified successfully"
  exit 0
fi

if [[ ${EUID} -ne 0 ]]; then
  fail "Run this installer with sudo: sudo bash $0"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "This installer requires Ubuntu 22.04 or 24.04."
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ ${ID:-} != "ubuntu" ]]; then
  fail "This installer currently supports Ubuntu only. Detected: ${PRETTY_NAME:-unknown}."
fi

case ${VERSION_ID:-} in
  22.04|24.04) ;;
  *) warn "Ubuntu ${VERSION_ID:-unknown} has not been validated. Continuing at your request is unsupported." ;;
esac

printf '\n%b\n' "${bold}DeployThisShit server setup${reset}"
printf '%s\n\n' "This will configure one Ubuntu server, one Cloudflare zone, HTTPS, and the dashboard."

if [[ ! -t 0 ]]; then
  fail "Interactive input is required. Run this installer directly in an SSH terminal."
fi

info "Inspecting the server"
architecture=$(dpkg --print-architecture)
if [[ ${architecture} != "amd64" && ${architecture} != "arm64" ]]; then
  fail "Only amd64 and arm64 servers are supported. Detected: ${architecture}."
fi
if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemd is required on the server."
fi

export DEBIAN_FRONTEND=noninteractive
apt_updated=false
refresh_apt_index() {
  if [[ ${apt_updated} == false ]]; then
    apt-get update
    apt_updated=true
  fi
}

bootstrap_packages=(ca-certificates curl jq tar)
missing_bootstrap_packages=()
for package_name in "${bootstrap_packages[@]}"; do
  if ! dpkg-query -W -f='${Status}' "${package_name}" 2>/dev/null | grep -q 'install ok installed'; then
    missing_bootstrap_packages+=("${package_name}")
  fi
done
if (( ${#missing_bootstrap_packages[@]} > 0 )); then
  info "Installing the small tools needed to validate Cloudflare"
  refresh_apt_index
  apt-get install -y "${missing_bootstrap_packages[@]}"
fi

printf '\n%s\n' "Create a Cloudflare user or account API token with these permissions for the zone you want to use:"
printf '  %s\n' "Zone → Zone → Read" "Zone → DNS → Edit"
printf '%s\n\n' "The token is hidden while you type and is never written to the installation log."

cloudflare_token=''
while [[ -z ${cloudflare_token} ]]; do
  read -r -s -p "Cloudflare API token: " cloudflare_token
  printf '\n'
done

cloudflare_api='https://api.cloudflare.com/client/v4'
cloudflare_account_id=''
token_verify_endpoint='/user/tokens/verify'
if [[ ${cloudflare_token} == cfat_* ]]; then
  success "Detected a Cloudflare account API token"
  while [[ ! ${cloudflare_account_id} =~ ^[a-fA-F0-9]{32}$ ]]; do
    read -r -p "Cloudflare Account ID: " cloudflare_account_id
    if [[ ! ${cloudflare_account_id} =~ ^[a-fA-F0-9]{32}$ ]]; then
      warn "The Account ID must be the 32-character ID shown in Cloudflare's token test command."
    fi
  done
  token_verify_endpoint="/accounts/${cloudflare_account_id}/tokens/verify"
elif [[ ${cloudflare_token} == cfut_* ]]; then
  success "Detected a Cloudflare user API token"
else
  warn "This token uses a legacy or unrecognized prefix; testing it as a user API token."
fi

cloudflare_get() {
  local endpoint=$1
  curl -fsS \
    -H "Authorization: Bearer ${cloudflare_token}" \
    -H 'Content-Type: application/json' \
    "${cloudflare_api}${endpoint}"
}

cloudflare_write() {
  local method=$1
  local endpoint=$2
  local body=$3
  curl -fsS \
    -X "${method}" \
    -H "Authorization: Bearer ${cloudflare_token}" \
    -H 'Content-Type: application/json' \
    --data "${body}" \
    "${cloudflare_api}${endpoint}"
}

info "Testing the Cloudflare token"
if ! token_response=$(curl -sS \
  -H "Authorization: Bearer ${cloudflare_token}" \
  -H 'Content-Type: application/json' \
  "${cloudflare_api}${token_verify_endpoint}" 2>/dev/null); then
  fail "Could not reach Cloudflare to test the token. Check the server's internet connection."
fi
if ! jq -e '.success == true and .result.status == "active"' >/dev/null <<<"${token_response}"; then
  token_error=$(jq -r '.errors[0].message // "The token is not active."' <<<"${token_response}" 2>/dev/null || true)
  fail "Cloudflare rejected the token: ${token_error:-unknown error}"
fi
success "Cloudflare accepted the token"

zones_file="${bootstrap_temp}/zones.tsv"
: > "${zones_file}"
page=1
total_pages=1
while (( page <= total_pages )); do
  if ! zones_response=$(cloudflare_get "/zones?status=active&per_page=50&page=${page}" 2>/dev/null); then
    fail "The token cannot list zones. Add Zone → Zone → Read permission."
  fi
  if ! jq -e '.success == true' >/dev/null <<<"${zones_response}"; then
    fail "Cloudflare could not list the accessible zones."
  fi
  jq -r '.result[] | [.id, .name] | @tsv' <<<"${zones_response}" >> "${zones_file}"
  total_pages=$(jq -r '.result_info.total_pages // 1' <<<"${zones_response}")
  ((page += 1))
done

mapfile -t zone_rows < "${zones_file}"
if (( ${#zone_rows[@]} == 0 )); then
  fail "No active domains are available to this token."
fi

printf '\n%b\n' "${bold}Choose a domain for DeployThisShit:${reset}"
for index in "${!zone_rows[@]}"; do
  IFS=$'\t' read -r _zone_id zone_name <<<"${zone_rows[$index]}"
  printf '  %d) %s\n' "$((index + 1))" "${zone_name}"
done

zone_choice=''
while true; do
  if (( ${#zone_rows[@]} == 1 )); then
    read -r -p "Domain [1]: " zone_choice
    zone_choice=${zone_choice:-1}
  else
    read -r -p "Domain number: " zone_choice
  fi
  if [[ ${zone_choice} =~ ^[0-9]+$ ]] && (( zone_choice >= 1 && zone_choice <= ${#zone_rows[@]} )); then
    break
  fi
  warn "Enter one of the numbers shown above."
done

IFS=$'\t' read -r zone_id zone_name <<<"${zone_rows[$((zone_choice - 1))]}"
success "Selected ${zone_name}"

valid_label() {
  [[ $1 =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}

read -r -p "Dashboard subdomain [deploy]: " management_label
management_label=${management_label:-deploy}
management_label=${management_label,,}
valid_label "${management_label}" || fail "The dashboard subdomain is invalid."

read -r -p "Application namespace [apps]: " apps_label
apps_label=${apps_label:-apps}
apps_label=${apps_label,,}
valid_label "${apps_label}" || fail "The application namespace is invalid."

management_host="${management_label}.${zone_name}"
apps_base_domain="${apps_label}.${zone_name}"

valid_ipv4() {
  local address=$1
  local first second third fourth
  IFS=. read -r first second third fourth <<<"${address}"
  for octet in "${first:-}" "${second:-}" "${third:-}" "${fourth:-}"; do
    [[ ${octet} =~ ^[0-9]{1,3}$ ]] || return 1
    (( 10#${octet} <= 255 )) || return 1
  done
}

detected_ipv4=$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
if ! valid_ipv4 "${detected_ipv4}"; then
  detected_ipv4=''
fi
read -r -p "Server public IPv4${detected_ipv4:+ [${detected_ipv4}]}: " server_ipv4
server_ipv4=${server_ipv4:-${detected_ipv4}}
valid_ipv4 "${server_ipv4}" || fail "A valid public IPv4 address is required."

account_email=''
while [[ ${account_email} != *@*.* ]]; do
  read -r -p "Email for certificate expiry notices: " account_email
  if [[ ${account_email} != *@*.* ]]; then
    warn "Enter a valid email address."
  fi
done

printf '\n%b\n' "${bold}Installation summary${reset}"
printf '  Dashboard:     https://%s\n' "${management_host}"
printf '  Applications:  https://<name>.%s\n' "${apps_base_domain}"
printf '  Server IPv4:   %s\n' "${server_ipv4}"
printf '  Cloudflare:    %s\n\n' "${zone_name}"
read -r -p "Continue? [Y/n]: " confirmation
if [[ ${confirmation:-y} =~ ^[Nn] ]]; then
  fail "Installation cancelled."
fi

info "Inspecting Node.js, Docker, Nginx, and Certbot"
missing_packages=()
command -v gpg >/dev/null 2>&1 || missing_packages+=(gnupg)
command -v docker >/dev/null 2>&1 || missing_packages+=(docker.io)
command -v nginx >/dev/null 2>&1 || missing_packages+=(nginx)
command -v htpasswd >/dev/null 2>&1 || missing_packages+=(apache2-utils)
command -v certbot >/dev/null 2>&1 || missing_packages+=(certbot)
if ! dpkg-query -W -f='${Status}' python3-certbot-dns-cloudflare 2>/dev/null | grep -q 'install ok installed'; then
  missing_packages+=(python3-certbot-dns-cloudflare)
fi
if (( ${#missing_packages[@]} > 0 )); then
  info "Installing missing prerequisites: ${missing_packages[*]}"
  refresh_apt_index
  apt-get install -y "${missing_packages[@]}"
else
  success "Docker, Nginx, Certbot, and the Cloudflare DNS plugin are already installed"
fi

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
fi
if (( node_major < 22 )); then
  info "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "${bootstrap_temp}/nodesource_setup.sh"
  bash "${bootstrap_temp}/nodesource_setup.sh"
  apt-get install -y nodejs
else
  success "Node.js $(node --version) is already available"
fi

systemctl enable --now docker nginx

if [[ ! -f ${source_root}/apps/server/dist/index.js || ! -f ${source_root}/apps/dashboard/dist/index.html ]]; then
  info "Building DeployThisShit"
  (
    cd "${source_root}"
    npm ci
    npm run build
  )
fi

info "Installing the deployment agent"
DTS_BOOTSTRAP_MODE=1 "${source_root}/scripts/install-server.sh" "${management_host}"

environment_file=/etc/deploythisshit/server.env
upsert_environment() {
  local key=$1
  local value=$2
  local next_environment
  next_environment=$(mktemp "${bootstrap_temp}/environment.XXXXXX")
  grep -Ev "^${key}=" "${environment_file}" > "${next_environment}" || true
  printf '%s=%s\n' "${key}" "${value}" >> "${next_environment}"
  install -m 0600 "${next_environment}" "${environment_file}"
}

upsert_environment DTS_PUBLIC_URL "https://${management_host}"

info "Requesting the dashboard and wildcard certificates"
CLOUDFLARE_API_TOKEN="${cloudflare_token}" DTS_BOOTSTRAP_MODE=1 \
  "${source_root}/scripts/configure-wildcard-tls.sh" \
  "${management_host}" \
  "${apps_base_domain}" \
  "${account_email}"

admin_token=$(sed -n 's/^DTS_ADMIN_TOKEN=//p' "${environment_file}")
[[ -n ${admin_token} ]] || fail "The installation did not produce a dashboard admin token."
cloudflare_config_body=$(jq -cn \
  --arg token "${cloudflare_token}" \
  --arg zoneId "${zone_id}" \
  --arg serverIpv4 "${server_ipv4}" \
  '{token:$token, zoneId:$zoneId, serverIpv4:$serverIpv4}')

info "Saving the verified Cloudflare configuration"
cloudflare_ready=false
for _attempt in {1..20}; do
  if configure_response=$(curl -fsS \
    -X PUT \
    -H "Authorization: Bearer ${admin_token}" \
    -H 'Content-Type: application/json' \
    --data "${cloudflare_config_body}" \
    http://127.0.0.1:8787/api/v1/settings/cloudflare 2>/dev/null); then
    if jq -e '.configured == true' >/dev/null <<<"${configure_response}"; then
      cloudflare_ready=true
      break
    fi
  fi
  sleep 1
done
if [[ ${cloudflare_ready} != true ]]; then
  fail "The agent could not store the Cloudflare configuration. Check: journalctl -u deploythisshit"
fi

info "Creating the dashboard DNS record"
records_response=$(cloudflare_get "/zones/${zone_id}/dns_records?type=A&name=${management_host}" 2>/dev/null) \
  || fail "The token cannot read DNS records. Check its Zone → DNS → Edit permission."
existing_record_id=$(jq -r '.result[0].id // empty' <<<"${records_response}")
existing_record_content=$(jq -r '.result[0].content // empty' <<<"${records_response}")
existing_record_comment=$(jq -r '.result[0].comment // empty' <<<"${records_response}")
record_comment='managed-by=deploythisshit role=dashboard'
record_body=$(jq -cn \
  --arg name "${management_host}" \
  --arg content "${server_ipv4}" \
  --arg comment "${record_comment}" \
  '{type:"A", name:$name, content:$content, ttl:1, proxied:false, comment:$comment}')

if [[ -n ${existing_record_id} ]]; then
  if [[ ${existing_record_comment} != "${record_comment}" ]]; then
    warn "${management_host} already exists and is not marked as owned by DeployThisShit."
    printf '  Current address: %s\n' "${existing_record_content}"
    read -r -p "Replace this existing record? [y/N]: " replace_record
    [[ ${replace_record:-n} =~ ^[Yy] ]] || fail "DNS record was not changed. Installation stopped."
  fi
  record_response=$(cloudflare_write PUT "/zones/${zone_id}/dns_records/${existing_record_id}" "${record_body}" 2>/dev/null) \
    || fail "Cloudflare refused to update ${management_host}."
else
  record_response=$(cloudflare_write POST "/zones/${zone_id}/dns_records" "${record_body}" 2>/dev/null) \
    || fail "Cloudflare refused to create ${management_host}."
fi
if ! jq -e '.success == true' >/dev/null <<<"${record_response}"; then
  fail "Cloudflare returned an error while configuring ${management_host}."
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  success "The active firewall allows SSH, HTTP, and HTTPS"
else
  warn "The firewall is not active. Only ports 22, 80, and 443 should be public."
fi

printf '\n%b\n' "${green}${bold}DeployThisShit is ready.${reset}"
printf '\nDashboard: %bhttps://%s%b\n' "${bold}" "${management_host}" "${reset}"
printf 'Admin token: %b%s%b\n' "${bold}" "${admin_token}" "${reset}"
printf 'Application domains: %b<name>.%s%b\n\n' "${bold}" "${apps_base_domain}" "${reset}"
printf '%s\n' "Save the admin token in a password manager. It is also stored in ${environment_file}."
printf '%s\n' "DNS records use DNS-only mode so traffic reaches the server's Certbot certificate directly."
printf '%s\n' "Next: open the dashboard, then pair a developer machine with 'deploythisshit init'."
printf 'Source and updates: %s\n' "${project_repository}"

exit 0
