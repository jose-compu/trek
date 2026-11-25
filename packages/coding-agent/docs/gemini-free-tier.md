# Gemini free tier

Use a Google AI Studio key with no billing account. Trek reads it from `GEMINI_API_KEY` and calls the Gemini API as provider `google`.

## Key

1. Open [aistudio.google.com](https://aistudio.google.com) with a Google account.
2. Open **Get API key**. A new account gets a default project and key.
3. Do not link a billing account if you want to stay on the free tier.

Free-tier quotas and the model list change. The [pricing page](https://ai.google.dev/gemini-api/docs/pricing) is the source of truth. OMR also lists a free plan that includes Gemini 3.8 Flash, Gemini 3.5 Flash-Lite, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini Embedding 2, and Gemma 4. Embedding models are not a Trek chat model.

## What answered

Checked 2026-11-25. `GET https://generativelanguage.googleapis.com/v1beta/openai/models` with `Authorization: Bearer $GEMINI_API_KEY` returned 200. The same key then called `POST .../openai/chat/completions`:

| Model | Result |
| --- | --- |
| `gemini-3.5-flash-lite` | 200 in about 1 second |
| `gemini-3.8-flash` | No response body before a 20s and a 45s timeout |
| `gemini-3.7-flash` | No response body before a 20s timeout |
| `gemini-2.5-flash` | 404, closed to new users |

A native `generateContent` call for `gemini-3.8-flash` also returned no body. The same native call for `gemini-3.5-flash-lite` returned 200 in about 5 seconds. That is the call Trek's `google` provider makes. Do not start Trek on `gemini-3.8-flash` or `gemini-3.7-flash` until a one-line completion returns. The OpenAI-compatible route is only a check. Trek's `google` provider keeps using the Gemini API, not that route. Compatibility is partial: some OpenAI parameters are not accepted.

## Run

Pin the model. Otherwise a saved hierarchy in `~/.trek/models.yaml` can select another provider.

### macOS and Linux

```bash
export GEMINI_API_KEY="your-key"
cd /tmp
trek --provider google --model gemini-3.5-flash-lite
```

From a checkout, after `npm run build` in `packages/coding-agent`:

```bash
node packages/coding-agent/dist/cli.js --provider google --model gemini-3.5-flash-lite
```

### Windows

Install [Git for Windows](https://git-scm.com/download/win) so Trek has bash. See [Windows](windows.md). In Git Bash:

```bash
export GEMINI_API_KEY="your-key"
cd /tmp
trek --provider google --model gemini-3.5-flash-lite
```

In PowerShell, for the current window only:

```powershell
$env:GEMINI_API_KEY = "your-key"
trek --provider google --model gemini-3.5-flash-lite
```

In `cmd.exe`:

```bat
set GEMINI_API_KEY=your-key
trek --provider google --model gemini-3.5-flash-lite
```
