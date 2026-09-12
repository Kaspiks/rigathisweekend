# Rīga Weekend

An isolated Docker stack that turns researched Riga events into Instagram carousels, Stories and a WhatsApp roundup. It supports your existing ChatGPT scheduled task through MCP, or an optional OpenAI API research worker on your VPS.

**Current state:** working application and integration adapters, authenticated review dashboard, persistent delivery queue, Docker deployment and automated tests. Live accounts are not connected. Publishing and paid research are disabled by default. Demo events are fictional and cannot be approved.

## Run with Docker

Docker with Compose is the only host dependency. You do not need Node, npm, Postgres or Redis installed on your machine.

```sh
sh scripts/bootstrap.sh
docker compose build
docker compose up -d app worker
docker compose run --rm app node src/cli.js demo
```

Open http://localhost:3100. Username: `admin`. Password: the generated `ADMIN_TOKEN` in your private `.env`. The setup script never prints secrets and never overwrites an existing `.env`.

Start the complete stack, including WhatsApp:

```sh
docker compose --profile whatsapp up -d
```

Postiz is at http://localhost:4007. WAHA is at http://localhost:3001. Service ports bind only to localhost. Postgres, Redis, Temporal and Elasticsearch have no published host ports.

```sh
# Tests run in a container with no external network, credentials or data volumes.
docker compose --profile test build test
docker compose --profile test run --rm test

# Logs / status / stop (keeps all persistent data)
docker compose ps
docker compose logs --tail=100 app worker
docker compose --profile whatsapp --profile production down
```

Never add `--volumes` to `down` unless you intend to delete databases, uploaded media and WhatsApp sessions.

## Isolation

- Application code and npm dependencies are baked into images. Runtime containers do not mount the project, home directory or Docker socket.
- App and worker run as a non-root user, with read-only root filesystems, dropped capabilities and `no-new-privileges`.
- Persistent data lives in project-scoped Docker named volumes. Temporary files use container tmpfs.
- The only runtime host-file mounts are read-only Caddy and Temporal configuration files.
- The one-shot bootstrap container mounts this project to write `.env`; it has no network access. Secrets stay out of Git and Docker build context.
- The stack uses its own Compose network. The worker needs outbound HTTPS for OpenAI, Postiz providers and WhatsApp. Containers are isolation, not a separate physical machine; Docker Desktop still consumes host RAM and disk.

## What runs

```mermaid
flowchart TD
  C[ChatGPT scheduled task] -->|MCP: verified event JSON| A[Riga application]
  W[Optional Thursday API research] --> A
  A --> R[Review dashboard + JPEG generation]
  R --> Q[Approved durable queue]
  Q --> P[Self-hosted Postiz]
  P --> I[Instagram carousel + Stories]
  Q --> H[WAHA]
  H --> G[WhatsApp group]
```

Postiz runs with its own PostgreSQL, Redis and Temporal services. Temporal uses a separate PostgreSQL and Elasticsearch, based on the official Postiz Compose architecture. The application uses SQLite in its own persistent volume. Run exactly **one worker replica**.

The default content language is English, preserving Latvian event names. The weekend is Friday–Sunday in `Europe/Riga`. The carousel and WhatsApp digest are queued for Friday 09:00. Each Story is queued for 09:00 on its event day. If approved later, a due job becomes eligible immediately. Editions with events that already started cannot be approved; stale jobs are blocked rather than publishing outdated events.

## Connect Instagram / Postiz

1. Start Postiz and its dependencies with `docker compose up -d postiz`.
2. Temporarily set `DISABLE_REGISTRATION=false`, recreate Postiz, create your account, then set it back to `true` and recreate again. Do this over localhost/SSH before exposing it publicly.
3. Follow [Postiz's Instagram setup](https://docs.postiz.com/self-host/providers/instagram). Use a professional Instagram account and your own Meta developer app. Configure `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` for standalone login, or the Facebook credentials for the Facebook-linked flow. Permissions and any Meta review requirements depend on your app/account configuration.
4. Set the HTTPS Postiz URL and its matching OAuth redirect URI. The standalone redirect is `https://YOUR-POSTIZ-DOMAIN/integrations/social/instagram-standalone`.
5. Connect the Instagram account in Postiz. Copy the Postiz public API key from Settings → Developers into `POSTIZ_API_KEY`.
6. Get your integration ID from the authenticated dashboard endpoint `/api/integrations`, and set `INSTAGRAM_INTEGRATION_ID`. Set `INSTAGRAM_PROVIDER=instagram-standalone` or `instagram` to match the connection.
7. Recreate app/worker after changing `.env`: `docker compose up -d app worker`.

The adapter uploads real JPEGs to Postiz and uses its public API to publish jobs when they become due. A `sent` Instagram job means **Postiz accepted the post**, not that Instagram independently confirmed publication. Check Postiz for downstream errors. Story link stickers are not supported by Postiz's API integration.

## Connect WhatsApp

The first version targets a **WhatsApp group**, using WAHA. Create a group and, if you want announcements only, configure only admins to send messages. Add the account you will pair with WAHA.

1. Run `docker compose --profile whatsapp up -d waha`.
2. Open http://localhost:3001 and authenticate using `admin` and `WAHA_DASHBOARD_PASSWORD`. API calls use `WAHA_API_KEY`.
3. Start the `default` session in WAHA and scan the QR code with WhatsApp → Linked devices.
4. Use WAHA's dashboard/API to list groups and copy the intended group ID, ending in `@g.us`, into `WAHA_CHAT_ID`.
5. Recreate app and worker.

The same adapter accepts a channel ID ending in `@newsletter`, but channel support depends on the chosen WAHA engine/version. Group delivery is the initial path to validate. WAHA is an unofficial WhatsApp integration: sessions can disconnect and account restrictions are possible. No WhatsApp account is paired automatically. Use a dedicated project account where practical.

WAHA's image is configurable. Before a production rollout, pin `WAHA_IMAGE` to the digest of the version you tested; its initial tag is floating. Its current image is x86-only, so Compose explicitly requests `linux/amd64`. Docker Desktop uses emulation on an ARM Mac; it runs natively on an x86 Hetzner VPS.

## Research: choose one owner

**Existing ChatGPT task:** follow [the MCP instructions](docs/chatgpt-task.md). The custom server exposes `submit_weekend_events`, `list_weekend_editions`, and `approve_weekend_edition`. It uses Streamable HTTP with bearer authentication. ChatGPT custom-app availability/authentication and unattended approval behavior need testing in your account. OAuth is not implemented by this server.

**VPS scheduler:** set `OPENAI_API_KEY`, an available web-search-capable `OPENAI_MODEL`, and `RESEARCH_SCHEDULE_ENABLED=true`. Research runs Thursday at 18:00 Riga time, with Friday-before-09:00 catch-up. This incurs separate OpenAI API charges. It stores consulted source URLs and the response ID. Returned event sources must occur in the web-search evidence; this is a provenance check, not a guarantee of factual correctness. Review actual listings before publication.

Run research manually inside Docker:

```sh
docker compose run --rm app node src/cli.js research
# Or supply a particular Friday:
docker compose run --rm app node src/cli.js research 2026-09-18
```

Research failures are visible in the dashboard and worker logs. Failed scheduled runs do not retry automatically, avoiding an unexpected loop of paid calls. Use the dashboard's research button or CLI to rerun. Choose either ChatGPT or the API scheduler to avoid duplicate research. Incoming submissions are deduplicated by content; only one real edition per weekend can be approved.

## Review and enable delivery

Import events, or run research, then review the images, dates, venues, prices and linked sources. Approval queues the edition. `LIVE_PUBLISH=false` means no external delivery occurs even for approved editions.

After connecting and testing your accounts, set `LIVE_PUBLISH=true` and recreate the app/worker. Previously approved queued editions can then send if their events are still in the future. Enable only when those queued items are intended for publication.

For fully automatic VPS research and delivery, also set `AUTO_APPROVE=true`. For ChatGPT-owned research, approval is instead controlled by the task's saved instructions/MCP calls. `AUTO_APPROVE` does not approve arbitrary MCP imports.

Jobs are claimed atomically. Timeouts and interrupted delivery become `uncertain`, and are **not** automatically retried: the provider may have accepted the request. Check the provider, then choose “Confirm already sent” or “Retry after checking provider” in the dashboard. Fix configuration first for `blocked` jobs. There is no promise of exactly-once delivery across an external API; the ledger prevents ordinary repeats and makes ambiguous outcomes explicit.

## Import schema

```json
{
  "weekend": "2026-09-18",
  "events": [
    {
      "title": "Replace with a verified real event",
      "startsAt": "2026-09-19T18:00:00+03:00",
      "venue": "Verified Riga venue",
      "price": "Price not confirmed",
      "summary": "A short description grounded in the organiser's listing.",
      "sourceUrl": "https://example.com/replace-with-real-source"
    }
  ]
}
```

The example is schema documentation, not a real listing. Submit through MCP, the dashboard JSON importer, or authenticated `POST /api/editions`. Imports retain supplied sources but do not independently browse them. Review provides the factual check. Edit unapproved content by submitting an updated edition. Editing/replacing an already approved edition is not supported in this version.

## Deploy to a VPS

Start with x86 Ubuntu/Debian, 4 vCPU, 8 GB RAM, 80 GB disk. Keep several GB free for images, database growth and updates. No GPU is needed.

1. Install Docker Engine and the Compose plugin on the VPS.
2. Clone this repository, run `sh scripts/bootstrap.sh`, and edit the private `.env` on the server.
3. Point two DNS names at the VPS. Set `APP_DOMAIN`, `POSTIZ_DOMAIN`, `APP_ORIGIN=https://YOUR-APP-DOMAIN` and `POSTIZ_PUBLIC_URL=https://YOUR-POSTIZ-DOMAIN`.
4. Allow SSH and inbound 80/443. Leave database/admin ports unexposed. WAHA stays accessible through an SSH tunnel: `ssh -L 3001:127.0.0.1:3001 user@server`.
5. Run `docker compose --profile whatsapp --profile production up -d --build`. Caddy obtains HTTPS certificates.
6. Pair WhatsApp and configure Meta/Postiz accounts. Verify a real draft/review cycle before enabling delivery.

Back up the named volumes and keep an encrypted copy of `.env` outside the VPS. For a simple consistent backup, stop the stack before taking the VPS/disk snapshot, then start it again. Test restoration before relying on backups. Do not change PostgreSQL passwords in `.env` after initialization without also changing the database roles.

The repository is local and independent. No GitHub remote, VPS provisioning, paid infrastructure, ChatGPT task modification or live publication is performed by initialization.

## Verification

Automated tests cover Riga weekend boundaries, daylight saving changes, source provenance rejection, real image dimensions, duplicate approvals, atomic job claims, interrupted-send handling, Postiz/WAHA payloads, preview-mode behavior, authentication and real MCP protocol discovery/submission.

Live OAuth, OpenAI research, WhatsApp pairing and successful Instagram publication require your accounts and credentials and are not covered by the mocked provider tests.

## References

- [Postiz system requirements](https://docs.postiz.com/self-host/installation/system-requirements)
- [Official Postiz Compose](https://github.com/gitroomhq/postiz-docker-compose)
- [Postiz public API](https://docs.postiz.com/public-api/introduction)
- [OpenAI Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [WAHA sending messages](https://waha.devlike.pro/docs/how-to/send-messages/)
