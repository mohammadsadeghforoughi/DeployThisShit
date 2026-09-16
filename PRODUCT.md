# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Inferred from the approved product plan: an npm-installed TypeScript CLI, a self-hosted server agent and HTTP API, and a responsive web dashboard. The implementation language and framework may evolve as long as installation stays simple on supported Ubuntu servers.

## Users

Primary users are independent developers and small product teams who build applications quickly with coding agents and want to publish them on infrastructure they control without becoming deployment specialists.

## Product Purpose

DeployThisShit turns a local project into a running HTTPS website on the user's own Ubuntu server. One command prepares a Docker build, sends the image to the server, starts it, configures routing and DNS, and returns the live URL.

Success means a developer can move from a working local project to a healthy public URL while still being able to understand, stop, restart, protect, and roll back what was deployed.

## Positioning

The product combines a local, subscription-authenticated coding-agent workflow with a self-hosted deployment control plane. AI may prepare deployment files, but the deployment engine remains deterministic, inspectable, and owned by the user.

## Operating Context

- A non-technical owner can bootstrap a fresh supported Ubuntu server by running one interactive installer.
- The installer validates a scoped Cloudflare API token, lists its accessible zones for selection, and installs missing system prerequisites.
- The developer works in a local project directory with Node.js and Docker available.
- The developer runs `npx deploythisshit` or the installed `DeployThisShit` launcher.
- A paired Ubuntu server runs the agent, Docker, Nginx, and the dashboard.
- Runtime communication and image uploads use authenticated HTTPS.
- Cloudflare manages application DNS records.
- Codex or Claude may be invoked through an already-authenticated local terminal CLI; DeployThisShit does not collect an AI API key.

## Capabilities and Constraints

- Initial release targets one owner and one Ubuntu server.
- It deploys one stateless HTTP container per application and routes one or more hostnames to it.
- The dashboard lists sites, domains, deployments, connected devices, and server status.
- Operators can start, stop, restart, roll back, and enable HTTP Basic Auth for a site.
- Cloudflare credentials remain on the server.
- Failed candidate releases must not replace the currently healthy release.
- The control API must not expose arbitrary shell execution.
- Inferred MVP constraint: server-side system integrations have an explicit mock mode for local development and a guarded system mode for Ubuntu production.
- Open decision: databases, persistent volumes, teams, multi-server scheduling, and multiple replicas are post-MVP.

## Brand Commitments

The product name and command are **DeployThisShit**. The voice is direct, candid, energetic, and technically precise. Irreverence can make routine infrastructure feel approachable, but operational warnings and destructive actions must remain unambiguous.

## Evidence on Hand

There are no customer claims, production benchmarks, testimonials, logos, or external brand assets yet. Future work must not fabricate them. Product demonstrations may use clearly labeled synthetic applications and deployment data.

## Product Principles

1. One guided server script and one developer deploy command, with visible consequences.
2. AI proposes; deterministic systems deploy.
3. The user's server and credentials remain theirs.
4. Failure preserves the last healthy release.
5. Powerful operations stay understandable and reversible.

## Accessibility & Inclusion

The web dashboard should meet WCAG 2.2 AA for its core workflows, support keyboard navigation, preserve visible focus, respect reduced motion, and never communicate deployment state through color alone.
