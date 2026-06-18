#!/usr/bin/env bash
# One-time Mac setup: passwordless SSH to mango Pi (so Cursor/Codex can run remote commands).
# Run on your Mac: bash scripts/setup-mac-pi-ssh.sh

set -euo pipefail

KEY="${HOME}/.ssh/id_ed25519_mango"
SSH_CONFIG="${HOME}/.ssh/config"
MARKER="# mango Pi — aaam.dev personal"

echo "=== mango: Mac → Pi SSH setup ==="

mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "mango-pi-agent"
  echo "Created $KEY"
else
  echo "Key exists: $KEY"
fi

if ! grep -qF "$MARKER" "$SSH_CONFIG" 2>/dev/null; then
  cat >>"$SSH_CONFIG" <<EOF

$MARKER
Host mango mango-pi pi
    HostName mango.local
    User aman
    IdentityFile $KEY
    IdentitiesOnly yes
    ControlMaster auto
    ControlPath ${HOME}/.ssh/control-%r@%h:%p
    ControlPersist 8h
    ServerAliveInterval 30
    StrictHostKeyChecking accept-new
EOF
  echo "Appended mango host block to $SSH_CONFIG"
else
  echo "SSH config already has mango block"
fi

PUB=$(cat "${KEY}.pub")

echo
echo "=== Authorize this Mac on the Pi (one time) ==="
echo
echo "In your OPEN ssh session to the Pi, paste:"
echo
echo "  mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo OK"
echo
echo "Then back on the Mac, test:"
echo "  bash scripts/pi-exec.sh 'hostname && pwd'"
echo

if ssh -o BatchMode=yes -o ConnectTimeout=8 mango 'echo authorized' 2>/dev/null; then
  echo "Already authorized — agent SSH works."
else
  echo "Waiting for you to paste the authorize line on the Pi..."
fi
