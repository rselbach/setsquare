---
name: deploy-web
description: Deploy, redeploy, or roll back the Setsquare web app in production at setsquare.rselbach.com (exe.dev VM `setsquare`). Use when asked to deploy or ship the web app, roll it back, check which commit production runs, or rebuild the production host.
---

# Deploy the web app

Production runs on the exe.dev VM `setsquare`. The VM runs the image built from the repository's `Dockerfile` (nginx serving the static build with `setsquare-app/nginx.conf`) as the container `setsquare`, mapped to port 8000. The exe.dev HTTPS proxy publishes that port publicly. `setsquare.rselbach.com` is a DNS-only Cloudflare CNAME to `setsquare.exe.xyz`.

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
   3. Replaces the container. If the new container does not answer on port 8000 within 15 seconds, the script restores the previous image and fails.
   4. Prunes unused images and build cache, so each build starts clean.
   5. Checks that `https://setsquare.rselbach.com/` and a drawing URL serve the Setsquare page, and that a missing asset returns 404.

   A deploy takes about 2 minutes and prints the full Docker build log. Run it in the background and read the last lines of its output. Success ends with `Deployed <sha> to https://setsquare.rselbach.com/`.

## Roll back

Run the deploy script with the earlier commit: `.claude/skills/deploy-web/scripts/deploy.sh <sha>`. The VM keeps no old images, so a rollback rebuilds the image.

## Inspect production

```bash
ssh setsquare.exe.xyz docker ps --filter name=setsquare  # image tag is the deployed commit
ssh setsquare.exe.xyz docker logs --tail 50 setsquare
ssh exe.dev share show setsquare
```

## Rebuild the host

If the VM no longer exists, recreate it before you run the deploy script:

1. `ssh exe.dev new --name=setsquare --comment=setsquare-production-host --tag=setsquare-prod`
2. In the Cloudflare zone `rselbach.com`, create the CNAME `setsquare` → `setsquare.exe.xyz` and set it to DNS only. The Cloudflare proxy breaks exe.dev custom domains.
3. `ssh exe.dev domain add setsquare setsquare.rselbach.com`
4. `ssh exe.dev share set-public setsquare`
5. Run the deploy script. It enables `docker.service`, which the exeuntu image ships disabled. Without it, the container would not start again after a reboot.

Do not use `docker-compose.yml` for production. It is a development setup.
