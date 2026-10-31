---
name: deploy-web
description: Deploy, redeploy, or roll back the Setsquare web app in production at setsquare.rselbach.com (exe.dev VM `setsquare`). Use when asked to deploy or ship the web app, roll it back, check which commit production runs, or rebuild the production host.
---

# Deploy the web app

Production runs on the exe.dev VM `setsquare`. The VM runs the image built from the repository's `Dockerfile` as the container `setsquare`. The image runs `setsquare-server`, which serves the app and its `/api` on port 3002. The container maps that port to the VM's port 8000, and the exe.dev HTTPS proxy publishes port 8000 publicly. Port 8000 serves plain HTTP on every VM interface, including the tailnet address, because exe.dev does not document which interface its proxy connects to. Tailnet peers can therefore reach the server without the proxy and forge `X-Forwarded-For` under `TRUST_PROXY`. `setsquare.rselbach.com` is a DNS-only Cloudflare CNAME to `setsquare.exe.xyz`.

The server reads its settings from `/home/exedev/setsquare.env` on the VM. The file has mode 600 and is never in the repository. It sets these variables:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://setsquare.rselbach.com` |
| `DATABASE_URL` | The `setsquare` role and database on `pg-rselbach`, at its Tailscale address `100.94.176.81` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The GitHub OAuth app whose callback is `https://setsquare.rselbach.com/api/auth/github/callback` |
| `ALLOWED_GITHUB_IDS` | `355691`, the GitHub user id of `rselbach`. Without it the server refuses to start, and the deploy rolls back |
| `TRUST_PROXY` | `1`. The exe.dev proxy appends the client's address to `X-Forwarded-For`, and the Docker port mapping adds no hop. Without it, MCP client registrations and sign-in starts share the proxy's address and one rate limit each |

The database lives on the shared PostgreSQL VM `pg-rselbach`, which accepts connections only over Tailscale. Its `/etc/postgres/pg_hba.conf` allows the `setsquare` role into the `setsquare` database only from the `setsquare` VM's Tailscale address. The server applies its migrations when it starts.

## Redeploy

1. Choose a commit that is on `origin/main` and whose "Build Docker image" run passed:

   ```bash
   git fetch origin
   gh run list --workflow build-docker.yml --commit "$(git rev-parse origin/main)"
   ```

2. Run the deploy script with that commit. It defaults to `HEAD`:

   ```bash
   .claude/skills/deploy-web/scripts/deploy.sh origin/main
   ```

   The script does these steps:

   1. Uploads `git archive` of the commit to `/home/exedev/setsquare` on the VM. Uncommitted changes are never deployed.
   2. Builds the image `setsquare:<short-sha>` on the VM.
   3. Replaces the container. If `/api/health` does not answer on port 8000 within 30 seconds, the script restores the previous image and fails. The health check reaches the database.
   4. Prunes unused images and build cache, so each build starts clean.
   5. Checks that `https://setsquare.rselbach.com/` and a drawing URL serve the Setsquare page, that a missing asset returns 404, that `/api/health` passes, and that `/api/session` offers GitHub sign-in.

   A deploy takes about 2 minutes and prints the full Docker build log. Run it in the background and read the last lines of its output. Success ends with `Deployed <sha> to https://setsquare.rselbach.com/`.

## Roll back

Run the deploy script with the earlier commit: `.claude/skills/deploy-web/scripts/deploy.sh <sha>`. The VM keeps no old images, so a rollback rebuilds the image.

## Inspect production

```bash
ssh setsquare.exe.xyz docker ps --filter name=setsquare  # image tag is the deployed commit
ssh setsquare.exe.xyz docker logs --tail 50 setsquare
curl -s https://setsquare.rselbach.com/api/health  # {"ok":true} when the database answers
ssh exe.dev share show setsquare
```

## Rebuild the host

If the VM no longer exists, recreate it before you run the deploy script:

1. `ssh exe.dev new --name=setsquare --comment=setsquare-production-host --tag=setsquare-prod`
2. In the Cloudflare zone `rselbach.com`, create the CNAME `setsquare` → `setsquare.exe.xyz` and set it to DNS only. The Cloudflare proxy breaks exe.dev custom domains.
3. `ssh exe.dev domain add setsquare setsquare.rselbach.com`
4. `ssh exe.dev share set-public setsquare`
5. Join the VM to the tailnet: `ssh setsquare.exe.xyz sudo systemctl enable --now tailscaled`, then `ssh setsquare.exe.xyz sudo tailscale up --hostname=setsquare` and open the login link it prints.
6. On `pg-rselbach`, replace the address in the `setsquare` line of `/etc/postgres/pg_hba.conf` with the VM's new address from `tailscale ip -4`. Then reload PostgreSQL: `sudo docker exec shared-postgres-postgres-1 psql -U postgres -c 'select pg_reload_conf()'`.
7. Recreate `/home/exedev/setsquare.env` with mode 600 and the variables in the table above.
8. Run the deploy script. It enables `docker.service`, which the exeuntu image ships disabled. Without it, the container would not start again after a reboot.
