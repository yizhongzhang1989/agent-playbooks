# Verify: phase checks are not whole-task success

Operation: `verify`. Read the mandatory acceptance IDs in
[contract.json](../contract.json). A probe's JSON `status=passed` only applies to
that phase; it does not certify the plugin, a new machine or persistence.

The shell/service examples below target Linux. Native Windows uses
[windows.md](windows.md), Windows ACLs and the extension's
`bin\windows-x86_64\codex.exe`. The scripts support Windows ACL checks for the
reference gateway layout, not arbitrary pre-existing proxies or authentication
commands. Metadata-only `model/list` success does not satisfy A_CLI or A_UI.

In each fresh shell, set `SKILL_ROOT` to the actual skill directory,
`ROOT="$HOME/.local/share/codex-copilot"` and
`PATH="$ROOT/runtime/bin:$HOME/.local/bin:$PATH"`. Run from the repository root
when using the following initialization:

```bash
set -euo pipefail
export SKILL_ROOT="$(realpath skills/codex-copilot-gateway)"
export ROOT="$HOME/.local/share/codex-copilot"
export PATH="$ROOT/runtime/bin:$HOME/.local/bin:$PATH"
```

## S10_OFFLINE_AND_SERVICE

Effects: read local state only; no model request, no restart.

```bash
npm --prefix "$ROOT/tools" test
node "$SKILL_ROOT/scripts/verify.mjs" --root "$ROOT" --codex-home "$HOME/.codex"
systemctl --user show copilot-gateway.service --no-pager \
  -p ActiveState -p SubState -p UnitFileState -p MainPID
loginctl show-user "$USER" -p Linger --no-pager
ss -lntp 'sport = :4141'
```

Pass: four original tests; private mode-600 regular files, nonempty authorization
file, ordinary client key match; active/enabled, Linger=yes and loopback-only
listener. The script does not parse/verify the full client's TOML configuration;
inspect relevant fields against the template and verify them through real clients.
During gateway-only installation omit `--codex-home` until the client is configured.

Optional patch audit if `git` is installed:

```bash
git -C "$ROOT/tools" apply --reverse --check \
  patches/@jeffreycao+copilot-api+2.8.2.patch
```

This only checks; never remove `--check`. Failure is not permission to reinstall
dependencies while a service is serving requests.

## S20_CATALOG

Effects: local authenticated HTTP requests; gateway may access upstream metadata.

```bash
node "$SKILL_ROOT/scripts/verify.mjs" --root "$ROOT" --mode catalog
```

Pass: health marker, unauthenticated401, authenticated200, OpenAI `data` and Codex
`models` lists, selected model and both normal/probe reasoning capabilities.
Counts are not fixed. Codex User-Agent selects the Codex catalog shape.
Use `--model`, `--effort`, `--probe-effort` for an explicitly selected alternative;
defaults come from [versions.json](../versions.json), not from account entitlement.

Failure: identify local versus upstream authorization, unsupported model/effort,
network or quota. Do not try random credentials or silently change the model.
`--base-url` is limited to HTTP `127.0.0.1` origins and never follows redirects.

## S30_LIVE_SSE

Requires: permission for one account/model request. Uses only fixed text,
`store=false`, no tools or files. It consumes quota.

```bash
node "$SKILL_ROOT/scripts/verify.mjs" --root "$ROOT" \
  --mode live --allow-paid-request
```

Pass: HTTP200, SSE, real `response.completed`, exactly `CODEX_PROXY_OK`, and no
`error`, `response.failed` or `response.incomplete` event. Timeout is120seconds,
no automatic probe retry. Success at HTTP alone or partial text is insufficient.
Failures expose safe codes, not raw upstream bodies or secret values.

## S40_CLI

Requires: S10-S30 passed and permission for each CLI model call.
Check global instructions/MCP/hooks before the probe: an empty folder does not
hide global settings. Do not read project files to test connectivity.

Choose the independent binary explicitly:

```bash
export CODEX_PROBE_CLI="$ROOT/tools/node_modules/.bin/codex"
"$CODEX_PROBE_CLI" --version
```

Then run this block:

```bash
(
  set -euo pipefail
  umask 077
  probe_dir="$(mktemp -d -t codex-proxy-smoke.XXXXXXXX)"
  trap 'rm -f -- "$probe_dir/final.txt"; rmdir -- "$probe_dir"' EXIT
  env -u CODEX_HOME -u OPENAI_API_KEY -u CODEX_API_KEY \
    timeout --signal=TERM --kill-after=10s 180s \
    "$CODEX_PROBE_CLI" exec \
      -C "$probe_dir" --skip-git-repo-check --ephemeral --sandbox read-only \
      --output-last-message "$probe_dir/final.txt" \
      'Reply exactly CODEX_PROXY_OK. Do not call tools or access files.'
  node --input-type=module - "$probe_dir/final.txt" <<'JS'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
assert.equal((await readFile(process.argv[2], "utf8")).trim(), "CODEX_PROXY_OK");
console.log(JSON.stringify({ status: "passed", check: "cli_exact_marker" }));
JS
)
```

Pass: CLI exits0 and exact marker; the default configuration's normal reasoning
effort is exercised. Do not assume a `codex` found on PATH is this binary.
The180second bound belongs to this probe, not the gateway's overall timeout.

Repeat for the extension's actual bundled binary on Linux x86_64:

```bash
extension_dir="$(code --locate-extension openai.chatgpt)"
if [ -z "$extension_dir" ]; then
  printf 'Codex extension not found in this environment.\n' >&2
  exit 1
fi
export CODEX_PROBE_CLI="$extension_dir/bin/linux-x86_64/codex"
"$CODEX_PROBE_CLI" --version
```

Run the same probe block again. Expected reference versions: independent0.166.0,
extension26.1106.51428 and bundled0.167.0-alpha.4.1.

## S50_VSCODE_UI

Requires: actual target extension loaded and user/GUI interaction capability.

```bash
ui_probe_dir="$(mktemp -d -t codex-proxy-ui.XXXXXXXX)"
code --new-window "$ui_probe_dir"
printf 'Private temporary test folder: %s\n' "$ui_probe_dir"
```

In that window only:

1. Reload with `Developer: Reload Window`; do not interrupt unrelated windows.
2. Run **Open Codex Sidebar** from the command palette. Built-in Chat is different.
3. Select the authorized model and intended normal reasoning strength.
4. Attach no files/selection. Send the fixed CLI probe prompt and wait for complete
   success, with no login prompt or stream error.
5. Confirm the installed version and active app-server come from the target
   extension and use the intended HOME. Inspect only safe metadata, not full
   process environments or arguments that may contain credentials.

On VS Code1.147.0, **Auto Update All (From Publisher)** can be checked and disabled
when global auto-update is on; that is not the individual extension pin.
Use the extension's own version/update controls, not global update disabling.
Organization-enforced updates must not be bypassed.

After confirming success, close the test window and `rmdir -- "$ui_probe_dir"`.
If nonempty, inspect; do not recursively delete unknown contents.
Missing UI confirmation means `waiting_for_user`, even if both CLIs passed.

## S60_OPTIONAL_PERSISTENCE

A service restart interrupts requests: obtain appropriate authorization and
wait until idle. Restart, repeat service/catalog checks, and record the result.
Full-machine reboot and user logout need separate permission and actual
post-event checks. Do not infer either from `enabled` or `Linger=yes`.

Return the contract's operation/status/checks/remaining shape. Include actual
versions and untested items in a private report; publish only approved,
sanitized evidence, never credentials, raw sessions or machine-specific paths.
