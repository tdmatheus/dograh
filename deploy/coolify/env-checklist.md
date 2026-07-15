# Dograh @ rejuto.motorbrain.net — Environment Variable Checklist

Validated against the actual repo on 2026-07-13:
`api/.env.example`, `api/constants.py`, `docker-compose.yaml`, `scripts/start_services_docker.sh`, `scripts/setup_remote.sh`.

The **actual values** to paste into Coolify live in `.env.dograh.example` (same
directory) — secrets there were pre-generated with `openssl rand -hex 32`.
This file is the *review map*: what each var is, whether it is a secret, and
where it points. Do not duplicate secret values here.

Every var below is consumed by `docker-compose.coolify.yaml`. Vars marked
**(derived — do NOT set)** are intentionally omitted; `api/constants.py` computes
them from `PUBLIC_BASE_URL` / `PUBLIC_HOST` and setting them wrong is a common
foot-gun.

## Required — deployment identity (decided, not secret)

| Var | Value | Points at | Notes |
|-----|-------|-----------|-------|
| `ENVIRONMENT` | `production` | — | |
| `SERVER_IP` | `172.235.57.223` | lax1 host | Used verbatim as coturn `--external-ip`. Raw IP, not the hostname. |
| `PUBLIC_HOST` | `rejuto.motorbrain.net` | public host | `TURN_HOST` derives from this → clients dial `turn:rejuto.motorbrain.net:3478`. |
| `PUBLIC_BASE_URL` | `https://rejuto.motorbrain.net` | public origin | `BACKEND_API_ENDPOINT` + `MINIO_PUBLIC_ENDPOINT` derive from this. |
| `REGISTRY` | `dograhai` | Docker Hub | Official prebuilt images. |
| `FASTAPI_WORKERS` | `1` | — | MUST stay 1 behind Traefik (image binds consecutive ports per worker expecting nginx `least_conn`; Traefik routes only :8000). Confirmed in `scripts/start_services_docker.sh`. |
| `FORCE_TURN_RELAY` | `false` | — | Flip to `true` temporarily for the TURN verification step, then back. |
| `ENABLE_TELEMETRY` | `false` | — | Deployment is deliberately unbranded. |

## Required — SECRETS (generate; rotate if the values file was shared)

| Var | Secret? | Generate with | Notes |
|-----|---------|---------------|-------|
| `OSS_JWT_SECRET` | **secret** | `openssl rand -hex 32` | JWT signing for OSS auth. Compose enforces it (`:?` guard). Rotating invalidates all sessions. |
| `POSTGRES_PASSWORD` | **secret** | `openssl rand -hex 32` | **Baked into the postgres data volume on first init.** Cannot be changed by env later — only via `ALTER USER` inside the container. |
| `REDIS_PASSWORD` | **secret** | `openssl rand -hex 32` | Rotatable (update env + recreate redis). |
| `TURN_SECRET` | **secret** | `openssl rand -hex 32` | Shared HMAC secret for TURN REST time-limited creds. **Must be identical** on the `api` and `coturn` services (both read this var). |
| `MINIO_ROOT_USER` | **secret-ish** | `dograh$(openssl rand -hex 6)` | Also used by the API as the S3 access key. |
| `MINIO_ROOT_PASSWORD` | **secret** | `openssl rand -hex 32` | Also the API's S3 secret key. |

In Coolify, mark all six as secrets (lock icon) so they are masked in the UI.

## Recommended — set to avoid localhost links (parity gap with upstream)

| Var | Value | Why |
|-----|-------|-----|
| `UI_APP_URL` | `https://rejuto.motorbrain.net` | `api/constants.py` defaults this to `http://localhost:3010`. It is used to build **workflow embed** links (`api/routes/workflow_embed.py`) and the Stripe **billing** return URL (`api/routes/organization_usage.py`). NOT needed for the core WebRTC test-call flow, and upstream's `setup_remote.sh` also leaves it defaulted — but set it so embed/billing links are correct. Add it to the `api` service env (compose does not pass it yet). |

## Derived — do NOT set (computed from the above)

| Var | Resolves to | Source |
|-----|-------------|--------|
| `BACKEND_API_ENDPOINT` | `https://rejuto.motorbrain.net` | `constants.py:36` — falls back to `PUBLIC_BASE_URL`. |
| `MINIO_PUBLIC_ENDPOINT` | `https://rejuto.motorbrain.net` (recording URLs → `/voice-audio/...`) | `constants.py:67` — falls back to `PUBLIC_BASE_URL`. The `/voice-audio` Traefik route serves these. |
| `TURN_HOST` | `rejuto.motorbrain.net` | `constants.py:192` — falls back to `PUBLIC_HOST`. |

## Fixed in-compose (no env needed, listed for completeness)

- `api`: `DATABASE_URL` (built from `POSTGRES_PASSWORD`), `REDIS_URL` (from `REDIS_PASSWORD`), `MINIO_ENDPOINT=minio:9000`, `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` (from the MinIO root creds), `MINIO_BUCKET=voice-audio`, `MINIO_SECURE=false`, `ENABLE_AWS_S3=false`, `FORWARDED_ALLOW_IPS=*` (trust Traefik's `X-Forwarded-Proto` — required for webhook signature verification; safe because :8000 is not host-published), `LOG_LEVEL=INFO`, PostHog keys.
- `ui`: `HOSTNAME=0.0.0.0`, `BACKEND_URL=http://api:8000` (SSR over the Docker network), `NODE_ENV=oss`, PostHog keys.
- `coturn`: all TURN flags are CLI args (`--external-ip=${SERVER_IP}`, `--static-auth-secret=${TURN_SECRET}`, port ranges, `--realm=dograh.com`) — reproduce `deploy/templates/turnserver.remote.conf.template` 1:1.

## Optional / not used by this deploy

- `DOGRAH_DEVOPS_SECRET` — only for `scripts/rolling_update.sh` / protected ops endpoints (`X-Dograh-Devops-Secret`). Not needed for a Coolify deploy that redeploys via the Coolify API. Set only if you script rolling updates.
- `LANGFUSE_*` — tracing; can be set per-org in the UI. Leave unset.
- `AWS_*` / `S3_*` — only if you later flip `ENABLE_AWS_S3=true` (see open question about MinIO being anonymously readable/writable).
- `CLOUDFLARE_TUNNEL_TOKEN` / `CLOUDFLARED_COMMAND` — not used; lax1 has a real public IP, so no tunnel. The `cloudflared` service is behind the `tunnel` profile and is not in the Coolify compose.
