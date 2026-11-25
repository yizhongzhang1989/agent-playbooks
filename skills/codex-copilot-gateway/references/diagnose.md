# Diagnose: inspect the failing layer before changing state

Operation: `diagnose`. Default effects: local reads. Ask for the symptom and
where the extension process runs. Do not treat this operation as authorization
to install, rotate credentials, downgrade software or restart services.

## S00_IDENTIFY

Confirm target user, ordinary/isolated Codex home, local/remote/container host,
actual binary paths, versions and recent changes. Preserve existing configuration.
Read [versions.json](../versions.json) for the reference combination, not a rule
that all other versions must be downgraded.

Inspect service properties, listener and file metadata without dumping logs,
tokens or full process environments:

```bash
systemctl --user show copilot-gateway.service --no-pager \
  -p LoadState -p ActiveState -p SubState -p MainPID -p UnitFileState
ss -lntp 'sport = :4141'
loginctl show-user "$USER" -p Linger --no-pager
code --version
code --list-extensions --show-versions
```

## S10_ROUTE_BY_OBSERVATION

| Observation | Next check | Do not do |
|---|---|---|
| node/npm/codex absent on PATH | Dedicated runtime and explicit binary paths | Install unrelated global versions |
| Port4141 refused | Service state, listener, bounded startup | Replace API keys |
| Port4141 owned by another process | Identify owner and intended deployment | Kill it or start duplicate gateways |
| User systemd bus unavailable | Real target user session and systemd support | Use sudo systemctl --user |
| Browser authorized, token file empty | Wait for login terminal to save credentials and exit | Print token or start concurrent logins |
| No-key models request returns200 | API-key list, correct COPILOT_API_HOME | Call unauthenticated access success |
| Authenticated401 | Distinguish local key mismatch and upstream authorization expiry | Try admin/GitHub/OpenAI keys indiscriminately |
| Missing model/effort | Real Codex catalog, account capabilities | Invent mappings or silently change defaults |
| CLI passes, plugin fails | Actual extension host, HOME, backend version, stale processes | Export a variable in an unrelated shell |
| Only Chat is visible | Command palette → Open Codex Sidebar | Reauthorize the gateway |
| Pinned version changed | Install Another Version in UI, reload, check actual backend | Edit internal VS Code state or disable all updates |
| Publisher update toggle greyed out | Individual versus publisher update controls | Assume the gateway failed |
| stream closed before response.completed | Patch, terminal event and original failure layer | Fabricate success or retry indefinitely |
| UND_ERR_CONNECT_TIMEOUT /504 | Gateway→upstream network, DNS and header wait | Declare that the model is necessarily overloaded |
| ENOTFOUND/EAI_AGAIN /502 | DNS; other connection codes identify other network failures | Disable TLS checks |
|429/capacity refusal | Original status, Retry-After, account quota | Reinstall or evade rate limits |
|misalignment_policy_violation | Actual upstream policy refusal | Treat it as a retryable network failure |
|Long session/compaction disconnect | Both WebSocket settings, version and transport | Infer long-session support from a short smoke test |
|Service stops after logout | enabled + Linger=yes and actual user session | Stack temporary background processes |
|Reinstall lost compatibility fix | lockfile, postinstall and stored patch | Patch node_modules without a maintained patch |

Use the offline or catalog phases of [verify.md](verify.md) only as appropriate.
Catalog access may contact upstream metadata. A live probe requires explicit
account/quota permission and only fixed non-sensitive text.

## S20_EXPLAIN_AND_STOP_OR_REPAIR

Return observations, the localized failure layer, supported explanation and
remaining uncertainty. Known network failures become502/504; real upstream
HTTP errors, Retry-After and refusals must remain distinguishable.

Logs can contain request/account data. Inspect locally and disclose only a
sanitized error code/message. Never copy full journal output into public issues.

Repair is a new bounded action: explain files/services affected, back up relevant
state, confirm scope, then verify the exact failed layer and required downstream
acceptance. Preserve unrelated changes. Repeated failure is a reason to stop and
research the missing condition, not to broaden access or weaken controls.

## Maintenance decisions

- Dependency reinstall uses the existing lockfile and replaces node_modules;
  schedule a maintenance window and stop the known service first.
- The patch targets the2.8.2 build filenames; upgrades need renewed compatibility
  checks, not forced patch application or ignoring failures.
- Key rotation changes both gateway and client login. Wait for active requests,
  keep backups private, restart only after authorization, then revalidate.
- Reauthorize expired GitHub credentials through the normal device flow, never
  by posting a token into chat.
- The reference uses two300000ms upstream limits: header wait and stream idle
  wait, not a universal five-minute session limit.
