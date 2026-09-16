# deploythisshit

The local CLI for deploying a Dockerized project to a paired DeployThisShit Ubuntu agent.

```bash
npx deploythisshit init --server https://deploy.example.com
cd my-project
npx deploythisshit deploy --domain my-project.apps.example.com
```

At initialization, select `codex`, `claude`, or `none`. AI adapters invoke an existing local terminal login and never request an API key. An existing Dockerfile is always used directly.

See the [project README](../../README.md) for server installation, trust boundaries, and operations.
