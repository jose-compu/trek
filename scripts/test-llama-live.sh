#!/usr/bin/env bash
#
# Bootstrap llama.cpp weights if needed, then run the optional local hierarchy probes.
#
#   ./scripts/test-llama-live.sh
#   ./scripts/test-llama-live.sh mistral
#
# Does not publish. Weights and the llama-server binary stay under ~/.trek.

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$(dirname "$0")/load-dotenv.sh"
load_dotenv .env

./scripts/bootstrap-llama.sh "$@"

ENV_FILE="${TREK_LLAMA_ENV:-$HOME/.trek/llama-live.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
unset PI_NO_LOCAL_LLM

if [[ -n "${XAI_API_KEY:-}" ]]; then
	echo "XAI_API_KEY loaded (${#XAI_API_KEY} chars)"
fi

cd packages/coding-agent
echo "TREK_LLAMA_SERVER=$TREK_LLAMA_SERVER"
echo "TREK_MODELS_DIR=$TREK_MODELS_DIR"
echo "TREK_LLAMA_CTX=$TREK_LLAMA_CTX"
npx vitest --run test/runtime-0.8-live.test.ts --reporter=verbose
