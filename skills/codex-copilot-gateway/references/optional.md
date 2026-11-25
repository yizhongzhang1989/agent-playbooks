# Optional paths and boundaries

Read only when the user's goal requires these paths. They are not certified by
the source installation or repository offline tests.

## Different platforms or remote extension hosts

- Other Linux: verify CPU, libraries, certificates and user systemd before
  adapting. Selecting an arm64 Node archive does not validate the whole stack.
- WSL2: systemd is the closest route, but first locate Codex and gateway in the
  same machine/network namespace. Native Windows cannot reuse Bash/systemd verbatim.
- Native Windows: see [windows.md](windows.md) for tested maintenance helpers and
  existing-proxy metadata recovery, plus the still-unverified installation/live/UI scope.
- macOS: needs its own runtime and launchd/service procedure; not implemented here.
- Remote SSH/containers: `127.0.0.1` refers to the process's own namespace.
  Do not solve namespace separation by exposing an authenticated service publicly.

## Preserve the original default login with an isolated CLI

This changes the goal: ordinary VS Code will not automatically use this separate
home. Use only after the user chooses isolation.

1. Create a private `$ROOT/codex` directory and place a copy of the Codex template
   there, not over `~/.codex/config.toml`.
2. In that provider set `requires_openai_auth=false` and
   `env_key="GITHUB_COPILOT_API_KEY"`. Choose an authorized model/effort.
3. A private wrapper uses the dedicated runtime, sets `CODEX_HOME="$ROOT/codex"`,
   reads the ordinary gateway key locally and exports it only to that child.
   Never print its environment or put the key in command-line arguments.
4. Test that wrapper from an empty directory and report its result separately.
   The default-home CLI test is not evidence that the isolated home works.

No separate wrapper is installed or claimed tested by this skill's main flow.
Do not invent one silently while debugging a default-home plugin.

## Reuse a gateway through an authorized SSH tunnel

This is not an independent installation. With account/network approval, use a
loopback SSH local forward rather than a public gateway listener:

```bash
ssh -N -T \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:4142:127.0.0.1:4141 \
  your-user@your-gateway-host
```

Replace the example target. The client uses `/v1` and `/models` on local4142 and
still needs an authorized ordinary gateway key transferred through an approved
channel, never an admin key. Tunnel loss should fail requests. The verification
script can target `--base-url http://127.0.0.1:4142`; this is not an end-to-end
validation of SSH session management.

## Reproduction and publication

Clone a known commit/tag containing the entire skill package. Its tools manifest,
lockfile, patch and four tests are the reproducible source; `npm ci` belongs in
an isolated deployment/test root, not in an already running installation.
Package only maintained source, templates and sanitized evidence.

Do not publish runtime/config files with keys, GitHub credentials, databases,
logs, chats, VS Code profiles, private backups, environment snapshots or machine
identifiers. Ignore rules do not erase Git history; revoke/rotate an exposed
credential before cleaning history. Preserve third-party license notices.
