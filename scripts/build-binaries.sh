#!/usr/bin/env bash
#
# Build trek binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# Usage:
#   ./scripts/build-binaries.sh [--skip-install] [--skip-deps] [--skip-build] [--platform <platform>] [--out <dir>]
#
# Options:
#   --skip-install      Skip npm ci
#   --skip-deps         Skip installing cross-platform dependencies
#   --skip-build        Skip npm run build
#   --platform <name>   Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64)
#   --out <dir>         Output directory (default: packages/coding-agent/binaries)
#
# Output:
#   packages/coding-agent/binaries/
#     trek-darwin-arm64.tar.gz
#     trek-darwin-x64.tar.gz
#     trek-linux-x64.tar.gz
#     trek-linux-arm64.tar.gz
#     trek-windows-x64.zip
#     trek-windows-arm64.zip

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_INSTALL=false
SKIP_DEPS=false
SKIP_BUILD=false
PLATFORM=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --out)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64|windows-arm64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64"
            exit 1
            ;;
    esac
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="packages/coding-agent/binaries"
fi
if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi

if [[ "$SKIP_INSTALL" == "false" ]]; then
    echo "==> Installing dependencies..."
    npm ci --ignore-scripts
else
    echo "==> Skipping npm ci (--skip-install)"
fi

if [[ "$SKIP_DEPS" == "false" ]]; then
    echo "==> Installing cross-platform native bindings..."
    CLIPBOARD_VERSION=$(node -p "require('./packages/coding-agent/package.json').optionalDependencies['@mariozechner/clipboard']")
    # npm ci only installs optional deps for the current platform.
    # Install the bindings in a throwaway tree so --force cannot re-resolve
    # workspace packages (that 404'd on a yanked rollup tarball) or prune tsgo.
    NATIVE_DIR="$(mktemp -d)"
    npm init --yes --prefix "$NATIVE_DIR" >/dev/null
    npm install --prefix "$NATIVE_DIR" --include=optional --force --ignore-scripts \
        @mariozechner/clipboard@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-darwin-arm64@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-darwin-x64@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-linux-x64-gnu@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-linux-arm64-gnu@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-win32-x64-msvc@"$CLIPBOARD_VERSION" \
        @mariozechner/clipboard-win32-arm64-msvc@"$CLIPBOARD_VERSION"
    mkdir -p node_modules/@mariozechner
    cp -R "$NATIVE_DIR/node_modules/@mariozechner/." node_modules/@mariozechner/
    rm -rf "$NATIVE_DIR"
else
    echo "==> Skipping cross-platform native bindings (--skip-deps)"
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
    echo "==> Building all packages..."
    npm run build
else
    echo "==> Skipping package build (--skip-build)"
fi

# logosdb's install is `prebuild-install || node-gyp`. npm ci --ignore-scripts
# does not leave a usable addon, and npm rebuild stops on the workspace
# brace-expansion override. Install the package in a clean prefix so its
# own install script can compile native/logosdb.node for this host.
LOGOSDB_VERSION="$(node -p "require('./packages/coding-agent/package.json').dependencies.logosdb")"
LOGOSDB_PREFIX="${RUNNER_TEMP:-/tmp}/logosdb-host"
rm -rf "$LOGOSDB_PREFIX"
echo "==> Installing logosdb@${LOGOSDB_VERSION} for the host addon"
npm install --prefix "$LOGOSDB_PREFIX" "logosdb@${LOGOSDB_VERSION}"
LOGOSDB_PKG="$LOGOSDB_PREFIX/node_modules/logosdb"
HOST_NODE="$(node -p "process.platform + '-' + process.arch")"
case "$HOST_NODE" in
    darwin-arm64) HOST_PLATFORM=darwin-arm64 ;;
    darwin-x64) HOST_PLATFORM=darwin-x64 ;;
    linux-x64) HOST_PLATFORM=linux-x64 ;;
    linux-arm64) HOST_PLATFORM=linux-arm64 ;;
    win32-x64) HOST_PLATFORM=windows-x64 ;;
    win32-arm64) HOST_PLATFORM=windows-arm64 ;;
    *) HOST_PLATFORM="" ;;
esac
# These three archives must contain native/logosdb.node. The other three
# still build; memory there reports a missing addon instead of the bindings error.
REQUIRED_LOGOSDB_PLATFORMS="windows-x64 linux-x64 darwin-arm64"

echo "==> Building binaries..."
cd packages/coding-agent

# Clean previous builds
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64,windows-arm64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 windows-arm64)
fi

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    # Bun compiled executables only embed worker scripts when they are passed as
    # explicit build entrypoints. The runtime can still use new URL(...), but the
    # worker must be present in the compiled executable. The compile script also
    # rewrites logosdb so bindings() is not called on the virtual B:/~BUN path.
    if [[ "$platform" == windows-* ]]; then
        bun ../../scripts/compile-binary.mjs "$platform" "$OUTPUT_DIR/$platform/trek.exe"
    else
        bun ../../scripts/compile-binary.mjs "$platform" "$OUTPUT_DIR/$platform/trek"
    fi
done

echo "==> Creating release archives..."

# Copy shared files to each platform directory
for platform in "${PLATFORMS[@]}"; do
    cp package.json "$OUTPUT_DIR/$platform/"
    cp README.md "$OUTPUT_DIR/$platform/"
    cp CHANGELOG.md "$OUTPUT_DIR/$platform/"
    cp ../../node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm "$OUTPUT_DIR/$platform/"
    mkdir -p "$OUTPUT_DIR/$platform/theme"
    cp dist/modes/interactive/theme/*.json "$OUTPUT_DIR/$platform/theme/"
    mkdir -p "$OUTPUT_DIR/$platform/assets"
    cp dist/modes/interactive/assets/* "$OUTPUT_DIR/$platform/assets/"
    cp -r dist/core/export-html "$OUTPUT_DIR/$platform/"
    cp -r docs "$OUTPUT_DIR/$platform/"
    cp -r examples "$OUTPUT_DIR/$platform/"
    cp -r domains "$OUTPUT_DIR/$platform/"

    case "$platform" in
        darwin-arm64)
            clipboard_native_package="clipboard-darwin-arm64"
            ;;
        darwin-x64)
            clipboard_native_package="clipboard-darwin-x64"
            ;;
        linux-x64)
            clipboard_native_package="clipboard-linux-x64-gnu"
            ;;
        linux-arm64)
            clipboard_native_package="clipboard-linux-arm64-gnu"
            ;;
        windows-x64)
            clipboard_native_package="clipboard-win32-x64-msvc"
            ;;
        windows-arm64)
            clipboard_native_package="clipboard-win32-arm64-msvc"
            ;;
    esac
    mkdir -p "$OUTPUT_DIR/$platform/node_modules/@mariozechner"
    cp -r ../../node_modules/@mariozechner/clipboard "$OUTPUT_DIR/$platform/node_modules/@mariozechner/"
    cp -r ../../node_modules/@mariozechner/$clipboard_native_package "$OUTPUT_DIR/$platform/node_modules/@mariozechner/"

    # Copy terminal input native helpers next to compiled binaries.
    if [[ "$platform" == darwin-* ]]; then
        mkdir -p "$OUTPUT_DIR/$platform/native/darwin/prebuilds/$platform"
        cp ../tui/native/darwin/prebuilds/$platform/darwin-modifiers.node "$OUTPUT_DIR/$platform/native/darwin/prebuilds/$platform/"
    fi
    if [[ "$platform" == windows-* ]]; then
        if [[ "$platform" == "windows-arm64" ]]; then
            win32_arch_dir="win32-arm64"
        else
            win32_arch_dir="win32-x64"
        fi
        mkdir -p "$OUTPUT_DIR/$platform/native/win32/prebuilds/$win32_arch_dir"
        cp ../tui/native/win32/prebuilds/$win32_arch_dir/win32-console-mode.node "$OUTPUT_DIR/$platform/native/win32/prebuilds/$win32_arch_dir/"
    fi

    # LogosDB addon. bindings() cannot see this folder from B:/~BUN/root.
    addon=""
    if [[ -n "${LOGOSDB_NATIVE_DIR:-}" && -f "$LOGOSDB_NATIVE_DIR/$platform/logosdb.node" ]]; then
        addon="$LOGOSDB_NATIVE_DIR/$platform/logosdb.node"
    elif [[ "$platform" == "$HOST_PLATFORM" && -n "${LOGOSDB_PKG:-}" && -f "$LOGOSDB_PKG/build/Release/logosdb.node" ]]; then
        addon="$LOGOSDB_PKG/build/Release/logosdb.node"
    fi
    if [[ -n "$addon" ]]; then
        mkdir -p "$OUTPUT_DIR/$platform/native"
        cp "$addon" "$OUTPUT_DIR/$platform/native/logosdb.node"
    elif [[ " $REQUIRED_LOGOSDB_PLATFORMS " == *" $platform "* ]]; then
        echo "error: native/logosdb.node is required for $platform"
        exit 1
    else
        echo "warning: no logosdb.node for $platform (memory in that archive needs native/logosdb.node)"
    fi
done

# Create archives
cd "$OUTPUT_DIR"

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        # Windows (zip)
        echo "Creating trek-$platform.zip..."
        (cd "$platform" && zip -r ../trek-$platform.zip .)
    else
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        echo "Creating trek-$platform.tar.gz..."
        mv "$platform" trek && tar -czf trek-$platform.tar.gz trek && mv trek "$platform"
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf "$platform"
    if [[ "$platform" == windows-* ]]; then
        mkdir -p "$platform" && (cd "$platform" && unzip -q ../trek-$platform.zip)
    else
        tar -xzf trek-$platform.tar.gz && mv trek "$platform"
    fi
done

if [[ -n "$HOST_PLATFORM" && " ${PLATFORMS[*]} " == *" $HOST_PLATFORM "* ]]; then
    if [[ "$HOST_PLATFORM" == windows-* ]]; then
        host_bin="$OUTPUT_DIR/$HOST_PLATFORM/trek.exe"
    else
        host_bin="$OUTPUT_DIR/$HOST_PLATFORM/trek"
    fi
    if [[ -x "$host_bin" ]]; then
        echo "==> $HOST_PLATFORM trek --help from an empty directory"
        smoke="$(mktemp -d)"
        (cd "$smoke" && "$host_bin" --help >/dev/null)
        rm -rf "$smoke"
        if [[ " $REQUIRED_LOGOSDB_PLATFORMS " == *" $HOST_PLATFORM "* ]]; then
            test -f "$OUTPUT_DIR/$HOST_PLATFORM/native/logosdb.node"
        fi
    fi
fi

echo ""
echo "==> Build complete!"
echo "Archives available in $OUTPUT_DIR/"
ls -lh *.tar.gz *.zip 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        echo "  $OUTPUT_DIR/$platform/trek.exe"
    else
        echo "  $OUTPUT_DIR/$platform/trek"
    fi
done
