# Install: default Codex + local Copilot gateway

Operation: `install`. Source: `source-guide` in [sources.json](../sources.json).
This is a supervised fresh-install procedure, not an unattended installer.
Do not run it to repair an existing installation without first diagnosing it.

## S00_CONFIRM_SCOPE

Requires: target user/machine, account eligibility and permission to install.
Choose default `~/.codex`, ordinary local VS Code and loopback-only service.
Confirm changes to existing login, extension version and background persistence.
Do not automatically downgrade VS Code itself or modify other extensions.

Validated platform: Ubuntu 22.04.5 LTS / x86_64. Other platforms and isolated
clients are described, but not certified, in [optional.md](optional.md).
VS Code must already be installed with a working `code` command;
see the official Linux installation source if it is missing.

From the repository root, establish explicit paths. For a separately distributed
skill, set `SKILL_ROOT` to that skill directory instead. Re-establish these
variables and the dedicated PATH in **every new shell**.

```bash
set -euo pipefail
umask 077
export SKILL_ROOT="$(realpath skills/codex-copilot-gateway)"
export ROOT="$HOME/.local/share/codex-copilot"
```

Inspect the environment and port:

```bash
for command_name in bash curl tar xz sha256sum realpath awk mktemp timeout ss systemctl loginctl code; do
  command -v "$command_name" >/dev/null || {
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done
systemctl --user show-environment >/dev/null
code --version
code --list-extensions --show-versions
ss -lntp 'sport = :4141'
loginctl show-user "$USER" -p Linger --no-pager
```

Pass: intended user session and platform are known; no unknown port owner.
Fail: stop for adaptation, missing dependencies or port conflicts. Never kill
an unknown process or use `sudo systemctl --user`.

## S10_CREATE_FRESH_RUNTIME

Requires: S00 passed. Effects: new private installation directories only.
Existing gateway paths mean this is not a fresh installation:

```bash
for existing in "$ROOT" "$HOME/.local/bin/copilot-gateway" \
  "$HOME/.config/systemd/user/copilot-gateway.service"; do
  if [ -e "$existing" ] || [ -L "$existing" ]; then
    printf 'Existing installation path; inspect before proceeding: %s\n' "$existing" >&2
    exit 1
  fi
done
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) NODE_PLATFORM=linux-x64 ;;
  *) printf 'This validated procedure is Linux x86_64 only.\n' >&2; exit 1 ;;
esac
mkdir -p "$ROOT/runtime" "$ROOT/downloads" "$ROOT/tools/patches" \
  "$ROOT/tools/test" "$ROOT/gateway" "$HOME/.local/bin"
chmod 700 "$ROOT/gateway"
NODE_VERSION=v24.22.2
NODE_ARCHIVE="node-${NODE_VERSION}-${NODE_PLATFORM}.tar.xz"
(
  cd "$ROOT/downloads"
  curl --fail --location --show-error --retry 2 --connect-timeout 15 --max-time 600 \
    --output "$NODE_ARCHIVE" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ARCHIVE"
  curl --fail --location --show-error --retry 2 --connect-timeout 15 --max-time 120 \
    --output SHASUMS256.txt "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  awk -v file="$NODE_ARCHIVE" '$2 == file { print; found = 1 } END { if (!found) exit 1 }' \
    SHASUMS256.txt > NODE-SHASUM.txt
  sha256sum --check NODE-SHASUM.txt
  tar -xJf "$NODE_ARCHIVE" -C "$ROOT/runtime" --strip-components=1
)
export PATH="$ROOT/runtime/bin:$HOME/.local/bin:$PATH"
node --version
npm --version
```

The bootstrap literal is checked against [versions.json](../versions.json).
Checksum failure is fatal; never disable TLS. A partially completed installation
must be inspected before resuming; do not delete the whole root to retry.

## S20_INSTALL_LOCKED_TOOLS

Copy only the maintained manifest, lockfile, patch and test. Do not copy
`node_modules`, runtime state or credentials from another machine.

```bash
for file in package.json package-lock.json \
  patches/@jeffreycao+copilot-api+2.8.2.patch test/replication.test.mjs; do
  (
    set -o noclobber
    cat "$SKILL_ROOT/tools/$file" > "$ROOT/tools/$file"
  )
done
npm --prefix "$ROOT/tools" ci --no-audit --no-fund
node --check "$ROOT/tools/node_modules/@jeffreycao/copilot-api/dist/codex-responses-error.js"
"$ROOT/tools/node_modules/.bin/codex" --version
```

Pass: `patch-package` applies the 2.8.2 patch and the independent CLI reports
0.166.0. Stop on patch failure; do not use `--ignore-scripts`, `sudo npm`,
unlocked installs or `latest`.

## S30_CONFIGURE_GATEWAY_AND_AUTHORIZE

Requires: S20 passed. Generate separate random client/admin keys locally.
The [gateway example](../assets/templates/gateway.config.example.json) has empty
credentials and is **not a deployable configuration**.

```bash
(
  set -o noclobber
  cat "$SKILL_ROOT/assets/templates/copilot-gateway.sh" > "$HOME/.local/bin/copilot-gateway"
)
chmod 700 "$HOME/.local/bin/copilot-gateway"
node "$SKILL_ROOT/scripts/create-gateway-config.mjs" --root "$ROOT"
npm --prefix "$ROOT/tools" test
"$HOME/.local/bin/copilot-gateway" --help
```

Pass: four original tests pass. Coverage is error-event conversion and basic
configuration only, not the entire transport. The wrapper fixes
`COPILOT_API_HOME`; bypassing it can select another credential directory.

Have the account holder run device authorization locally:

```bash
"$HOME/.local/bin/copilot-gateway" auth login --provider copilot
if [ ! -s "$ROOT/gateway/github_token" ]; then
  printf 'Authorization has not been saved; finish the login command first.\n' >&2
  exit 1
fi
chmod 600 "$ROOT/gateway/github_token" "$ROOT/gateway/config.json"
```

The browser confirmation is not enough: wait for the command to save the token
and exit. A zero-byte file is not authorization. Do not request passwords/PATs,
print the token, use `--show-token`, list API key values, or run concurrent logins.

## S40_ENABLE_USER_SERVICE

Requires: S30 passed; authorization to enable persistent background service.
Recheck 4141 immediately before starting. Never expose `0.0.0.0`.

```bash
ss -lntp 'sport = :4141'
mkdir -p "$HOME/.config/systemd/user"
(
  set -o noclobber
  cat "$SKILL_ROOT/assets/templates/copilot-gateway.service" \
    > "$HOME/.config/systemd/user/copilot-gateway.service"
)
systemd-analyze --user verify "$HOME/.config/systemd/user/copilot-gateway.service"
systemctl --user daemon-reload
systemctl --user enable --now copilot-gateway.service
ready=false
for attempt in {1..30}; do
  if curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 2 \
    --output /dev/null http://127.0.0.1:4141/; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  printf 'Gateway is not ready; inspect local service state.\n' >&2
  exit 1
fi
systemctl --user is-active copilot-gateway.service
systemctl --user is-enabled copilot-gateway.service
ss -lntp 'sport = :4141'
```

Enable lingering with administrator permission. In a user terminal use normal
interactive sudo; with an agent host offering a secure askpass flow use:

```bash
sudo -A loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger --no-pager
```

If that host lacks askpass, have the user execute the interactive command;
never collect a password yourself. `enabled` plus `Linger=yes` is a persistence
configuration, not proof that an actual reboot/logout test passed.

Before switching Codex, run [verify.md](verify.md) S20 (catalog) and, when
authorized, S30 (fixed-text SSE) without `--codex-home`. Confirm the model and
both probe/normal reasoning levels. No entitlement means stop and choose an
authorized model with the user, not fabricate a mapping.

## S50_BACK_UP_AND_CONNECT_DEFAULT_CODEX

Effects: changes the target user's default login/provider. Confirm this scope.
Inspect existing configuration, global instructions, MCP and hooks locally;
do not upload them. Existing keyring login is not backed up by copying auth.json.

```bash
mkdir -p "$HOME/.codex"
chmod 700 "$HOME/.codex"
backup_dir="$(mktemp -d "$HOME/.codex/backup-before-copilot.XXXXXXXX")"
: > "$backup_dir/original-state.txt"
for file in config.toml auth.json; do
  if [ -f "$HOME/.codex/$file" ]; then
    cp -p "$HOME/.codex/$file" "$backup_dir/$file"
    chmod 600 "$backup_dir/$file"
    printf 'present: %s\n' "$file" >> "$backup_dir/original-state.txt"
  else
    printf 'absent: %s\n' "$file" >> "$backup_dir/original-state.txt"
  fi
done
code --list-extensions --show-versions > "$backup_dir/extensions-before.txt"
printf 'Private backup directory: %s\n' "$backup_dir"
```

Also record the extension's original pin/update state and original lingering
state in this private backup. Do not publish the backup or its private path.

Only when the default configuration is absent:

```bash
(
  set -o noclobber
  cat "$SKILL_ROOT/assets/templates/codex.config.toml" > "$HOME/.codex/config.toml"
)
chmod 600 "$HOME/.codex/config.toml"
```

Otherwise merge the template's relevant TOML fields without duplicate tables,
preserving unrelated providers, project policy, MCP and other settings.
If the selected model/effort differs from the reference, update the target
configuration and verification arguments together, not the shared template.

Important fields: Responses `base_url` ends in `/v1`, catalog URL ends in
`/models`, `requires_openai_auth=true` reads the local API-key login,
`supports_websockets=false`, retries=4, file credentials and API-key discovery.
Do not mix `env_key` into this provider. Retain appropriate approval/sandbox
settings; disabling them is not required for connectivity.

Save only the ordinary gateway key through stdin:

```bash
export CODEX_HOME="$HOME/.codex"
node -e '
const fs = require("node:fs");
const key = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).auth?.apiKeys?.[0];
if (typeof key !== "string" || !key) throw new Error("Missing gateway API key");
process.stdout.write(key);
' "$ROOT/gateway/config.json" | "$ROOT/tools/node_modules/.bin/codex" login --with-api-key
chmod 600 "$CODEX_HOME/auth.json"
node "$SKILL_ROOT/scripts/verify.mjs" --root "$ROOT" --codex-home "$CODEX_HOME"
```

Never run the key-producing half alone or record it with `tee`. Saving a key
does not validate account access; default configuration and real client probes
still need verification.

## S60_PIN_EXTENSION_AND_ACCEPT

Requires: confirmed version change if an existing extension differs.
Use `code --install-extension` with the exact ID/version from `versions.json`;
for the reference combination:

```bash
code --install-extension openai.chatgpt@26.1106.51428
```

If already-running windows reinstall a newer version, select the exact version
through **Install Another Version**, then reload only the test window. Verify
the actual version, per-extension pin and active backend, not just one directory.
Do not disable all extension updates or edit VS Code's internal state database.

Finish [verify.md](verify.md), including two explicit CLI paths and the actual
VS Code UI. Do not click ChatGPT login and replace the saved gateway key.
All mandatory acceptance items must pass; otherwise return `waiting_for_user`,
`blocked` or `failed`, with remaining checks. Reboot/logout are separate,
explicitly authorized tests and must remain untested if not performed.
