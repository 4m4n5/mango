#!/usr/bin/env bash
# Install Docker on Pi OS for N3d self-hosted addons.

set -euo pipefail

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "docker already installed and running"
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get not found — install Docker manually" >&2
  exit 1
fi

echo "Installing docker.io (requires sudo)..."
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io

# Pi OS / Debian often lack docker-compose-plugin; try fallbacks.
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin missing — installing docker-compose package..."
  if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose 2>/dev/null; then
    echo "WARN: docker-compose package unavailable; install scripts will try 'docker compose' only" >&2
  fi
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "${USER}" || true

if sudo docker info >/dev/null 2>&1; then
  echo "docker daemon running (sudo)"
fi

if docker info >/dev/null 2>&1; then
  echo "docker ready for user ${USER}"
  docker compose version 2>/dev/null || docker-compose version 2>/dev/null || true
  exit 0
fi

echo "docker installed — activate group membership:" >&2
echo "  newgrp docker" >&2
echo "or log out and SSH back in, then: docker info" >&2
exit 0
