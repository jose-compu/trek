#!/usr/bin/env bash
#
# Download a llama.cpp build that can load the 0.8.0 local suites, and the
# Q4_K_M GGUFs those optional tests spawn (tooling, work-horse, planning).
#
#   ./scripts/bootstrap-llama.sh
#   ./scripts/bootstrap-llama.sh mistral qwen
#
# Writes ~/.trek/llama-live.env. Weights stay in ~/.trek/models (or TREK_MODELS_DIR).
# Secrets come from .env (see .env.example). That file is not copied into llama-live.env.
# Default budget is 4 GiB, for a 24 GB MacBook Air with the OS and editor resident.
# Larger roles are not downloaded. The optional test scores them through the Frontier API.
# Mistral tooling is Qwen3.5-0.8B, the same GGUF as the Qwen tooling role.
# Homebrew llama.cpp 4940 lacks qwen35 and lfm2; this script vendors a newer build
# unless TREK_LLAMA_SERVER already contains those architectures.

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$(dirname "$0")/load-dotenv.sh"
load_dotenv .env

LLAMA_TAG="${TREK_LLAMA_CPP_TAG:-b11262}"
MODELS_DIR="${TREK_MODELS_DIR:-$HOME/.trek/models}"
LLAMA_HOME="${TREK_LLAMA_HOME:-$HOME/.trek/llama.cpp}"
ENV_FILE="${TREK_LLAMA_ENV:-$HOME/.trek/llama-live.env}"
CTX="${TREK_LLAMA_CTX:-2048}"
# 4 GiB. Ministral 3B, Qwen 0.8B/4B, LFM 350M/1.2B, and FunctionGemma 270M fit.
MAX_BYTES="${TREK_LLAMA_MAX_BYTES:-4294967296}"

SUITES=("$@")
if [[ ${#SUITES[@]} -eq 0 ]]; then
	SUITES=(mistral mistral-pro qwen lfm)
fi

want_mistral=false
want_mistral_pro=false
want_qwen=false
want_lfm=false
for suite in "${SUITES[@]}"; do
	case "$suite" in
		mistral) want_mistral=true ;;
		mistral-pro) want_mistral=true; want_mistral_pro=true ;;
		qwen) want_qwen=true ;;
		lfm) want_lfm=true ;;
		*)
			echo "unknown suite: $suite (mistral, mistral-pro, qwen, lfm)" >&2
			exit 1
			;;
	esac
done

need_arch() {
	local bin="$1"
	local needle="$2"
	local dir lib
	# grep -q closes the pipe early. pipefail would treat that SIGPIPE as failure.
	set +o pipefail
	if strings "$bin" 2>/dev/null | grep -q "$needle"; then
		set -o pipefail
		return 0
	fi
	dir="$(dirname "$bin")"
	for lib in "$dir"/*.dylib "$dir"/../lib/*.dylib; do
		[[ -f "$lib" ]] || continue
		if strings "$lib" 2>/dev/null | grep -q "$needle"; then
			set -o pipefail
			return 0
		fi
	done
	set -o pipefail
	return 1
}

binary_ok() {
	local bin="$1"
	[[ -n "$bin" && -x "$bin" ]] || return 1
	if $want_qwen && ! need_arch "$bin" qwen35; then
		return 1
	fi
	if $want_lfm && ! need_arch "$bin" lfm2; then
		return 1
	fi
	return 0
}

platform_asset() {
	local os arch
	os="$(uname -s)"
	arch="$(uname -m)"
	case "$os-$arch" in
		Darwin-arm64) echo "llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz" ;;
		Darwin-x86_64) echo "llama-${LLAMA_TAG}-bin-macos-x64.tar.gz" ;;
		Linux-x86_64) echo "llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz" ;;
		Linux-aarch64) echo "llama-${LLAMA_TAG}-bin-ubuntu-arm64.tar.gz" ;;
		*)
			echo "no llama.cpp asset for $os-$arch; set TREK_LLAMA_SERVER" >&2
			return 1
			;;
	esac
}

install_server() {
	if binary_ok "${TREK_LLAMA_SERVER:-}"; then
		echo "using TREK_LLAMA_SERVER=$TREK_LLAMA_SERVER"
		return
	fi
	local existing=""
	if [[ -d "$LLAMA_HOME/$LLAMA_TAG" ]]; then
		existing="$(find "$LLAMA_HOME/$LLAMA_TAG" -type f -name llama-server -print -quit 2>/dev/null || true)"
	fi
	if binary_ok "$existing"; then
		TREK_LLAMA_SERVER="$existing"
		echo "using $TREK_LLAMA_SERVER"
		return
	fi
	if binary_ok "$(command -v llama-server 2>/dev/null || true)"; then
		TREK_LLAMA_SERVER="$(command -v llama-server)"
		echo "using $TREK_LLAMA_SERVER"
		return
	fi

	local asset url dest
	asset="$(platform_asset)"
	url="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${asset}"
	mkdir -p "$LLAMA_HOME/$LLAMA_TAG"
	dest="$LLAMA_HOME/$LLAMA_TAG/$asset"
	if [[ ! -f "$dest" ]]; then
		echo "downloading $url"
		curl -fL --retry 3 -o "$dest.partial" "$url"
		mv "$dest.partial" "$dest"
	fi
	tar -xzf "$dest" -C "$LLAMA_HOME/$LLAMA_TAG"
	TREK_LLAMA_SERVER="$(find "$LLAMA_HOME/$LLAMA_TAG" -type f -name llama-server -print -quit)"
	if ! binary_ok "$TREK_LLAMA_SERVER"; then
		echo "llama-server at $TREK_LLAMA_SERVER cannot load the requested suites" >&2
		exit 1
	fi
	chmod +x "$TREK_LLAMA_SERVER"
	echo "installed $TREK_LLAMA_SERVER"
	"$TREK_LLAMA_SERVER" --version || true
}

load_hf_token() {
	if [[ -n "${HF_TOKEN:-}" ]]; then
		echo "HF token loaded (${#HF_TOKEN} chars)"
		return
	fi
	echo "no HF token in .env; public downloads only"
}

is_gguf() {
	[[ -f "$1" ]] && [[ "$(head -c 4 "$1")" == "GGUF" ]]
}

too_big_for_laptop() {
	case "$1" in
		Ministral-3-8B-Reasoning-2512|Devstral-Small-2507|Qwen3.5-9B|LFM2.5-8B-A1B) return 0 ;;
		*) return 1 ;;
	esac
}

download_weight() {
	local id="$1"
	local repo="$2"
	local file="$3"
	local dest="$MODELS_DIR/${id}.gguf"
	if too_big_for_laptop "$id"; then
		echo "skip $id (over ${MAX_BYTES} bytes on this laptop; optional test uses the Frontier API)"
		return
	fi
	if is_gguf "$dest"; then
		echo "present $dest"
		return
	fi
	if ! command -v hf >/dev/null 2>&1 && ! command -v huggingface-cli >/dev/null 2>&1; then
		echo "hf or huggingface-cli is required to download $id" >&2
		exit 1
	fi
	local stage="$MODELS_DIR/.src/${id}"
	mkdir -p "$stage"
	echo "downloading $repo $file"
	if command -v hf >/dev/null 2>&1; then
		if [[ -n "${HF_TOKEN:-}" ]]; then
			hf download "$repo" "$file" --local-dir "$stage" --token "$HF_TOKEN"
		else
			hf download "$repo" "$file" --local-dir "$stage"
		fi
	elif [[ -n "${HF_TOKEN:-}" ]]; then
		huggingface-cli download "$repo" "$file" --local-dir "$stage" --token "$HF_TOKEN"
	else
		huggingface-cli download "$repo" "$file" --local-dir "$stage"
	fi
	if ! is_gguf "$stage/$file"; then
		echo "downloaded file is not a GGUF: $stage/$file" >&2
		exit 1
	fi
	ln -sfn ".src/${id}/${file}" "$dest"
	echo "linked $dest"
}

install_server
load_hf_token
mkdir -p "$MODELS_DIR"

if $want_mistral; then
	download_weight "Qwen3.5-0.8B" "unsloth/Qwen3.5-0.8B-GGUF" "Qwen3.5-0.8B-Q4_K_M.gguf"
	download_weight "Ministral-3-3B-Instruct-2512" "unsloth/Ministral-3-3B-Instruct-2512-GGUF" "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
	download_weight "Ministral-3-8B-Reasoning-2512" "unsloth/Ministral-3-8B-Reasoning-2512-GGUF" "Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf"
fi
if $want_mistral_pro; then
	download_weight "Devstral-Small-2507" "unsloth/Devstral-Small-2507-GGUF" "Devstral-Small-2507-Q4_K_M.gguf"
fi
if $want_qwen; then
	download_weight "Qwen3.5-0.8B" "unsloth/Qwen3.5-0.8B-GGUF" "Qwen3.5-0.8B-Q4_K_M.gguf"
	download_weight "Qwen3.5-4B" "unsloth/Qwen3.5-4B-GGUF" "Qwen3.5-4B-Q4_K_M.gguf"
	download_weight "Qwen3.5-9B" "unsloth/Qwen3.5-9B-GGUF" "Qwen3.5-9B-Q4_K_M.gguf"
fi
if $want_lfm; then
	download_weight "LFM2.5-350M" "LiquidAI/LFM2.5-350M-GGUF" "LFM2.5-350M-Q4_K_M.gguf"
	download_weight "LFM2.5-1.2B-Instruct" "LiquidAI/LFM2.5-1.2B-Instruct-GGUF" "LFM2.5-1.2B-Instruct-Q4_K_M.gguf"
	download_weight "LFM2.5-8B-A1B" "LiquidAI/LFM2.5-8B-A1B-GGUF" "LFM2.5-8B-A1B-Q4_K_M.gguf"
fi

mkdir -p "$(dirname "$ENV_FILE")"
cat >"$ENV_FILE" <<EOF
# Generated by scripts/bootstrap-llama.sh. Not a secret.
export TREK_LLAMA_SERVER='$TREK_LLAMA_SERVER'
export TREK_MODELS_DIR='$MODELS_DIR'
export TREK_LLAMA_CTX='$CTX'
export TREK_LLAMA_MAX_BYTES='$MAX_BYTES'
export TREK_LLAMA_LIVE=1
# Server logs go to ~/.trek/logs/llama-server.log, not the terminal.
export TREK_LLAMA_VERBOSE=1
EOF

echo "wrote $ENV_FILE"
echo "TREK_LLAMA_SERVER=$TREK_LLAMA_SERVER"
echo "TREK_MODELS_DIR=$MODELS_DIR"
ls -lh "$MODELS_DIR"/*.gguf
