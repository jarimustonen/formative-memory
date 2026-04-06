#!/usr/bin/env bash
# Deploy associative memory plugin to OpenClaw on haapa.
#
# Usage: ./deploy.sh [--restart]
#
# Builds the plugin, copies dist files to the server, and optionally
# restarts the container. Without --restart, the plugin is deployed
# but won't be active until the next container restart.
#
# Prerequisites:
#   - Node >= 22.12 (for build)
#   - SSH access to haapa
#   - Plugin already configured in openclaw.json (one-time setup)

set -euo pipefail

REMOTE="haapa"
PLUGIN_DIR="/srv/storage/openclaw/jari/extensions/memory-associative"
CONTAINER="openclaw-jari"

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

if [[ "${1:-}" == "--restart" ]]; then
    echo "=== Restarting $CONTAINER ==="
    ssh "$REMOTE" "systemctl --user restart container-$CONTAINER"
    sleep 5
    ssh "$REMOTE" "systemctl --user is-active container-$CONTAINER"
    echo "=== Container restarted ==="
else
    echo "Run with --restart to restart the container, or:"
    echo "  ssh $REMOTE 'systemctl --user restart container-$CONTAINER'"
fi
