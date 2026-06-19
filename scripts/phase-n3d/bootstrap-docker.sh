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
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin

sudo systemctl enable --now docker
sudo usermod -aG docker "${USER}" || true

if docker info >/dev/null 2>&1; then
  echo "docker ready"
else
  echo "docker installed — log out/in or run: newgrp docker" >&2
  echo "then: docker info" >&2
  exit 1
fi
