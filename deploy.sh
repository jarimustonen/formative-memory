#!/usr/bin/env bash
# Deploy associative memory plugin to OpenClaw on haapa.
#
# Usage:
#   ./deploy.sh [--restart]        Build and deploy plugin
#   ./deploy.sh --clean-slate      Wipe all plugin data and restore workspace backups
#
# Prerequisites:
#   - Node >= 22.12 (for build)
#   - SSH access to haapa
#   - Plugin already configured in openclaw.json (one-time setup)

set -euo pipefail

REMOTE="haapa"
PLUGIN_DIR="/srv/storage/openclaw/jari/extensions/memory-associative"
MEMORY_DIR="/srv/storage/openclaw/jari/memory/associative"
WORKSPACE_DIR="/srv/storage/openclaw/jari/workspace"
CONTAINER="openclaw-jari"

# -- Clean slate: wipe all plugin state --
if [[ "${1:-}" == "--clean-slate" ]]; then
    echo "=== Clean slate: removing all associative memory data ==="
    echo "This will delete:"
    echo "  - $MEMORY_DIR (DB, logs, all data)"
    echo "  - Workspace backups (.pre-associative-memory)"
    echo "  - Restore AGENTS.md and SOUL.md from backups"
    echo ""
    read -rp "Are you sure? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

    echo "--- Stopping container ---"
    ssh "$REMOTE" "systemctl --user stop container-$CONTAINER" || true
    sleep 2

    echo "--- Removing plugin data ---"
    ssh "$REMOTE" "podman unshare rm -rf '$MEMORY_DIR'"

    echo "--- Restoring workspace backups ---"
    ssh "$REMOTE" "podman unshare bash -c '
        for f in \"$WORKSPACE_DIR\"/*.pre-associative-memory; do
            [ -f \"\$f\" ] || continue
            orig=\"\${f%.pre-associative-memory}\"
            echo \"Restoring \$(basename \"\$orig\") from backup\"
            mv \"\$f\" \"\$orig\"
        done
    '"

    echo "--- Starting container ---"
    ssh "$REMOTE" "systemctl --user start container-$CONTAINER"
    sleep 5
    ssh "$REMOTE" "systemctl --user is-active container-$CONTAINER"

    echo "=== Clean slate complete. Plugin will start fresh on next session. ==="
    exit 0
fi

# -- Normal deploy --
DO_RESTART=false
for arg in "$@"; do
    case "$arg" in
        --restart) DO_RESTART=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

echo "=== Building plugin ==="
pnpm build

echo "=== Copying files to $REMOTE ==="
ssh "$REMOTE" 'mkdir -p /tmp/memory-associative-deploy'
scp dist/index.js dist/db-*.js openclaw.plugin.json package.json \
    "$REMOTE:/tmp/memory-associative-deploy/"

echo "=== Deploying to $PLUGIN_DIR ==="
ssh "$REMOTE" "podman unshare bash -c '
    mkdir -p $PLUGIN_DIR/dist &&
    cp /tmp/memory-associative-deploy/index.js $PLUGIN_DIR/dist/ &&
    cp /tmp/memory-associative-deploy/db-*.js $PLUGIN_DIR/dist/ &&
    cp /tmp/memory-associative-deploy/openclaw.plugin.json $PLUGIN_DIR/ &&
    cp /tmp/memory-associative-deploy/package.json $PLUGIN_DIR/ &&
    chown -R 1000:1000 $PLUGIN_DIR/
'"
ssh "$REMOTE" 'rm -rf /tmp/memory-associative-deploy'

echo "=== Deploy complete ==="

if $DO_RESTART; then
    echo "=== Restarting $CONTAINER ==="
    ssh "$REMOTE" "systemctl --user restart container-$CONTAINER"
    sleep 5
    ssh "$REMOTE" "systemctl --user is-active container-$CONTAINER"
    echo "=== Container restarted ==="
else
    echo "Run with --restart to restart the container, or:"
    echo "  ssh $REMOTE 'systemctl --user restart container-$CONTAINER'"
fi
