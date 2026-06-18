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
    HostName 10.0.0.174
    User aman
    IdentityFile ${HOME}/.ssh/id_ed25519_mango
    IdentitiesOnly yes
    ConnectTimeout 10
    ControlMaster auto
    ControlPath ${HOME}/.ssh/control-%r@%h:%p
    ControlPersist 8h
    ServerAliveInterval 30
    StrictHostKeyChecking accept-new
EOF
  echo "Appended mango host block to $SSH_CONFIG"
else
  echo "SSH config already has mango block (edit HostName to 10.0.0.174 if mango.local hangs)"
fi

PUB=$(cat "${KEY}.pub")

echo
echo "=== Authorize this Mac on the Pi (one time) ==="
echo
echo "SSH to the Pi (use IP if mango.local hangs):"
echo "  ssh aman@10.0.0.174"
echo
echo "Then paste on the Pi:"
echo
echo "  mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo OK"
echo
echo "Test from Mac:"
echo "  bash scripts/pi-exec.sh 'hostname && pwd'"
echo

if ssh -o BatchMode=yes -o ConnectTimeout=8 mango 'echo authorized' 2>/dev/null; then
  echo "Already authorized — agent SSH works."
else
  echo "Not authorized yet — paste the line above on the Pi."
fi
