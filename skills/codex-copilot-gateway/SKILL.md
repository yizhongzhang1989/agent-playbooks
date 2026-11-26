---
name: codex-copilot-gateway
description: 配置、诊断和验证 Codex CLI 或 VS Code Codex 通过本地 GitHub Copilot 网关使用 Responses API。包含原生 Windows 已有代理诊断与模型目录刷新；适用于 Codex 反向代理、copilot-gateway、401、流在 response.completed 前结束、插件找不到模型或只显示 Chat 的问题；不是系统 HTTP/HTTPS 正向代理教程。
license: MIT
metadata:
  language: zh-CN,en
  compatibility: Ubuntu 22.04.5 LTS 有旧锁文件的历史完整安装证据；Windows x64 的当前锁定依赖安装、补丁及4项合成测试已通过。依赖更新后的真实部署/GUI仍待验证，当前为stale。需要本机文件与shell能力；授权及GUI验收需要用户参与。
---

# Codex through a local Copilot gateway

## Read first

Read [contract.json](contract.json) and open items in [findings.json](findings.json).
This package is currently **stale** for live deployment: three explicitly approved
compatible dependency pins restored the clean offline gate, but the updated lock
has not repeated the prior live installation. Do not reuse the old live evidence
as proof for the new bytes.
Choose an operation from the actual goal,
not from the presence of an installation command. Metadata grants no permission.
This package is not automatically registered with any AI client.

| Goal | Operation | Read next |
|---|---|---|
| 在没有网关的新环境中接入普通 Codex 插件 | `install` | [install.md](references/install.md) |
| 已有网关或插件异常，原因尚不明确 | `diagnose` | [diagnose.md](references/diagnose.md) |
| 检查某次配置是否真的可用 | `verify` | [verify.md](references/verify.md) |
| 撤销本次已确认的配置变更 | `rollback` | [rollback.md](references/rollback.md) |

Unclear goal or existing installation: inspect first. Do not silently reinstall,
rotate credentials, downgrade extensions, restart services or choose another model.
For native Windows, also read the applicable sections of
[windows.md](references/windows.md); do not run the Linux service commands there.

## Scope and invariants

- Chain: Codex Responses client → authenticated `127.0.0.1:4141` gateway →
  GitHub Copilot. Never put this URL into system `HTTP_PROXY` or VS Code `http.proxy`.
- The reference combination is in [versions.json](versions.json).
  Runtime npm dependencies are pinned separately in [tools/package.json](tools/package.json)
  and [tools/package-lock.json](tools/package-lock.json).
- Default deployment uses the target user's `~/.codex`, file-based ordinary
  gateway API key authentication, HTTP/SSE on both links, finite retries,
  approval prompts and a read-only sandbox.
- GitHub authorization, ordinary gateway keys and admin keys are distinct.
  Never print credentials or use an admin key as a client credential.
- Never send project files as probes, operate hardware, disable TLS validation,
  fabricate successful terminal events or bypass upstream policy/quota.
- Account and organization policies must allow this use. The gateway grants no
  model entitlement and cannot replace network access.

## Evidence and limits

The [source-installation record](evidence/2026-11-25-ubuntu-22.04-x86_64.json)
records a real prior installation, including two CLI probes and user-confirmed
VS Code UI success. It is not a new-machine execution of this migrated package.

Four original gateway checks and repository maintenance tests are bundled; they
do not constitute full transport coverage. The
[Windows record](evidence/2026-11-25-windows-x64.json) distinguishes passing
maintenance/metadata checks from the originally blocked installation. The
[updated lock record](evidence/2026-11-26-compatible-lock-offline.json) now covers
clean dependency installation, patch application and all four original tests,
without account, inference or GUI operations. It is not a second full installation success. Other platforms,
isolated CLI, SSH forwarding, long-session compression, logout and full-machine
reboot are not validated here.
See [optional paths](references/optional.md) only when explicitly needed.

## Verify and report

- Default [verify.mjs](scripts/verify.mjs) performs offline checks.
- `--mode catalog` contacts the local gateway and may trigger upstream metadata
  access. It does not send an inference request.
- `--mode live --allow-paid-request` explicitly enables one fixed-text request;
  obtain permission for the associated account/network/quota use first.
- These scripts report phase checks, not overall plugin success. Required
  acceptance includes CLI and actual VS Code UI evidence.
- Return the contract's output shape. Missing required evidence means
  `blocked` or `waiting_for_user`, not `succeeded`.

## Sources and maintenance

Use [sources.json](sources.json) to trace claims and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for patch provenance.
Keep actual runtime files, accounts, backups and logs outside the repository.
Maintain scripts/templates once; do not reconstruct the old monolithic guide
as a second editable copy.

After use or interruption, report new failures, version differences or improved
procedures, including their environment and verification limits. Keep raw records
private. When library maintenance is authorized, update the applicable resource,
sources and findings together, verify the change, then close the finding. Otherwise
leave pending feedback in the handoff. Preserve old evidence when materials change;
the contract distinguishes current material evidence from historical records.
