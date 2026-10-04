# AGENTS.md

Dockerized Node proxy between AI coding assistants (Cline, KiloCode, Roo-Code) and LM Studio. It intercepts `POST /v1/chat/completions`, fixes image payloads (file paths -> base64 data URIs, WebP -> PNG, string `image_url` -> `{ url }` object), and forwards everything else unchanged. Fork of amitrathiesh/lmstudio-proxy. User docs: [README.md](README.md).

## Layout

- `src/index.js` — entry; starts the proxy and admin servers
- `src/proxy-server.js` — forwarding (`http-proxy-middleware`), `/health`
- `src/image-processor.js` — the three image fixes (uses `sharp`)
- `src/host-paths.js` — maps host temp paths to container mounts when `DOCKER=true`
- `src/target-url.js` — rewrites `localhost`/`127.0.0.1` targets to `host.docker.internal` inside Docker
- `src/config.js` — config persisted to `$CONFIG_DIR/config.json` (default `/data`); env vars override saved values
- `src/admin-server.js` + `public/index.html` — web admin UI
- `tests/*.test.js` — `node:test` unit + integration tests (mock LM Studio)
- `scripts/e2e-test.mjs` — live E2E against real LM Studio
- `_reference/` — gitignored copy of the original VS Code extension; reference only, don't edit or import from it

## Commands

```bash
npm install            # deps: express, http-proxy-middleware, sharp (ESM, "type": "module")
npm start              # node src/index.js
npm run dev            # node --watch
npm test               # node --test tests/*.test.js — no network or LM Studio needed
npm run test:e2e       # needs LM Studio on :1234 with a vision model loaded, and the proxy on :1235
docker compose up -d --build   # the normal way to run it
docker compose logs -f
```

`test:e2e` honours `LMSTUDIO_URL`, `PROXY_URL`, `LMSTUDIO_MODEL`.

## Ports and env

| Var | Default | Notes |
|---|---|---|
| `PROXY_PORT` | `1235` | where assistants connect (LM Studio + 1) |
| `ADMIN_PORT` | `8090` | admin UI |
| `LMSTUDIO_URL` | `http://localhost:1234` | target; auto-rewritten inside Docker |
| `DEBUG` | `false` | verbose request logging |
| `CONFIG_DIR` | `/data` | when running locally outside Docker, set this to a writable dir (e.g. `./data`, gitignored) |
| `DOCKER`, `HOST_TEMP_MOUNT`, `CONTAINER_TEMP_MOUNT` | set in compose | enable host/devcontainer screenshot path mapping |

`docker-compose.yml` creates the named network `lmstudio-proxy` (for devcontainers) and mounts `$TEMP` read-only at `/host-temp` plus the `cline-screenshots` volume. Changing the network/volume names breaks the devcontainer setup in [devcontainer.example.json](devcontainer.example.json). Port 1235 conflicts on Windows (old VS Code extension, Dev Containers port forwards) are documented in the README troubleshooting section.

## Verification

- Run `npm test` after any change to `src/`; it covers all three image bugs plus proxy forwarding.
- Changes touching forwarding, Docker paths, or image conversion should also pass `npm run test:e2e` when LM Studio is available — say so explicitly if you could not run it.
- `.dockerignore` excludes `*.md`; the image only copies `package.json`, `src/`, `public/`. New runtime files outside those need a Dockerfile change.
