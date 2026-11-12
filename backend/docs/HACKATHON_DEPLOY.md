# Hackathon deploy: copy and paste

The short version of [DEPLOYMENT.md](DEPLOYMENT.md). It uses the `root` login you already have on the
Vultr server, so there is no extra user to create. MongoDB still has a password, but the commands below
generate it for you and write it to a file; you never type or read it.

You need: the Vultr server's IP (Debian 12), a domain on Cloudflare, and the `gh` CLI logged in
(`gh auth login`). Nothing here has been run against a real server, so watch the output and stop at the
first error.

Each block says where it runs: **server** (SSH in as root) or **your PC** (PowerShell, from the repo root).
Edit the three values marked `EDIT` once, then paste each block as is.

```
phone -> Cloudflare -> cloudflared (on the server) -> api :8080 and games :8081 (Docker, loopback only)
                                                      api -> mongo (Docker network, no published port)
```

## 1. Server: install Docker and the firewall

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl ufw
ufw default deny incoming && ufw default allow outgoing && ufw allow OpenSSH && ufw --force enable
curl -fsSL https://get.docker.com | sh
docker compose version
```

## 2. Server: folders, passwords and config files

Paste this as one block. It makes random passwords and keeps them only in `/etc/game-platform`.

```bash
DOMAIN=yourdomain.com            # EDIT: your Cloudflare domain
OWNER=karthiksing05              # EDIT only if the GitHub repo owner is someone else (lowercase)

mkdir -p /srv/game-platform/{app,state,backups} /srv/game-platform/data/{games,mongo} /etc/game-platform
chown 10001:10001 /srv/game-platform/data/games
chown 999:999 /srv/game-platform/data/mongo
echo "ghcr.io/$OWNER" > /etc/game-platform/registry

umask 077
MONGO_ROOT_PW=$(openssl rand -hex 24); APP_PW=$(openssl rand -hex 24); JWT=$(openssl rand -hex 32)
cat > /etc/game-platform/mongo.env <<EOF
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=$MONGO_ROOT_PW
MONGO_APP_DB=bubbles
MONGO_APP_USER=bubbles_app
MONGO_APP_PASSWORD=$APP_PW
EOF
cat > /etc/game-platform/api.env <<EOF
MONGO_URI=mongodb://bubbles_app:$APP_PW@mongo:27017/bubbles?authSource=bubbles
MONGO_DB=bubbles
JWT_SECRET=$JWT
GAMES_BASE_URL=https://games.$DOMAIN
CORS_ORIGINS=
EOF
unset MONGO_ROOT_PW APP_PW JWT
ls -l /etc/game-platform
```

Do not run this block a second time: it would write new passwords that no longer match the database.

## 3. Server: Cloudflare Tunnel

1. Cloudflare dashboard > **Zero Trust** > **Networks** > **Tunnels** > **Create a tunnel** > **Cloudflared**.
   Name it `bubbles`. Pick **Debian**, **64-bit**, and copy the token from the install command shown
   (the long string after `cloudflared service install`). Treat it like a password.
2. Paste this on the server, replacing `PASTE_TOKEN`:

```bash
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
apt -y install /tmp/cloudflared.deb
cloudflared --version
cloudflared service install PASTE_TOKEN
systemctl status cloudflared --no-pager
```

3. Back in the dashboard, open the tunnel > **Published application routes** (or **Public Hostname**) and
   add two routes:

| Subdomain | Domain | Service type | URL |
|---|---|---|---|
| `api` | your domain | HTTP | `localhost:8080` |
| `games` | your domain | HTTP | `localhost:8081` |

## 4. Server: a deploy key, and let GitHub use it

GitHub Actions needs to log in to this server by itself on every deploy. This makes a key pair, lets the
server accept it, and stores the private half in GitHub as secrets. Your own password login is not affected.

Run it on the **server**. `gh` must be installed there; `gh auth login` opens a browser code flow. The GitHub
account you log in with needs admin access to the repo (creating an environment and its secrets requires
it); if you get a 403 or 404, ask the repo owner to add you or to set the secrets.

```bash
REPO=karthiksing05/meta-hackathon-project   # EDIT only if the repo moved
DOMAIN=yourdomain.com                       # EDIT
IP=$(curl -4 -s https://ifconfig.me)

gh auth status || gh auth login             # GitHub.com > HTTPS > login with a web browser

mkdir -p /root/.ssh && chmod 700 /root/.ssh
ssh-keygen -t ed25519 -C bubbles-deploy -f /root/bubbles_deploy -N ""
cat /root/bubbles_deploy.pub >> /root/.ssh/authorized_keys

gh api -X PUT repos/$REPO/environments/production
gh secret set VPS_HOST --env production --repo $REPO --body "$IP"
gh secret set VPS_USER --env production --repo $REPO --body root
gh secret set VPS_SSH_KEY --env production --repo $REPO < /root/bubbles_deploy
ssh-keyscan -t ed25519 $IP 2>/dev/null | gh secret set VPS_KNOWN_HOSTS --env production --repo $REPO
gh variable set API_PUBLIC_URL --env production --repo $REPO --body "https://api.$DOMAIN"

shred -u /root/bubbles_deploy /root/bubbles_deploy.pub
```

The last line deletes the private key from the server; GitHub now holds the only copy. Run it only after
every `gh` line above it succeeded.

## 5. Your PC and server: start the database once

The workflow never starts Mongo, so do this one time. First copy the two files up from the repo root on **your PC** (PowerShell). It asks for the server's root
password. Replace `SERVER_IP`:

```powershell
scp backend/deploy/docker-compose.prod.yml backend/deploy/mongo-init.js root@SERVER_IP:/srv/game-platform/app/
```

Then on the **server**:

```bash
cd /srv/game-platform/app
API_IMAGE=x GAMES_IMAGE=y docker compose -f docker-compose.prod.yml up -d mongo
sleep 40
API_IMAGE=x GAMES_IMAGE=y docker compose -f docker-compose.prod.yml logs mongo | grep -i "created application user"
```

You should see `created application user bubbles_app`. If not, see Troubleshooting.

## 6. Your PC: deploy

The `Prod` branch already exists on GitHub. Re-run its workflow (or push any new commit to `Prod`):

```powershell
$REPO = "karthiksing05/meta-hackathon-project"     # EDIT only if the repo moved
$RUN = gh run list --repo $REPO --workflow "Backend deploy" --branch Prod --limit 1 --json databaseId --jq ".[0].databaseId"
gh run rerun $RUN --repo $REPO
gh run watch $RUN --repo $REPO
```

It runs the tests, builds and pushes the two images to GitHub's registry, copies the deploy files over SSH,
starts `api` and `games`, waits for them to become healthy, and then checks the public URL. If a check fails
it rolls back by itself.

## 7. Server: create the database indexes (once)

```bash
/srv/game-platform/app/dbinit.sh
```

## 8. Check that it works

```bash
curl -s https://api.yourdomain.com/readyz
curl -s -X POST https://api.yourdomain.com/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","username":"you","password":"a long password"}'
```

`readyz` should say `{"database":"ok","storage":"ok"}`. The register call returns an access token. To
publish a game, zip a folder with `manifest.json` at its top level and send it:

```bash
curl -s -X POST https://api.yourdomain.com/v1/creations -H "Authorization: Bearer TOKEN" \
  -H 'Content-Type: application/zip' --data-binary @game.zip
```

The response includes `packageUrl`; open it in a browser.

## Day to day

- **Deploy a change:** merge or push it to the `Prod` branch. Nothing else is needed.
- **Roll back:** `ssh root@SERVER_IP /srv/game-platform/app/deploy.sh rollback`
- **See what is running:** `ssh root@SERVER_IP /srv/game-platform/app/deploy.sh status`
- **Logs:** `cd /srv/game-platform/app && API_IMAGE=x GAMES_IMAGE=y docker compose -f docker-compose.prod.yml logs -f api`
- **Never** run `docker compose down -v` and never delete `/srv/game-platform/data`: that is where the
  database and the published games live.

## Troubleshooting

- **Workflow fails at "Deploy" with `denied` or `unauthorized` from ghcr.io:** open the repo's Packages on
  GitHub, open `bubbles-api` and `bubbles-games`, and link each to the repository (Package settings >
  Manage Actions access). Then re-run.
- **Workflow fails at SSH:** the key or host is wrong. Check the five values under the repo's Settings >
  Environments > production. If the key was deleted before the `gh secret set` lines all worked, redo step 4.
- **`created application user` is missing:** the data folder was not empty or the env file was wrong. This is only
  safe to redo if nothing has been stored yet: `cd /srv/game-platform/app`, stop Mongo with
  `API_IMAGE=x GAMES_IMAGE=y docker compose -f docker-compose.prod.yml stop mongo`, empty
  `/srv/game-platform/data/mongo` (`rm -rf /srv/game-platform/data/mongo/*`), and start it again.
- **`/readyz` says database down:** the password in `api.env` does not match the one Mongo was created with.
  Redo the Mongo reset above, then re-run step 6.
- **A site shows a Cloudflare 502:** `systemctl status cloudflared` on the server, and check the two routes in step 3
  point at `localhost:8080` and `localhost:8081`.
- **Optional, later:** in Cloudflare add a Cache Rule for `games.yourdomain.com` (Eligible for cache, use the
  origin's headers) and a Bypass rule for `api.yourdomain.com`. See DEPLOYMENT.md, section 6.
