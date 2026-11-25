# Roll back only the authorized deployment changes

Operation: `rollback`. This procedure was documented but not executed during
the source installation. Do not describe it as a tested recovery.

For native Windows, use the [Windows rollback notes](windows.md#rollback).
Do not run systemd/lingering commands or remove an unrelated startup entry.

## S00_ESTABLISH_ORIGINAL_STATE

Requires: explicit rollback target and access to the private backup created
on this machine. Read its presence/absence records, original extension/update
state and original lingering state. Check for changes made since the backup.

Fail: if provenance or desired final state is unknown, stop. A backup path from
another machine is not a fallback. Never delete all of `~/.codex`, an installation
root, a workspace or a user's VS Code profile.

## S10_STOP_THE_KNOWN_SERVICE

Effects: service interruption; confirm scope and wait for active requests.
For a service newly created by this installation:

```bash
systemctl --user disable --now copilot-gateway.service
systemctl --user show copilot-gateway.service --no-pager \
  -p ActiveState -p SubState -p UnitFileState
ss -lntp 'sport = :4141'
```

Pass: the known service is inactive/disabled and its listener is gone.
If a port still exists, identify it; do not kill an unknown process.
For a pre-existing service changed by maintenance, restore its prior state
instead of blindly applying fresh-install removal.

## S20_RESTORE_TARGET_FILES

Restore only backed-up configuration/authentication files within the approved
scope, preserving private permissions. If a file did not exist before,
remove or move only the specific newly created file after confirming it has
not acquired unrelated later use. Do not touch Codex history, other providers,
keyring credentials, project policies or other applications.

Stopping the gateway does not restore the Codex base URL. A machine that had
no original login must select another provider/login before Codex can work;
this is an expected remaining action, not a successful alternative login.

## S30_RESTORE_EXTENSION_AND_PERSISTENCE

Restore this machine's recorded extension version and individual update state;
do not apply a hard-coded historic version to everyone. Reload only an appropriate
window. Preserve other extensions and the editor itself.

Only restore lingering to disabled if that was the original state, the user
authorizes it and no other user service depends on it. Do not automatically
disable a user's background-service capability.

The dedicated tool directory can remain unused; deleting it is unnecessary
for rollback. If account authorization should be revoked, the account holder
does so through the provider's authorization management.

## S40_VERIFY_AND_REPORT

Compare restored state with the private backup without outputting credentials.
Confirm the known service/listener and intended provider behavior. Report
remaining login steps and untested behavior. Required acceptance is
`A_ROLLBACK`; success never implies that unrelated system state was restored.
