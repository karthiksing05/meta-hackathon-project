# Deploying the backend (Vultr, Debian 12, Cloudflare Tunnel)

Everything runs on one server. Cloudflare terminates HTTPS and forwards over an encrypted Tunnel to
two loopback ports. Nothing is exposed publicly except what the Tunnel publishes.

```
phone ──HTTPS──► Cloudflare ──Tunnel──► cloudflared (systemd, host)
                                           ├─► 127.0.0.1:8080  api    (Go + Chi)
                                           └─► 127.0.0.1:8081  games  (static files)
                               Docker: api ──backend network (internal)──► mongo (no published port)
Disk:   /srv/game-platform/data/games   (api: read-write, games: read-only)
        /srv/game-platform/data/mongo   (mongo)
```

Replace `yourdomain.com` below with your domain, and `OWNER` with the GitHub owner of the repo.

Nothing here has been run against a real server: I had no access to Vultr, Cloudflare or GitHub.
The Go code and tests were run locally; the Compose file, scripts and workflow were only
syntax-checked. Do the first deployment while watching it, and use step 9 to test.

## 1. Prepare the Debian 12 server

Log in as root (or a sudo user) once.

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl gnupg ufw unattended-upgrades

# Firewall: only SSH is open. No 80/443/8080/8081/27017: Cloudflare reaches us through the Tunnel.
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw --force enable

# Docker Engine + Compose plugin from Docker's apt repository
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Dedicated deployment user (SSH key only, no password)
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy     # note: docker group access is root-equivalent; protect this key
```

Docker's published ports bypass `ufw`. That is fine here because the Compose file only publishes to
`127.0.0.1`, but never change those to `0.0.0.0`.

## 2. Persistent directories and permissions

```bash
mkdir -p /srv/game-platform/{app,state,backups} /srv/game-platform/data/{games,mongo} /etc/game-platform
chown deploy:deploy /srv/game-platform/app /srv/game-platform/state
chown 10001:10001 /srv/game-platform/data/games      # the api and games containers run as uid 10001
chown 999:999    /srv/game-platform/data/mongo       # the mongo image runs as uid 999
chmod 750 /srv/game-platform/data/games /srv/game-platform/data/mongo
chmod 700 /srv/game-platform/backups

# Config and secrets live outside the repo. The deploy user must be able to read them because
# `docker compose` reads env_file on the client side.
chown root:deploy /etc/game-platform && chmod 750 /etc/game-platform
echo "ghcr.io/OWNER" > /etc/game-platform/registry          # lowercase GitHub owner
```

The games directory holds `tmp/` (private uploads), `private/` (editable source for remixes, never
served) and `published/` (immutable, public). The static server is configured to serve only
`published/`, so the other two cannot be reached even though the whole directory is mounted.

## 3. Configure MongoDB authentication

Create the two env files from the examples in `backend/deploy/env/`, with real random values:

```bash
openssl rand -base64 36   # run three times: Mongo root password, app password, then JWT secret (use 48 bytes)
```

```bash
install -m 640 -o root -g deploy /dev/null /etc/game-platform/mongo.env
install -m 640 -o root -g deploy /dev/null /etc/game-platform/api.env
nano /etc/game-platform/mongo.env     # from deploy/env/mongo.env.example
nano /etc/game-platform/api.env       # from deploy/env/api.env.example; password must match MONGO_APP_PASSWORD
```

How authentication is set up:

- `mongod` starts with `--auth`. The Mongo image creates the root user from `MONGO_INITDB_ROOT_*`.
- `deploy/mongo-init.js` runs once, only when `/srv/game-platform/data/mongo` is empty, and creates the
  `bubbles_app` user with `readWrite` on the `bubbles` database only. The API connects as that user.
- Port 27017 is never published; Mongo sits on an `internal` Docker network that only the API joins.
- If you change `MONGO_APP_PASSWORD` later, the init script will NOT re-run. Change it inside Mongo
  with `db.changeUserPassword(...)` and update `api.env`.

## 4. Set up Docker Compose

The workflow copies `docker-compose.prod.yml` and the scripts to `/srv/game-platform/app/` on every
deploy. For the very first run, bring up Mongo yourself so it initialises (as `deploy`, after the
workflow has copied the files once, or copy them by hand with `scp`):

```bash
cd /srv/game-platform/app
docker compose -f docker-compose.prod.yml up -d mongo
docker compose -f docker-compose.prod.yml logs mongo | tail     # look for "created application user"
```

Mongo is started manually once and then left alone. Routine deploys run
`docker compose up -d --no-deps api games`, which never touches Mongo or the data directories.
Never run `docker compose down -v`; no script here does.

After the first successful deploy, create the indexes (idempotent; repeat only when
`internal/store/indexes.go` changes):

```bash
/srv/game-platform/app/dbinit.sh
```

## 5. Install and configure cloudflared

In the Cloudflare dashboard: Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared. Name it
(e.g. `bubbles-vultr`). Cloudflare shows an install command containing a tunnel token. Treat the
token as a secret and do not put it in the repo, a container image, or a workflow.

On the server (Debian 12), install from Cloudflare's apt repo and register the service:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
apt update && apt -y install cloudflared
cloudflared service install <TOKEN-FROM-THE-DASHBOARD>
systemctl enable --now cloudflared && systemctl status cloudflared
```

It runs as a host systemd service, outside Compose. Deployments never restart it. Check the current
install command on Cloudflare's docs if this one has changed.

## 6. Add Cloudflare public hostnames

In the tunnel's "Public Hostname" tab:

| Hostname | Service |
|---|---|
| `api.yourdomain.com` | `HTTP` → `localhost:8080` |
| `games.yourdomain.com` | `HTTP` → `localhost:8081` |

Cloudflare creates the DNS records. HTTP to localhost is correct: TLS ends at Cloudflare, and the Go
programs do not hold certificates.

Caching, configured separately for each hostname (Caching > Cache Rules):

1. `games.yourdomain.com`: **Eligible for cache**, Edge TTL "Use cache-control header if present" (the
   static server sends `public, max-age=31536000, immutable`), Browser TTL the same. Needed because
   Cloudflare does not cache `.json` or `.wasm` by default. Game files never change after publishing,
   so there is nothing to purge.
2. `api.yourdomain.com`: **Bypass cache**. The API also sends `Cache-Control: no-store`.

Add a WAF rate-limiting rule on `api.yourdomain.com/v1/auth/*` as defence in depth. The API has its
own per-IP limit, using Cloudflare's `CF-Connecting-IP` header. Cloudflare free plans cap request
bodies at 100 MB; the API's upload limit is 50 MB.

## 7. Set GitHub Actions secrets

Create a dedicated deployment SSH identity on your own machine (not on the server):

```bash
ssh-keygen -t ed25519 -C "bubbles-deploy" -f bubbles_deploy -N ""
ssh-copy-id -i bubbles_deploy.pub deploy@SERVER_IP          # or append to /home/deploy/.ssh/authorized_keys
ssh-keyscan -t ed25519 SERVER_IP                            # output is the VPS_KNOWN_HOSTS secret
```

Repository > Settings > Environments > New environment: `production` (optionally add required
reviewers). Add these **environment secrets**:

| Secret | Value |
|---|---|
| `VPS_HOST` | server IP or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contents of `bubbles_deploy` (the private key) |
| `VPS_KNOWN_HOSTS` | the `ssh-keyscan` line, so the host key is pinned |

Optional environment **variable** `API_PUBLIC_URL` = `https://api.yourdomain.com`: if set, the
workflow also checks readiness through Cloudflare and rolls back if that fails. Delete the private
key file from your machine afterwards. No MongoDB credentials, tunnel token or SSH key is stored in the
repo or in any image. The registry token is the workflow's own short-lived `GITHUB_TOKEN`, sent over SSH
stdin for the pull.

## 8. Create the `Prod` branch and deployment workflow

The workflow is `.github/workflows/backend-deploy.yml` and triggers only on pushes to a branch named
exactly `Prod` (case-sensitive). Per `CLAUDE.md`, do not touch `main` without Karthik's OK. Create
`Prod` from the branch you want to ship, then protect it (Settings > Branches: require PRs, and
optionally restrict who can push):

```bash
git push origin backend-api:refs/heads/Prod
```

Each push runs: gofmt + `go vet` + `go test -race` + script and Compose validation, then builds both
images, pushes `ghcr.io/OWNER/bubbles-api:<sha>` and `bubbles-games:<sha>`, SSHes in, runs
`deploy.sh deploy <sha>`, and checks readiness. First time only: if GHCR reports the package is not
linked to the repo, link it under the package settings so `GITHUB_TOKEN` can pull it.

## 9. Test a deployment

1. Push to `Prod` and watch the Actions run turn green.
2. On the server: `/srv/game-platform/app/deploy.sh status` (shows current/previous tags and containers).
3. From anywhere:

```bash
curl -s https://api.yourdomain.com/readyz                   # {"database":"ok","storage":"ok"}
curl -s -X POST https://api.yourdomain.com/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","username":"you","password":"a long password"}'
# upload a package zip (manifest.json at the root), using the accessToken from above
curl -s -X POST https://api.yourdomain.com/v1/creations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/zip' --data-binary @game.zip
curl -sI https://games.yourdomain.com/<id>/manifest.json    # 200, long immutable Cache-Control, cf-cache-status
```

4. Persistence check: `docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps api`
   and confirm the game still loads from `games.yourdomain.com` and `/v1/feed` still lists it.
5. Backups: `sudo /srv/game-platform/app/backup.sh mongo` and `... games`. To run them daily, copy
   `deploy/systemd/game-platform-backup@.{service,timer}` to `/etc/systemd/system/` and
   `systemctl enable --now game-platform-backup@mongo.timer game-platform-backup@games.timer`. They write to
   `/srv/game-platform/backups`; copy that off the server as well.

## 10. Roll back a failed deployment

- **Automatic:** `deploy.sh` waits up to 90 s for `/readyz` on the API and `/healthz` on the games server. If
  either fails it logs the container output and redeploys the previous image tag. The workflow then
  fails. If you set `API_PUBLIC_URL`, a failure of the check through Cloudflare triggers
  `deploy.sh rollback` too.
- **Manual, previous version:** `ssh deploy@SERVER /srv/game-platform/app/deploy.sh rollback`
- **Manual, any version:** `/srv/game-platform/app/deploy.sh deploy <older-commit-sha>`. Old tags stay in GHCR.
- Rollback changes only the `api` and `games` images. Data is untouched: published games are immutable
  and Mongo is not restarted. If a release changed data in a way you need to undo, restore from the separate
  backups: `docker exec -i game-platform-mongo-1 mongorestore --archive --gzip --drop ...` for Mongo, or
  unpack the games tarball. Do this deliberately and by hand, never as part of a deploy.
- A bad `Prod` commit: `git revert` it and push; this deploys the fix through the same pipeline.
