# Architecture and release contract

## Components

| Component | Runs on | Responsibility |
| --- | --- | --- |
| npm CLI | developer machine | pairing, Dockerfile planning, Docker build, digest, resumable upload, status output |
| HTTP agent | Ubuntu server | authentication, state, upload verification, deployment orchestration, dashboard API |
| platform driver | Ubuntu server | constrained Docker and Nginx operations, health checks, Basic Auth |
| Cloudflare adapter | Ubuntu server | scoped DNS verification and owned-record reconciliation |
| dashboard | browser | administrator operations and visibility |

The HTTP agent and dashboard are one origin. Nginx owns public TLS and proxies to the agent on loopback. Applications run on separate loopback ports and receive their own generated Nginx virtual host.

## Release state machine

```text
uploaded → loading → starting → checking → routing → live
     │         │          │          │          │
     └─────────┴──────────┴──────────┴──────────┴──→ failed

previous live ── successful switch ──→ superseded, stopped, rollback-ready
```

The active route changes only after the candidate answers its HTTP health check. If any prior step fails, the candidate is stopped, the deployment is marked failed, and an existing live app remains live.

## Authentication

- `DTS_ADMIN_TOKEN` is the single-owner dashboard secret and is provided through the systemd environment file.
- A pairing request contains a short display code and a separate high-entropy polling secret.
- Approval mints a high-entropy device token. SQLite stores its SHA-256 hash, not the token.
- Device tokens can create apps, upload images, and inspect their deployments.
- Admin-only routes approve or revoke devices, change server credentials, operate existing apps, and configure Basic Auth.

## Image transport

The CLI runs `docker build` and `docker save`; the server never receives source code. It creates an upload record with a fixed expected length and SHA-256, accepts ordered chunks with explicit offsets, and rejects overflow or offset mismatch. Finalization hashes the completed archive before a deployment can start.

The current transport is HTTP semantics over production HTTPS. Direct unencrypted public access is unsupported.

## DNS ownership

The Cloudflare adapter searches for the exact A record. It creates a missing record with a `managed-by=deploythisshit app=<id>` comment. It refuses to replace a record whose ownership comment does not match, preventing accidental takeover of an unrelated hostname.

## TLS model

The first release uses one Certbot-managed wildcard certificate for a configured application base domain. `DTS_TLS_DOMAIN_SUFFIX` makes the API accept exactly one application label below that base. This deliberately trades custom-domain flexibility for predictable HTTPS on every reported live URL.

## Persistent state

SQLite under `/var/lib/deploythisshit` stores apps, deployments, uploads, devices, settings, and audit events. Cloudflare tokens are sealed using AES-256-GCM with `DTS_MASTER_KEY`. Uploaded archives are deleted after a successful release; Docker retains rollback containers.

Back up both the data directory and `/etc/deploythisshit/server.env`. Neither backup is sufficient to decrypt Cloudflare credentials without the other.

## Deliberate non-goals for v0.1

- databases and managed persistent volumes;
- secrets injection into application containers;
- multi-owner authorization or teams;
- multi-server scheduling and replicas;
- registry-backed builds;
- arbitrary commands or lifecycle hooks;
- arbitrary custom domains outside the configured wildcard certificate.
