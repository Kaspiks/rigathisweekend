# Go-live checklist

Everything below the "You" marker needs your accounts, phone or browser session and cannot be automated. Commands run from this project on your Mac unless noted. `scripts/remote.sh` reads `VPS_HOST` from `.env.deploy` (copy `.env.deploy.example`).

## 1. Server (about 20 minutes)

- [ ] **You:** create a Hetzner x86 server (CX32 or CPX31: 4 vCPU, 8 GB, Ubuntu 24.04) with your SSH key.
- [ ] **You:** add DNS A records `events.YOURDOMAIN` and `social.YOURDOMAIN` → server IP.
- [ ] Provision: `ssh root@SERVER-IP 'sh -s' < deploy/vps-provision.sh`
- [ ] Deploy: `scripts/remote.sh deploy`
- [ ] Configure: `scripts/remote.sh env` and set `APP_DOMAIN`, `POSTIZ_DOMAIN`, `APP_ORIGIN=https://events.YOURDOMAIN`, `POSTIZ_PUBLIC_URL=https://social.YOURDOMAIN`. Then `scripts/remote.sh deploy` again so Caddy picks up the domains.
- [ ] Verify `https://events.YOURDOMAIN` shows the login prompt (username `admin`, password = server `ADMIN_TOKEN`) and `https://social.YOURDOMAIN` shows Postiz.

## 2. Instagram (Meta review can take days; start early)

- [ ] **You:** switch the Instagram account to Professional (Settings → Account type).
- [ ] **You:** at developers.facebook.com create an app, add the *Instagram* product, and in *API setup with Instagram login* add the account as a tester and set the OAuth redirect URI to `https://social.YOURDOMAIN/integrations/social/instagram-standalone`.
- [ ] `scripts/remote.sh env`: set `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` (standalone) or the Facebook pair if you link through a Page.
- [ ] `scripts/remote.sh registration open` → **You:** create the Postiz admin account at `https://social.YOURDOMAIN` → `scripts/remote.sh registration close`.
- [ ] **You:** in Postiz add the Instagram channel and complete the Meta consent screen. Then Settings → Developers → copy the API key.
- [ ] `scripts/remote.sh env`: set `POSTIZ_API_KEY`. Then `scripts/remote.sh integrations` and copy the ID into `INSTAGRAM_INTEGRATION_ID`; set `INSTAGRAM_PROVIDER` to `instagram-standalone` or `instagram` to match.

## 3. WhatsApp

- [ ] **You:** decide the number. A dedicated SIM/eSIM limits the impact if WhatsApp restricts the unofficial client.
- [ ] **You:** create the group on that number; optionally restrict sending to admins.
- [ ] `scripts/remote.sh tunnel`, open http://localhost:3011 (user `admin`, password = server `WAHA_DASHBOARD_PASSWORD`), start the `default` session. **You:** scan the QR from WhatsApp → Linked devices.
- [ ] `scripts/remote.sh groups` and put the `…@g.us` ID into `WAHA_CHAT_ID` with `scripts/remote.sh env`.

## 4. Research owner: ChatGPT task (default) or VPS scheduler

- [ ] **You:** ChatGPT → Settings → Security and login → enable Developer mode. Then Plugins → Create app: MCP server URL `https://events.YOURDOMAIN/mcp`, authentication **OAuth**. ChatGPT opens a login page on your domain; enter the server `ADMIN_TOKEN` once.
- [ ] **You:** in a normal chat with the plugin enabled, ask for `list_weekend_editions`, then a small `submit_weekend_events`. Confirm the edition shows in the dashboard with rendered images.
- [ ] **You:** create the scheduled task with the prompt in [chatgpt-task.md](chatgpt-task.md) and the connector enabled. Check the next Thursday run actually reached the server (dashboard or `scripts/remote.sh logs`). Scheduled tasks calling custom connectors is the least certain part of this design; verify it once before relying on it.
- [ ] Fallback: `scripts/remote.sh env` with `OPENAI_API_KEY`, a Responses-API model that supports `web_search`, and `RESEARCH_SCHEDULE_ENABLED=true`. Never enable both.

## 5. Staged go-live

- [ ] `scripts/remote.sh check` reports `Configuration complete`.
- [ ] Preview cycle with `LIVE_PUBLISH=false`: submit a real edition for the coming weekend, review every event and image, approve. The Instagram items should appear as "Handing over to Postiz" and stay there while delivery is off. Once live, each carousel shows "Scheduled in Postiz" with its time and each ticked story shows "Draft in Postiz"; WhatsApp only moves when you press its button.
- [ ] `scripts/remote.sh env`: `LIVE_PUBLISH=true`. Watch the first Friday: `scripts/remote.sh logs`, the Postiz calendar, Instagram, and the WhatsApp group. Resolve any `uncertain` jobs in the dashboard after checking the provider.
- [ ] Only after a clean manual weekend, and only for the VPS scheduler path: `AUTO_APPROVE=true`. For the ChatGPT path, add the `approve_weekend_edition` call to the task prompt instead.

## 6. Keep it running

- [ ] Weekly `scripts/remote.sh backup`; keep an encrypted copy of the server `.env` off the VPS.
- [ ] Update: `scripts/remote.sh deploy` rebuilds the app; bump `POSTIZ_IMAGE`/`WAHA_IMAGE` deliberately, one at a time.
- [ ] Watch `free -h` on the server the first week; the stack should sit around 4–5 GB with swap as headroom.
