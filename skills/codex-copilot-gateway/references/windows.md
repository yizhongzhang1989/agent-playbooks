# Native Windows: diagnose the installed route, not a Linux-shaped assumption

Applies to `diagnose` and `verify`, with bounded `install` and `rollback` notes.
Read the selected operation first. This is not a fully validated Windows
fresh-install procedure. Do not switch to WSL, change model/provider, replace
credentials or reinstall an existing proxy just because it differs from Linux.

## Evidence boundary

On 2026-11-25, Windows x64 repository tests and an existing
`copilot-proxy-api@0.10.32` installation were inspected. That existing proxy is
**not** this package's pinned `@jeffreycao/copilot-api@2.8.2` deployment.

- Its configured loopback port initially had no listener. Starting its known
  user-owned launcher restored health 200, no-key 401 and authenticated models 200.
  The original reason the process was absent was not established.
- Refreshing its static catalog changed 11 entries to 13. The actual extension's
  bundled app-server returned those same 13 entries via `model/list`, without
  starting a thread or inference request.
- The default model and reasoning selection were preserved. New catalog entries
  included `gpt-6.2-astra`, `gpt-6.2-sol` and `mai-code-2`; an old entry no longer
  qualified. These are account/date snapshots, not universal model requirements.
- A clean install of this package's locked tools stopped at a package-mirror 404
  for `pkce-challenge@5.0.2`. The official registry also failed TLS negotiation in
  that environment. The four original gateway tests were **not run** on Windows.
  No dependency version, registry setting or TLS verification was changed.
- No paid request was authorized; GUI control was unavailable. Real inference,
  SSE completion, CLI turns, the visible UI, logout and reboot remain untested.

See the [evidence record](../evidence/2026-11-25-windows-x64.json) and open
[findings](../findings.json). A passing maintenance check is not deployment success.

## Identify the actual deployment

Establish whether the extension runs natively, in WSL, over SSH or in a container.
`127.0.0.1` must be interpreted in the app-server's network namespace.
Native default home is `$env:USERPROFILE\.codex`; an explicit `CODEX_HOME`
overrides it. Inspect the relevant provider and authentication fields privately,
not the entire configuration, credential files or logs.

In every fresh PowerShell command, set the working directory and needed variables.
Example, replacing the repository path:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\path\agent-playbooks'
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else {
    Join-Path $env:USERPROFILE '.codex'
}
$Extension = (& code.cmd --locate-extension openai.chatgpt).Trim()
if ($LASTEXITCODE -ne 0 -or -not $Extension) { throw 'Target extension not found.' }
$Codex = Join-Path $Extension 'bin\windows-x86_64\codex.exe'
& $Codex --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Codex version check failed.' }
Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" |
    Select-Object ProcessId, ParentProcessId, ExecutablePath
```

Inspect `model_provider`, that provider's `base_url`, `model_catalog_json`,
`model`, `model_reasoning_effort`, transport flags and authentication mechanism.
The observed deployment used a file-reading authentication command and no
`auth.json`: running that command directly would print its key, so do not do so.
The reference verifier's file-login assumptions do not apply to that layout.

Use the **configured** port; 4141 is not universal. The observed port was 47831.
Check listener addresses and owner executable before starting anything:

```powershell
$Port = 47831 # Replace with the inspected provider's port.
$Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($Listeners.Count -eq 0) {
    Write-Output 'No listener: inspect the intended launcher and startup state.'
} else {
    $Listeners | Select-Object LocalAddress, LocalPort, OwningProcess
    $Listeners | ForEach-Object {
        Get-Process -Id $_.OwningProcess | Select-Object Id, Path
    }
}
```

## Recover the existing service and catalog

1. Back up the exact configuration, static catalog, launcher and relevant startup
   entry to a private directory outside the repository. Record absent files too.
   Do not copy tokens into the repository or change ACLs on unrelated directories.
2. Inspect the existing current-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
   entry or scheduled task, its executable and startup-enabled state. Do not dump
   command lines that might contain credentials or override an organization policy.
3. If no owner is listening and startup is authorized, run the **inspected existing**
   launcher as the target user. Use a persistent host-managed background process or
   a dedicated user terminal; a temporary agent shell is not persistent deployment.
   A Run entry acts at logon, may be delayed, and is not a running-process check or
   a crash supervisor. Preserve it unless its modification was authorized.
4. Allow bounded startup time (for example 30 seconds), then check the exact
   loopback listener and health. Retry only connection-refused during startup,
   report the last failure on timeout, and do not start a second copy.
5. Verify no-key 401 and ordinary-key 200 in memory, with a loopback-only origin,
   no redirects and finite timeouts. Never put keys in command-line arguments,
   logs or diagnostic output. A metadata request may contact GitHub, but is not
   inference.
6. If Codex uses a static `model_catalog_json`, refresh it through the inspected
   deployment's existing metadata-only command after backup. For the observed
   installation this was `npm.cmd run models:refresh` from its own directory.
   Do not assume another proxy has that command. Its `verify` and `verify:codex`
   commands sent many real requests: do **not** run them without quota permission.
7. Preserve policy/picker filtering, supported endpoints, streaming/tool-call
   requirements, per-model reasoning and context limits. The observed native
   Responses catalog omitted five chat-completions-only Gemini models and kept
   three historical compatibility exclusions. Those exclusions were not retested.
   Adding names or removing guards does not make an unsupported model work.
8. Check the target extension's app-server `initialize` then `model/list` response
   against the refreshed file, from an empty directory. Do not use `thread/start`
   or `turn/start` for a metadata check; stop that diagnostic child afterwards.
   This checks the actual backend's ability to load the catalog, not the visible UI.
9. Reload only an appropriate VS Code window when the user can tolerate it, then
   open **Open Codex Sidebar** and start a new conversation. Existing app-servers
   may retain the old catalog. Do not interrupt unrelated windows or claim a
   reload/GUI success from a newly launched diagnostic backend.

The observed repair left the existing startup entry and Codex provider unchanged.
It did not add a scheduler, automatic catalog refresh, new login or another proxy.
If lifecycle supervision is required, design and authorize a Windows scheduled
task/service separately; reboot/logout behavior needs actual post-event checks.

## Reference package on Windows

The common helpers now verify Windows ACLs instead of trusting POSIX mode bits.
`chmod`, `mode: 0o600` and a successful file write do not establish Windows privacy.
Only the current user's SID and SYSTEM may have allow ACEs; the owner must also
be one of those identities. This conservative policy deliberately rejects broader
ACLs instead of skipping permission checks. Administrator takeover is outside it.

For an authorized **new** empty runtime root outside the repository, create its
gateway directory before writing credentials:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\path\agent-playbooks'
$SkillRoot = Join-Path (Get-Location) 'skills\codex-copilot-gateway'
$Root = Join-Path $env:LOCALAPPDATA 'CodexCopilotGateway'
if (Test-Path -LiteralPath $Root) { throw 'Existing runtime: diagnose before installing.' }
New-Item -ItemType Directory -Path $Root | Out-Null
$PrivateDirectory = & "$SkillRoot\scripts\windows-acl.ps1" -Action CreateDirectory -Path "$Root\gateway"
if ($PrivateDirectory -ne 'private') { throw 'Private directory creation failed.' }
node "$SkillRoot\scripts\create-gateway-config.mjs" --root $Root
if ($LASTEXITCODE -ne 0) { throw 'Gateway configuration creation failed.' }
```

The ACL helper refuses an existing directory and never repairs permissions during
`Check`. Its new directory has protected inheritable user/SYSTEM rules, so secrets
created inside inherit the intended ACL. Review client files and backups separately.
It loads the ACL module from the running PowerShell's own installation, avoiding
an incompatible PowerShell 7 module path inherited by a Windows PowerShell child.
Do not bypass execution policy if the host disallows running this helper.

Other necessary adaptations, not a claim of a completed Windows installation:

- Use the authorized Windows Node binary and Windows archives, not Linux tarballs.
  Do not silently change versions to work around an installation failure.
- Use `npm.cmd`/`code.cmd` from PowerShell when appropriate. For programmatic npm
  execution, the maintenance runner uses `node` plus npm's `npm_execpath`, not
  `execFile("npm")` or a shell with interpolated arguments. Run it via
  `npm.cmd run test:gateway`, not directly with `node`.
- Set `COPILOT_API_HOME` explicitly for each reference-gateway invocation. A
  launcher must set its working directory, binary path and environment itself.
  This package does not yet provide a validated Windows persistent-service installer.
- Windows paths in TOML should use literal single-quoted strings or escaped
  backslashes. Check the actual client's parsed configuration, not just file text.
- Repository text uses LF via `.gitattributes`; SHA-256 evidence covers exact
  bytes. Do not rewrite evidence hashes to bless an autocrlf-converted checkout.
  Reconcile a clean checkout or normalize reviewed files to LF first, preserving
  local edits. Dependency or patch content changes still require new evidence.
- The repository's Bash syntax checks consume stdin, avoiding Windows path
  interpretation by Bash. Windows resource-escape tests use a directory junction,
  which does not require enabling developer mode or administrator symlink rights.

Run `npm.cmd run validate` and `npm.cmd test`. The clean
`npm.cmd run test:gateway` additionally needs the exact locked public packages.
Report registry/TLS failures explicitly; do not disable TLS, replace versions,
copy an installed dependency tree or silently skip the integration check.

## Remaining verification

Real SSE and CLI checks require explicit permission for each request and only
fixed non-sensitive text. Use an empty directory, inspect global hooks/instructions,
retain approval/sandbox protections and enforce the operation's timeout.
Do not use the project as a probe. GUI inspection requires the actual target
window and user/host permission; a CLI result does not substitute for it.

## Rollback

Restore only this run's backed-up files and exact startup value after checking
for later changes. Preserve their ACLs, other providers, credentials and history.
Service interruption needs authorization: identify the owned process and stop
that specific PID or host-managed process, never all `node`, `pwsh`, `Code` or
`codex` processes. Removing a Run entry does not stop a running proxy.
Do not delete an installation root or user profile to undo a catalog refresh.
