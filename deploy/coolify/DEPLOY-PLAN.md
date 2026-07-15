# Dograh → rejuto.motorbrain.net — Deploy Plan

Ordered, exact steps to deploy Dograh onto Coolify server `linode-us-lax1`. Every
step is written so a human or agent can run it. Nothing here has been executed —
this is the plan; artifacts in this directory are the inputs.

**Target**: Linode `motorbrain-us-lax` (instance id **81791567**, IP **172.235.57.223**, region us-lax, g6-dedicated-4), managed in Coolify (`coolify.motorbrain.net`, **v4.1.2**, server name `linode-us-lax1`, server uuid `fokoc4wwcw48os088k8gs0wc`).
**Public origin**: `https://rejuto.motorbrain.net`

**Artifacts in this directory:**
- `docker-compose.coolify.yaml` — validated compose (paste into the Coolify resource).
- `.env.dograh.example` — the actual env values (secrets pre-generated).
- `env-checklist.md` — what each env var is / where it points.
- `lax1-firewall-proposed.json` — proposed Linode Cloud Firewall rules (NOT applied).

Legend: **[DNS] / [FIREWALL] / [COOLIFY] / [VERIFY]**. Steps flagged **⚠ OUTWARD-FACING / HARD TO UNDO** mutate shared or public state.

## Pre-verified facts (read-only checks, re-verified 2026-07-13)

- Coolify server `linode-us-lax1` is managed and (per prior check) has zero resources.
- **Nothing listens on 80/443** on 172.235.57.223 → Coolify's Traefik proxy is not running on lax1 yet; must be started (step 3).
- Linode instance for this IP is labeled **`motorbrain-us-lax`** (id **81791567**), region us-lax. **Confirmed via Linode API 2026-07-13: it has ZERO Cloud Firewalls attached** — open at the cloud layer until step 2.
- Coolify control-plane / SSH source is the `motorbrain` linode = **45.79.140.76** (runs coolify.motorbrain.net). That IP MUST keep SSH (22) access to lax1.
- `motorbrain.net` DNS is on **Cloudflare** (we have NO Cloudflare token → DNS is an *instruction*, step 1). A **proxied wildcard `*.motorbrain.net`** already makes `rejuto.motorbrain.net` resolve to Cloudflare edge IPs — an explicit grey-cloud A record must override it.
- The api image auto-runs `alembic upgrade head` on boot (`scripts/start_services_docker.sh`) — no manual migration step.
- Compose validated: `docker-compose.coolify.yaml` removes upstream's `nginx`, `dograh-init`, and `cloudflared`; reproduces the three nginx routes as Traefik labels and the coturn config as CLI flags (both match `deploy/templates/*.template` 1:1). `FASTAPI_WORKERS=1` → single uvicorn on :8000, which is what Traefik routes to.

---

## 1. [DNS] Create the A record (Cloudflare) — ⚠ OUTWARD-FACING — MANUAL (no CF token)

We have no Cloudflare API token, so this is executed by a human in the Cloudflare dashboard. In zone `motorbrain.net`:

- Type **A**, name **rejuto**, content **172.235.57.223**.
- **Proxy status: DNS only (grey cloud) — REQUIRED, not optional.** Reasons:
  1. `TURN_HOST` derives from `PUBLIC_HOST`, so WebRTC clients dial `turn:rejuto.motorbrain.net:3478` over **UDP**. Cloudflare's HTTP proxy does not carry TURN/UDP — an orange-clouded record breaks every call.
  2. coturn's `external-ip` is the raw origin IP `172.235.57.223`; ICE candidates must reach that IP directly, not a Cloudflare edge.
  3. Grey cloud lets Traefik complete Let's Encrypt **HTTP-01** cleanly without Cloudflare SSL-mode interplay.
- TTL: Auto (or 300 while testing).

Notes: this explicit record overrides the proxied wildcard **for this name only**; it exposes the origin IP for `rejuto` (acceptable — internal codename, host firewalled in step 2). Reversible by deleting the record, but public caches hold it for the TTL. If someone later deletes it, `rejuto` silently falls back to the wildcard (a confusing failure mode).

**[VERIFY]** `dig +short A rejuto.motorbrain.net` returns exactly `172.235.57.223` (not 104.21.x / 172.67.x). Do not proceed until it does.

## 2. [FIREWALL] Linode Cloud Firewall for the host — ⚠ OUTWARD-FACING / LOCKOUT RISK

lax1 currently has **no** Cloud Firewall (verified). Create a NEW one from `lax1-firewall-proposed.json` and attach it to linode **81791567**. Do **not** reuse `motorbrain-fw` (2402152), `motorbrain-mssql-fw` (2409320), `coolify-build` (3024027), or `motorbrain-sentry-fw` (3857009).

**Before applying, edit `lax1-firewall-proposed.json`:** replace `ADMIN_IP_PLACEHOLDER/32` in the `ssh-admin` rule with your real admin IP(s). `45.79.140.76/32` (Coolify) is already present and is **mandatory**.

Proposed rules (inbound policy **DROP**, outbound **ACCEPT**). Linode rules take one protocol each, so TCP+UDP ports are two rules:

| Label | Proto | Ports | Sources |
|-------|-------|-------|---------|
| ssh-admin | TCP | 22 | 45.79.140.76/32 (Coolify — MANDATORY) + your admin IP(s) |
| http | TCP | 80 | 0.0.0.0/0, ::/0 (ACME HTTP-01 + redirect) |
| https | TCP | 443 | 0.0.0.0/0, ::/0 |
| turn-tcp | TCP | 3478 | 0.0.0.0/0, ::/0 |
| turn-udp | UDP | 3478 | 0.0.0.0/0, ::/0 |
| turn-tls-tcp | TCP | 5349 | 0.0.0.0/0, ::/0 |
| turn-tls-udp | UDP | 5349 | 0.0.0.0/0, ::/0 |
| turn-relay-udp | UDP | 49152-49200 | 0.0.0.0/0, ::/0 |

Apply (Linode API; token = `~/.config/linode-cli/config` `[reviewer]` `token`):

```bash
TOKEN=$(awk '/^\[reviewer\]/{f=1;next} /^\[/{f=0} f && /token/{print $3}' ~/.config/linode-cli/config)
# 1) Create the firewall from the artifact (already attaches nothing yet):
FW=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  https://api.linode.com/v4/networking/firewalls \
  -d @lax1-firewall-proposed.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "created firewall $FW"
# 2) Attach it to the lax linode:
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  https://api.linode.com/v4/networking/firewalls/$FW/devices \
  -d '{"type":"linode","id":81791567}'
```

(The `_comment`/`_*` keys in the JSON are ignored by Linode; strip them first if the API is strict — `python3 -c 'import json;d=json.load(open("lax1-firewall-proposed.json"));print(json.dumps({k:v for k,v in d.items() if not k.startswith("_")}))'`.)

⚠ **Lockout risk**: Coolify manages lax1 over SSH from 45.79.140.76. A default-DROP inbound policy without the `ssh-admin` rule severs Coolify's control. Double-check that rule before attaching.

**[VERIFY]** After attaching: Coolify → Servers → linode-us-lax1 → **Validate Server** still succeeds (SSH intact). If it fails, detach the firewall immediately via `DELETE /networking/firewalls/$FW/devices/<device_id>`.

## 3. [COOLIFY] Start Traefik on lax1 — ⚠ OUTWARD-FACING (binds :80/:443)

The Coolify API (v4.1.2) does not expose the proxy type (`GET /servers/{uuid}` returns only `proxy.redirect_enabled`), so confirm in the UI:

1. Coolify → **Servers → linode-us-lax1 → Proxy**.
2. If proxy type is **None** (or **Caddy**): switch to **Traefik** (safe — server is empty; nothing else owns 80/443). The compose labels only work with Traefik.
3. **Start** the proxy.

**[VERIFY]** `curl -s -o /dev/null -w '%{http_code}' http://172.235.57.223/` now returns `404` (Traefik no-router answer) instead of connection-refused.

## 4. [COOLIFY] Create the Compose resource

Token (never print it): `~/.td/config.json` path `coolify.instances.motorbrain.token`. UI is the reliable path for compose creation; API steps given where stable.

1. Coolify → **Projects** → create/reuse a project (e.g. `Rejuto`) → **+ New Resource → Docker Compose Empty** → server **linode-us-lax1** (uuid `fokoc4wwcw48os088k8gs0wc`).
2. Paste the full contents of **`docker-compose.coolify.yaml`**. Prebuilt images (`dograhai/dograh-api:latest`, `dograhai/dograh-ui:latest`) — no build step, no git repo hookup.
3. Resource **Settings** → enable **"Connect To Predefined Network"** (Traefik must share a Docker network with ui/api/minio; coturn is host-published and doesn't care).
4. **Leave every per-service Domains field EMPTY.** All HTTP routing is done by the explicit Traefik labels in the compose (`/api/v1`→api:8000, `/voice-audio`→minio:9000, `/`→ui:3010). Adding a UI domain would create a second conflicting router, and Coolify's path-domains can inject a `stripprefix` middleware that breaks the API (routes mounted at `/api/v1`) and MinIO (the path IS the bucket name).

## 5. [COOLIFY] Set environment variables

Environment Variables tab → **bulk edit** → paste `.env.dograh.example` (comments allowed). Cross-check against `env-checklist.md`. Before saving:

- Secrets in the file are real freshly-generated values — **rotate them** if that file ever left this machine.
- `POSTGRES_PASSWORD` is permanent after first boot (baked into the volume).
- `TURN_SECRET` must be identical for `api` and `coturn` (single var → fine).
- `FASTAPI_WORKERS=1` is intentional.
- **Optionally add** `UI_APP_URL=https://rejuto.motorbrain.net` (compose doesn't set it; default is `localhost:3010`). Needed only for correct workflow-embed and Stripe-billing links, not the core call flow — parity with upstream either way.
- Mark all six secret values with the lock icon so Coolify masks them.

## 6. [COOLIFY] Deploy — ⚠ FIRST-BOOT STATE CREATED

Hit **Deploy** (or `POST /api/v1/deploy?uuid=<resource_uuid>`). Watch logs in order:

1. `postgres` initializes its volume — the `POSTGRES_PASSWORD` bake-in happens here.
2. `api` waits for postgres/redis/minio health, runs `alembic upgrade head`, then starts `ari_manager`, `campaign_orchestrator`, one `uvicorn` on :8000, and the `arq` worker.
3. `ui` starts once api is healthy.
4. `coturn` starts immediately (no deps).
5. First HTTPS request triggers Traefik Let's Encrypt issuance for `rejuto.motorbrain.net` (needs step 1 DNS live + port 80 open from step 2).

⚠ After this step the postgres/minio volumes exist on lax1 with the step-5 credentials. A clean re-do requires deleting the resource **and its volumes** in Coolify.

## 7. [VERIFY] Post-deploy checklist

Run from your workstation unless noted.

1. **DNS**: `dig +short A rejuto.motorbrain.net` → `172.235.57.223`.
2. **TLS**: `curl -vI https://rejuto.motorbrain.net 2>&1 | grep -E 'subject|issuer|HTTP'` → Let's Encrypt cert for the host, HTTP/2 200 (or 307 to /login), no warning.
3. **HTTP→HTTPS**: `curl -sI http://rejuto.motorbrain.net | head -1` → 301/308.
4. **API health**: `curl -s https://rejuto.motorbrain.net/api/v1/health` → success JSON.
5. **UI**: browse `https://rejuto.motorbrain.net` — login renders; create the first user/org; log in.
6. **MinIO route**: `curl -s -o /dev/null -w '%{http_code}' https://rejuto.motorbrain.net/voice-audio/` → an S3-style XML / 200-403 from MinIO (NOT 404 from Traefik → confirms the unstripped `/voice-audio` route).
7. **TURN reachability**: `nc -u -z -w2 172.235.57.223 3478` (or `turnutils_uclient -y rejuto.motorbrain.net -p 3478`).
8. **WebRTC test call with TURN FORCED — the real proof:**
   1. Set `FORCE_TURN_RELAY=true` in Coolify env → redeploy (api restart suffices).
   2. In the Dograh UI create a trivial workflow → start a **web/WebRTC test call**. With relay forced, all media traverses coturn's relay ports (49152-49200/udp) — working two-way audio proves TURN + firewall + `external-ip` end-to-end.
   3. Keep the call live **> 2 minutes** to catch WSS idle-timeout issues on the signaling socket.
   4. Set `FORCE_TURN_RELAY=false` back → redeploy.
9. **Recording playback**: after the call, open its recording in the UI — the URL should be `https://rejuto.motorbrain.net/voice-audio/...` and must play (verifies `MINIO_PUBLIC_ENDPOINT` derivation + the `/voice-audio` route + arq post-call processing).
10. **Container health**: Coolify resource view — all services healthy; `docker ps` on lax1 shows no restart loops.

## Rollback

- **App**: Coolify → Stop resource. DNS can stay (dead origin) or be deleted.
- **Full teardown**: delete the Coolify resource + volumes; stop Traefik on lax1 if nothing else uses it; delete the Cloudflare A record; detach/delete the firewall (⚠ detaching removes all inbound filtering and reopens 22 to the world; the wildcard-proxied name stops routing here once the A record is gone).

---

## Open questions / risks (carried from analysis; unchanged, still valid)

1. **MinIO bucket is anonymous read/write/DELETE, publicly routed.** `api/services/filesystem/minio.py` sets an `AWS:*` policy allowing `s3:GetObject/PutObject/DeleteObject` on `voice-audio/*` every boot, and recording URLs are unsigned `PUBLIC_BASE_URL/voice-audio/<path>`. Anyone who guesses object paths can fetch/overwrite/delete recordings. This is **parity** with upstream's remote install (same nginx `/voice-audio/` exposure) — but for anything sensitive, fast-follow with `ENABLE_AWS_S3=true` + `S3_ENDPOINT_URL=http://minio:9000` (S3 backend issues real presigned URLs; bucket can be locked down) or an auth middleware on `/voice-audio`.
2. **`:latest` image drift**: `dograhai/dograh-api:latest` / `dograh-ui:latest` are moving targets. Consider pinning by digest after the first good deploy (`docker inspect --format '{{index .RepoDigests 0}}'`).
3. **FASTAPI_WORKERS=1**: image multi-worker mode expects nginx `least_conn` across consecutive ports; Traefik targets one port. Single worker + arq + orchestrators on 4 vCPU is fine initially. To scale: multiple api *replicas* (Traefik balances containers; mind WS stickiness + migration race) or reintroduce an internal nginx.
4. **TURN-TLS (5349) is non-functional** — no cert is provisioned for coturn (also true upstream). Clients use `turn:` on 3478 udp/tcp, which the API hands out in ICE config. Port stays open for parity; harmless.
5. **Traefik long-lived WSS**: verify step 7.8.3 (>2 min live call). If calls drop at a fixed interval, inspect the proxy's `respondingTimeouts` in Coolify's Traefik config.
6. **No SIP/telephony ports opened**: this deploy is web UI + WebRTC (browser) only. Telephony webhooks arrive over 443 and work as-is; raw SIP/RTP trunking would need firewall changes later.
7. **UI_APP_URL** defaults to localhost (see step 5) — embed/billing links only; set it if those flows are used.
