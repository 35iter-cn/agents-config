#!/bin/bash

set -euo pipefail

DOWNLOAD_BASE_URL="https://downloads.claude.ai/claude-code-releases"
DOWNLOAD_DIR="${HOME}/.claude/downloads"
INSTALL_DIR="${HOME}/.local/share/claude/versions"
BIN_LINK="${HOME}/.local/bin/claude"

DRY_RUN=false
TARGET_VERSION=""

usage() {
  cat <<'EOF'
Usage: update-claude.sh [OPTIONS] [VERSION]

Update Claude Code CLI, with automatic retry and resume for unstable networks.

Arguments:
  VERSION         Target version (e.g. 2.1.173). Defaults to latest.

Options:
  --dry-run       Show what would be done without making changes
  --help          Show this help message

Examples:
  update-claude.sh              # Update to latest
  update-claude.sh 2.1.173      # Update to specific version
  update-claude.sh --dry-run    # Preview what would happen
EOF
}

log() {
  echo "[update-claude] $*"
}

error() {
  echo "[update-claude] ERROR: $*" >&2
  exit 1
}

# Detect platform
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) error "Unsupported OS: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac

  # Rosetta 2 on macOS
  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
      arch="arm64"
    fi
  fi

  # musl on Linux
  if [ "$os" = "linux" ]; then
    if [ -f /lib/libc.musl-x86_64.so.1 ] || [ -f /lib/libc.musl-aarch64.so.1 ] || ldd /bin/ls 2>&1 | grep -q musl; then
      echo "linux-${arch}-musl"
      return
    fi
  fi

  echo "${os}-${arch}"
}

# Fetch URL with wget (retry + resume)
fetch() {
  local url="$1"
  local output="${2:-}"

  if [ -n "$output" ]; then
    wget --tries=10 --retry-connrefused --timeout=60 -c -q -O "$output" "$url"
  else
    wget --tries=10 --retry-connrefused --timeout=60 -q -O - "$url"
  fi
}

# Get expected checksum from manifest
get_checksum() {
  local version="$1"
  local platform="$2"
  local manifest

  manifest=$(fetch "${DOWNLOAD_BASE_URL}/${version}/manifest.json")

  if command -v jq >/dev/null 2>&1; then
    echo "$manifest" | jq -r ".platforms[\"${platform}\"].checksum // empty"
  else
    # Pure bash fallback
    manifest=$(echo "$manifest" | tr -d '\n\r\t' | sed 's/ \+/ /g')
    if [[ $manifest =~ \"$platform\"[^}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
      echo "${BASH_REMATCH[1]}"
    fi
  fi
}

main() {
  # Parse args
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --help|-h) usage; exit 0 ;;
      --*) error "Unknown option: $1" ;;
      *)
        if [ -z "$TARGET_VERSION" ]; then
          TARGET_VERSION="$1"
        else
          error "Unexpected argument: $1"
        fi
        shift
        ;;
    esac
  done

  # Detect platform
  local platform
  platform=$(detect_platform)
  log "Platform: $platform"

  # Resolve version
  if [ -z "$TARGET_VERSION" ]; then
    log "Checking latest version..."
    TARGET_VERSION=$(fetch "${DOWNLOAD_BASE_URL}/latest")
    if [[ ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
      error "Failed to get valid version from server. Got: $TARGET_VERSION"
    fi
  fi
  log "Target version: $TARGET_VERSION"

  # Check current version
  local current_version=""
  if [ -x "$BIN_LINK" ]; then
    current_version=$($BIN_LINK --version 2>/dev/null | awk '{print $1}') || true
  fi

  if [ "$current_version" = "$TARGET_VERSION" ]; then
    log "Already at version $TARGET_VERSION. Nothing to do."
    exit 0
  fi
  log "Current version: ${current_version:-(none)}"

  # Compute paths
  local binary_name="claude-${TARGET_VERSION}-${platform}"
  local binary_path="${DOWNLOAD_DIR}/${binary_name}"
  local install_path="${INSTALL_DIR}/${TARGET_VERSION}"

  if [ "$DRY_RUN" = true ]; then
    log "DRY RUN — would do:"
    echo "  mkdir -p $DOWNLOAD_DIR"
    echo "  wget -c $DOWNLOAD_BASE_URL/$TARGET_VERSION/$platform/claude → $binary_path"
    echo "  verify sha256 checksum"
    echo "  cp $binary_path → $install_path"
    echo "  ln -sf $install_path → $BIN_LINK"
    exit 0
  fi

  # Prepare directories
  mkdir -p "$DOWNLOAD_DIR"
  mkdir -p "$INSTALL_DIR"

  # Download if not already present and valid
  local checksum=""
  local needs_download=true

  if [ -f "$binary_path" ]; then
    log "Found existing download, checking checksum..."
    checksum=$(get_checksum "$TARGET_VERSION" "$platform")
    local actual
    actual=$(sha256sum "$binary_path" | cut -d' ' -f1)
    if [ "$actual" = "$checksum" ]; then
      log "Existing download is valid, skipping download."
      needs_download=false
    else
      log "Checksum mismatch, re-downloading..."
    fi
  fi

  if [ "$needs_download" = true ]; then
    log "Downloading Claude Code $TARGET_VERSION for $platform..."
    log "(wget will auto-retry and resume if connection drops)"

    fetch "${DOWNLOAD_BASE_URL}/${TARGET_VERSION}/${platform}/claude" "$binary_path"

    log "Download complete. Verifying checksum..."
    checksum=$(get_checksum "$TARGET_VERSION" "$platform")

    if [ -z "$checksum" ]; then
      error "Could not extract checksum from manifest"
    fi

    local actual
    actual=$(sha256sum "$binary_path" | cut -d' ' -f1)
    if [ "$actual" != "$checksum" ]; then
      rm -f "$binary_path"
      error "Checksum verification failed! Expected: $checksum, Got: $actual"
    fi
    log "Checksum OK: $checksum"
  fi

  # Install
  log "Installing to $install_path..."
  rm -f "$install_path"
  cp "$binary_path" "$install_path"
  chmod +x "$install_path"

  # Update symlink
  ln -sf "$install_path" "$BIN_LINK"

  # Verify
  local installed_version
  installed_version=$($BIN_LINK --version | awk '{print $1}')
  if [ "$installed_version" != "$TARGET_VERSION" ]; then
    error "Version mismatch after install. Expected: $TARGET_VERSION, Got: $installed_version"
  fi

  log "✅ Claude Code updated: ${current_version:-none} → $installed_version"
}

main "$@"
