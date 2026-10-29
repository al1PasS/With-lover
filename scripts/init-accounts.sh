#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
docker compose run --rm -it api --spring.profiles.active=init-accounts --server.port=0
