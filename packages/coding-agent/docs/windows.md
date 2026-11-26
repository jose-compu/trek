# Windows Setup

Pi requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.trek/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

A free-tier Gemini session uses the same bash. See [Gemini free tier](gemini-free-tier.md).

## Compiled trek.exe

Unzip `trek-windows-x64.zip` and run `trek.exe` from that folder. `trek.exe --help` does not use the `bindings` package. That package walks upward from `B:/~BUN/root/trek.exe` and stops because the virtual path has no `package.json`. LogosDB is loaded from `native/logosdb.node` beside `trek.exe`. Keep that file next to the executable. The Windows ARM64 archive does not include it yet. Memory on that build reports a missing addon instead of the virtual-path error. Git Bash is still required for the interactive agent.

## Custom Shell Path

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```
