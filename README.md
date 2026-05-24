# LMStudio Proxy (Docker)

A Dockerized proxy that sits between AI coding assistants (Cline, KiloCode, Roo-Code) and [LM Studio](https://lmstudio.ai/), fixing vision-model image encoding errors automatically.

> **Fork of** [amitrathiesh/lmstudio-proxy](https://github.com/amitrathiesh/lmstudio-proxy) — rebuilt as a standalone Docker container with configurable ports, a web admin UI, and auto-restart.

## The problem

When Cline and similar tools send screenshots to LM Studio, you often get:

> **`[Server Error] 'url' field must be a base64 encoded image`**

Three root causes:

| Issue | What tools send | What LM Studio expects |
|-------|-----------------|------------------------|
| **File paths** | `/tmp/screenshot.png` | `data:image/png;base64,...` |
| **WebP format** | `data:image/webp;base64,...` | PNG or JPEG data URIs |
| **Malformed structure** | `"image_url": "data:..."` (string) | `"image_url": { "url": "data:..." }` |

This proxy intercepts `/v1/chat/completions` requests, transforms images in-place, and forwards the corrected payload to LM Studio.

## Quick start

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose)

```bash
git clone https://github.com/Dri-water/lmstudio-proxy.git
cd lmstudio-proxy
docker compose up -d --build
```

The container starts automatically and restarts if it crashes or when Docker starts (`restart: unless-stopped`).

| Service | Default URL |
|---------|-------------|
| **Proxy** — point Cline/KiloCode here | `http://localhost:1235` |
| **Admin UI** — change settings in browser | `http://localhost:8090` |
| **LM Studio** — unchanged | `http://localhost:1234` |

### Configure your AI assistant

Set the OpenAI-compatible **base URL** to the proxy, not LM Studio directly:

```
http://localhost:1235
```

LM Studio itself stays on port `1234`. The proxy listens on `1235` (LM Studio + 1) and forwards requests after fixing images.

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `1235` | Port the proxy listens on |
| `ADMIN_PORT` | `8090` | Port for the web admin UI |
| `LMSTUDIO_URL` | `http://host.docker.internal:1234` | LM Studio API endpoint |
| `DEBUG` | `false` | Verbose request logging |
| `CONFIG_DIR` | `/data` | Persistent config directory |

### Web admin UI

Open **http://localhost:8090** to change settings at runtime:

- **Proxy port** — where your AI tool connects
- **Target URL** — where requests are forwarded (default LM Studio on `:1234`)
- **Debug logging** — applied immediately without restart

Port changes require a container restart:

```bash
docker compose restart
```

Settings persist in the `proxy-data` Docker volume across restarts.

### Docker Compose example

```yaml
services:
  lmstudio-proxy:
    build: .
    ports:
      - "1235:1235"
      - "8090:8090"
    environment:
      PROXY_PORT: 1235
      ADMIN_PORT: 8090
      LMSTUDIO_URL: http://host.docker.internal:1234
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
```

On Linux, `host.docker.internal:host-gateway` lets the container reach LM Studio running on the host.

## Auto-start & keep-alive

The container uses `restart: unless-stopped` in `docker-compose.yml`:

- **Restarts on crash** — Docker brings the container back up automatically
- **Starts with Docker** — runs again when Docker Desktop/engine starts (unless you ran `docker compose down`)
- **Survives reboots** — as long as Docker is set to start on login

To stop permanently:

```bash
docker compose down
```

## Development

```bash
npm install
npm start          # run locally
npm run dev        # watch mode
npm test           # run tests
```

## Tests

Tests verify all three original bugs are fixed:

```bash
npm test
```

- **Bug 1**: Local file paths → base64 data URIs
- **Bug 2**: WebP data URIs → PNG
- **Bug 3**: String `image_url` → proper object structure
- **Integration**: End-to-end proxy forwarding with a mock LM Studio server

## Architecture

```
Cline / KiloCode
       │
       ▼  POST /v1/chat/completions
┌──────────────────┐     ┌─────────────┐
│  Proxy :1235     │────▶│  LM Studio  │
│  (image fix)     │     │  :1234      │
└──────────────────┘     └─────────────┘
       ▲
┌──────────────────┐
│  Admin UI :8090  │
└──────────────────┘
```

## Troubleshooting

**Proxy won't start — port in use**

```bash
# Use a different proxy port
PROXY_PORT=1236 docker compose up -d
```

**Images still failing**

1. Confirm your AI tool points to `http://localhost:1235`, not `:1234`
2. Enable debug logging in the admin UI or set `DEBUG=true`
3. Check logs: `docker compose logs -f`

**Can't reach LM Studio from container**

Ensure LM Studio is running on the host and `LMSTUDIO_URL` is set to `http://host.docker.internal:1234`.

## Credits

- Original VSCode extension: [amitrathiesh/lmstudio-proxy](https://github.com/amitrathiesh/lmstudio-proxy) by Amit Rathiesh
- Docker rewrite: [Dri-water/lmstudio-proxy](https://github.com/Dri-water/lmstudio-proxy)

## License

MIT — see [LICENSE](LICENSE)
