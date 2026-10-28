#!/usr/bin/env bash
#
# Deploys a commit of the Setsquare web app to production. Uploads the
# commit's source to the exe.dev VM, builds the Docker image there, replaces
# the running container, and checks the public site.
#
# Usage: deploy.sh [ref]    ref defaults to HEAD

set -uo pipefail

readonly VM_HOST="setsquare.exe.xyz"
readonly REMOTE_DIR="/home/exedev/setsquare"
readonly CONTAINER="setsquare"
readonly PROXY_PORT=8000
readonly PUBLIC_URL="https://setsquare.rselbach.com/"

err() {
  echo "deploy: $*" >&2
}

# remote_deploy runs on the VM. It builds the image for a commit, replaces the
# container, and restores the previous image if the new one does not answer.
remote_deploy() {
  local commit="$1" dir="$2" name="$3" port="$4"
  local image="${name}:${commit}"
  local previous
  local healthy=false

  sudo systemctl enable --now docker >/dev/null 2>&1 || return 1
  docker build --progress=plain -t "${image}" "${dir}" || return 1
  previous="$(docker inspect --format '{{.Image}}' "${name}" 2>/dev/null)"
  docker rm -f "${name}" >/dev/null 2>&1
  if docker run -d --name "${name}" --restart unless-stopped \
    -p "${port}:80" "${image}" >/dev/null; then
    for _ in {1..15}; do
      if curl -fs -o /dev/null "http://localhost:${port}/"; then
        healthy=true
        break
      fi
      sleep 1
    done
  fi

  if [[ "${healthy}" != true ]]; then
    echo "deploy: ${image} did not answer on port ${port}" >&2
    docker logs --tail 20 "${name}" >&2
    docker rm -f "${name}" >/dev/null 2>&1
    if [[ -n "${previous}" ]]; then
      echo "deploy: restoring the previous image" >&2
      docker run -d --name "${name}" --restart unless-stopped \
        -p "${port}:80" "${previous}" >/dev/null
    fi
    return 1
  fi

  if ! docker image prune -af >/dev/null \
    || ! docker builder prune -af >/dev/null; then
    echo "deploy: warning: pruning old images failed" >&2
  fi
}

upload_source() {
  local commit="$1"

  # shellcheck disable=SC2029  # REMOTE_DIR is meant to expand locally
  git archive --format=tar "${commit}" \
    | ssh "${VM_HOST}" \
      "rm -rf ${REMOTE_DIR} && mkdir ${REMOTE_DIR} && tar -x -C ${REMOTE_DIR}"
  local -a status=("${PIPESTATUS[@]}")
  if (( status[0] != 0 || status[1] != 0 )); then
    err "uploading ${commit} failed"
    return 1
  fi
}

deploy_on_vm() {
  local commit="$1"

  {
    declare -f remote_deploy
    echo "remote_deploy \"\$@\""
  } | ssh "${VM_HOST}" bash -s -- \
    "${commit}" "${REMOTE_DIR}" "${CONTAINER}" "${PROXY_PORT}"
}

check_public_site() {
  local page body status
  local missing_asset="${PUBLIC_URL}assets/deploy-check.js"

  for page in "" "d/deploy-check"; do
    if ! body="$(curl -fsS "${PUBLIC_URL}${page}")"; then
      err "${PUBLIC_URL}${page} did not answer"
      return 1
    fi
    if [[ "${body}" != *"<title>Setsquare</title>"* ]]; then
      err "${PUBLIC_URL}${page} did not serve the Setsquare page"
      return 1
    fi
  done

  # a missing asset must not fall back to the page
  if ! status="$(curl -sS -o /dev/null -w '%{http_code}' "${missing_asset}")"
  then
    err "${missing_asset} did not answer"
    return 1
  fi
  if [[ "${status}" != 404 ]]; then
    err "${missing_asset} returned ${status} instead of 404"
    return 1
  fi
}

main() {
  local ref="${1:-HEAD}"
  local script_dir root commit

  script_dir="$(dirname "${BASH_SOURCE[0]}")"
  root="$(git -C "${script_dir}" rev-parse --show-toplevel)" || exit 1
  cd "${root}" || exit 1
  if ! commit="$(git rev-parse --short --verify --quiet "${ref}^{commit}")"; then
    err "unknown commit: ${ref}"
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    err "warning: uncommitted changes are not part of ${commit}"
  fi

  echo "Deploying ${commit} to ${VM_HOST}"
  upload_source "${commit}" || exit 1
  if ! deploy_on_vm "${commit}"; then
    err "deploying ${commit} on ${VM_HOST} failed"
    exit 1
  fi
  check_public_site || exit 1
  echo "Deployed ${commit} to ${PUBLIC_URL}"
}

main "$@"
