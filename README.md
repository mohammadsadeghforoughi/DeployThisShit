# DeployThisShit

Ship a local project to your own Ubuntu server with one command.

DeployThisShit is a self-hosted deployment control plane made of three pieces:

- an npm CLI that builds a Docker image locally and uploads it over HTTPS;
- an Ubuntu agent that verifies the image, starts a candidate container, checks health, changes DNS, and switches Nginx only after the candidate is healthy;
- a responsive dashboard for sites, domains, paired devices, HTTP Basic Auth, Cloudflare, server health, stop/start, and rollback.

The CLI can ask an already-authenticated Codex or Claude terminal client to prepare a Dockerfile. It never asks for or stores an AI API key. The AI only proposes a constrained deployment plan; the deterministic deployment engine performs the release.

## What works now

- `npx deploythisshit init` pairing with dashboard approval and revocable device tokens.
- Existing Dockerfiles, deterministic Node/Python/static fallbacks, and optional local Codex or Claude planning.
- Local Docker build and architecture targeting.
- Resumable, authenticated HTTP uploads with final SHA-256 verification.
- Candidate container startup, health check, Cloudflare DNS reconciliation, Nginx activation, and preservation of the previous healthy release.
- Shared wildcard TLS, site start/stop/rollback, and per-site HTTP Basic Auth.
- Encrypted Cloudflare credentials at rest with an installation-specific AES-256-GCM master key.
- A single-owner operations dashboard that works on desktop and mobile.

The current release intentionally targets one Ubuntu server, one owner, one HTTP container per app, and single-label hostnames under one wildcard domain. Databases, persistent volumes, teams, multiple replicas, and arbitrary custom-domain certificates are later work.

## Architecture

```text
developer project
      │
      │ Docker build + docker save
      ▼
DeployThisShit CLI ── authenticated HTTPS chunks ──► Ubuntu agent
      │                                                   │
      │ local Codex/Claude login only                     ├─ Docker
      │                                                   ├─ health gate
      └─ prints live URL                                  ├─ Cloudflare DNS
                                                          └─ Nginx + TLS
                                                                  │
                                                                  ▼
                                                          public application
```

The agent has no arbitrary-shell API. Device tokens can deploy; administrator-only actions such as device revocation, credentials, stop/start, rollback, and Basic Auth remain in the dashboard. See [the architecture notes](docs/architecture.md) for the trust boundaries and release state machine.

## Develop locally

Requirements: Node.js 22+, npm, and Docker.

```bash
npm ci
npm run build

DTS_ADMIN_TOKEN=local-admin-token \
DTS_MASTER_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY= \
npm start
```

The agent starts in `mock` mode at `http://127.0.0.1:8787`. In another terminal:

```bash
npm exec --workspace deploythisshit -- deploythisshit init \
  --server http://127.0.0.1:8787 \
  --ai none \
  --admin-token local-admin-token

cd /path/to/a/project
/path/to/DeployThisShit/packages/cli/dist/index.js deploy \
  --domain example.test \
  --port 3000
```

`--admin-token` is a development shortcut. Normal devices display a short pairing code and wait for approval in the dashboard.

## Install the Ubuntu agent

The server installer supports Ubuntu 22.04 or 24.04 and expects Node.js 22+ to already be installed. Before running it:

1. Point a management hostname such as `deploy.example.com` at the server.
2. Choose an application base such as `apps.example.com`; deployed sites will be `name.apps.example.com`.
3. Build the checkout as your normal user.

```bash
npm ci
npm run build
sudo ./scripts/install-server.sh deploy.example.com
sudo ./scripts/configure-wildcard-tls.sh \
  deploy.example.com \
  apps.example.com \
  you@example.com
```

The installer adds Docker, Nginx, Certbot's Cloudflare DNS plugin, a hardened systemd service, and a loopback-only agent. The TLS step requests a certificate for the dashboard hostname and `*.apps.example.com`, installs an automatic Nginx reload hook, and makes the agent reject domains the certificate does not cover.

Read the dashboard token on the server when you first sign in:

```bash
sudo sed -n 's/^DTS_ADMIN_TOKEN=//p' /etc/deploythisshit/server.env
```

Then open `https://deploy.example.com`, configure Cloudflare in Settings, and supply a scoped token with Zone Read and DNS Edit for only the deployment zone. The Certbot token is stored separately from the runtime DNS token.

## Install and use the CLI

The packages are ready to publish (`@deploythisshit/shared` first, then `deploythisshit`); after they are published, the user flow is:

```bash
npx deploythisshit@latest init --server https://deploy.example.com

cd my-project
npx deploythisshit@latest deploy --domain my-project.apps.example.com
```

During `init`, choose `codex`, `claude`, or `none`. Codex and Claude use their existing terminal login. No AI credential crosses the agent connection. If the project already has a Dockerfile, the AI adapter is skipped.

The package also exposes the requested launchers after installation:

```bash
DeployThisShit
dts apps
dts doctor
```

Until the package is published, install this checkout locally with `npm install -g ./packages/cli` after `npm run build`.

## Deployment lifecycle

1. Detect or generate a Dockerfile without reading common secret files.
2. Build locally for the server architecture and save an image archive.
3. Upload in authenticated chunks and verify the declared SHA-256 on the server.
4. Load and start a locked-down candidate container on a loopback port.
5. Wait for the configured HTTP health path.
6. Reconcile only a DNS record already owned by DeployThisShit, or create it.
7. Atomically write and validate the Nginx route, then mark the release live.
8. Stop the previous container but retain it for rollback.

A failed candidate is stopped and never replaces the last healthy release.

## Commands

```text
deploythisshit init       Pair this device and select Codex, Claude, or no AI
deploythisshit deploy     Build, upload, activate, and print the URL
dts apps                  List applications on the paired server
dts doctor                Check the server, Docker, and selected AI client
```

Run `npm test` for the compiled unit suite and `npm run typecheck` for all workspaces.

## Security model

- All production CLI traffic terminates at Nginx over HTTPS; the Node agent binds only to `127.0.0.1`.
- Admin and device authentication use bearer tokens. Only token hashes are stored for devices.
- Cloudflare secrets are encrypted before SQLite persistence.
- Upload size, offsets, digest, app identifiers, domains, ports, health paths, image tags, and Basic Auth usernames are validated.
- The production driver does not accept commands from clients. Its fixed operations are Docker load/run/start/stop, Nginx config/reload, `htpasswd`, and Cloudflare DNS requests.
- Containers drop all Linux capabilities, enable `no-new-privileges`, publish only on loopback, and receive no Docker socket.

This is an initial working control plane, not a claim of audited multi-tenant isolation. Put the dashboard behind a private network or Cloudflare Access if the server has multiple untrusted administrators.
