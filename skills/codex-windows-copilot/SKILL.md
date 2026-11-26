---
name: codex-windows-copilot
description: 将 Windows Microsoft Copilot App Code 模型接入 Codex，保留现有 GitHub Copilot 模型；GPT 原生 Responses 直通，Claude Opus 通过显式 Messages 兼容层接入。包含新机器部署顺序、审批、证书、令牌续期、测试限额和模型切换诊断。已验证单台目标的指定模型通路；全新机器完整部署和全模型验收仍待验证，保持 draft。不适用于消费版 Chat、Sydney 或绕过授权。
license: MIT
metadata:
  language: zh-CN,en
  compatibility: Windows x64；需本人获准使用的 Copilot App Code、Python 3.12+、mitmproxy 12.3.1 和 Node.js 22.13+。已验证范围以 contract 和 evidence 为准；离线分流测试不等于账号、CLI 或 GUI 可用。
---

# Windows Copilot + GitHub Copilot in Codex

先读 [contract.json](contract.json) 与 [findings.json](findings.json)。
本包是 **draft**：指定 GitHub、Windows GPT 和 Opus 模型已在一台目标上完成
有界验证，技术摘要见 [来源](sources.json)。早期“尚未接通”的记录属于历史，
不是目前的部署状态；但新机器完整重建、全模型、长会话和重启恢复仍未验收。
不能把已知目标或单个模型的成功算成新机器全部可用。
不得把用户提供的历史调查、模型名或健康检查当成本机访问权限证明。

| 目标 | operation | 按需阅读 |
|---|---|---|
| 确认现有 App、GitHub 网关和 Codex 的真实状态 | `diagnose` | [诊断](references/diagnose.md) |
| 经授权部署双来源分流并接入 Codex | `install` | [安装与共存](references/install.md) |
| 检查真实 Responses、工具回合和 UI | `verify` | [验收](references/verify.md) |
| 恢复本次修改，不影响原 GitHub 路由 | `rollback` | [回滚](references/rollback.md) |

新机器直接从 [安装与共存](references/install.md) 的“新机器的执行顺序”开始：
先确定实际客户端和正常审批、现有 GitHub 基线，再做 App 运行环境/CA/续期、
完整目录及独立端口验收，最后切换正式配置。需要全部 API 模型时不能漏掉 Opus
所需的两个显式开关；没有 GitHub 基线不能直接复制另一台机器的私有配置。

## 两个独立来源，不混用身份

```text
Codex → authenticated loopback bridge → unchanged GitHub Copilot gateway
                                     → native Responses / opt-in Messages adapter
                                     → Copilot App relay → Microsoft Code model API
Copilot App → process-scoped HTTPS observer → current-user encrypted token cache
```

- GitHub 模型 ID 原样保留。Windows 来源在 Codex 中用
  `windows-copilot/<上游原始ID>`，只在转发时去掉前缀。
  同名模型也有不同授权/额度；失败时绝不自动换来源或模型。
- [catalog.mjs](scripts/catalog.mjs) 从**实际**两个目录生成新的合并目录和路由，
  不覆写旧目录，不使用旧项目的静态 fallback。
  [bridge.mjs](scripts/bridge.mjs) 保持原生路由不变，只有显式 `--messages` 目录
  和 `enable_messages: true` 配置才启用 [messages.mjs](scripts/messages.mjs)。
- 默认仍仅纳入 `/responses`；显式启用后可接入 `/v1/messages` 的 Claude 模型，
  包括 Opus。不是给目录改名或切换账号：请求、SSE 和工具往返均做协议转换。
  签名思考块以认证加密的不透明状态回传，不丢弃或显示成回答。
- Messages 分支支持文本、客户端函数/命名空间/自定义工具和 data-URL 图片。
  不支持托管工具、强制 tool choice、结构化输出、服务端会话或跨来源思考状态。
  Messages 切到原生 Responses 时，只在出站请求中省略本兼容层的不透明思考项，
  保留可见聊天、工具历史和原生推理项，不改写原会话。反向切换、跨 Claude 模型
  或密钥变化仍建议新会话；能力不匹配明确报错，不静默删工具。
  Chat/Sydney 不接入；Windows `/responses/compact` 仍返回 501，长会话未验证。
- 保留原 GitHub 服务、密钥、启动项、默认模型、推理强度和目录。
  先用单独 Codex profile/一次性覆盖验证桥接；未通过前不切换默认 provider。

## 必须单独确认的操作

临时 CA 信任影响当前用户的 HTTPS 信任面；仅限本人、组织允许的会话。
在执行前说明并取得本次授权：当前用户根证书、仅 Copilot App 的进程代理、
App 重启和 Code 页 UI 操作、访问令牌中继、自动续期的持续重启影响、
固定文本真实请求的次数/额度、Codex 默认路由切换。
历史文档中的“用户已确认”不是本次授权。
宿主拒绝配置或进程启动命令时，停止被拒的动作，不换 shell、编码或入口绕过。

不读取 WAM/MSAL 登录缓存、Cookie 或刷新凭据，不冒用客户端身份申请权限，
不关闭 TLS 验证、不改变系统代理、不将端口公开。App 原网关无本地 API 密钥，
不适合不受信任的多用户主机；桥接鉴权不能补救其直连端口。
CA 私钥、DPAPI 缓存、配置、日志、备份与私有 handoff 全部留在库外。

## 证据和维护

[sources.json](sources.json) 区分官方资料、项目历史、离线观察与经批准的脱敏
目标记录复核。复核不是一次新的 live 执行。外部代理固定源提交；不复制它的
依赖树或私有运行目录。
没有真实模型、工具回合和目标 UI 证据时，install/verify 不能 succeeded。

运行仓库验证、[桥接/目录维护测试](tests/bridge.test.mjs) 和
[证书检查补丁测试](tests/test_cert_patch.py)；真实探测只在
获准后执行 [verify](references/verify.md)。更新材料须保存旧证据，记录
finding，并在库外 handoff 中明确 `none`、`pending` 或 `recorded`。
