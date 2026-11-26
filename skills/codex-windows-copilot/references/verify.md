# Verify the actual two-source goal

## Offline / metadata (no inference)

- `npm run validate`、`npm test`、新包需要的 `npm run check`。
  单独运行本包可用 `node --test skills\codex-windows-copilot\tests\bridge.test.mjs`。
  补丁脚本另运行 `python -m unittest discover -s skills\codex-windows-copilot\tests -p test_cert_patch.py`，
  这些测试使用合成源文件，不修改真实证书、账号或进程。
  合成测试覆盖同名模型分流、GitHub 条目不变、鉴权隔离、错误/429 保留、
  不跟随重定向、取消/超时和截断 SSE。Messages 分支另覆盖 namespace/freeform
  工具、签名思考回传、稳定事件 ID、增量文本、实际 usage、拒绝和 incomplete。
  混合 assistant 回复中的工具调用后文本必须能完整往返；工具结果未齐时不能
  插入新的用户回合或打断结果组。函数/自定义工具参数被 max_tokens 截断时，
  SSE 和 JSON 都应返回 incomplete，不能分发未完成工具或把半截 JSON 包装当输入。
  完整响应中的畸形工具参数仍必须报错，并且在任何工具分发前完成全部校验。
  协议切换回归须覆盖 Messages 私有密文不外传，以及原生 reasoning、可见消息、
  工具调用/结果和磁盘会话不被清空；同一 Messages 模型的签名往返仍须通过。
  它们没有接触真实账号。
- 对外部 App 固定源运行自己的离线 pytest/ruff；记录实际 Python/依赖版本。
  未执行或失败必须报告，不能用本包测试替代 App 证书/中继测试。
- 只读检查 GitHub、App relay、HTTPS observer、bridge 的监听与预期 PID/loopback。
  bridge 与 GitHub 无密钥须 401，正确普通密钥 metadata 200；
  App relay 本身不要求本地密钥，明确记录风险，不能伪称 A_AUTH 通过隔离所有用户。
- 使用当前 App token 的 models 结果；health 的过期时间不是权限证明。
- 合并目录中 GitHub 条目与基线逐项一致，默认 model/effort 不变；
  Windows 精确 ID/能力来自当前 metadata，没有凭空添加模型或改拼写。
  `model/list.isDefault` 可能只是目录推荐项，不能代替读取实际配置和目标会话选择。
- 在空私有目录启动目标 Codex **实际 bundled app-server**，
  `initialize` → `model/list`，不启动 turn。核对两来源可见、重名有前缀、
  默认 GitHub 模型和 effort 保持。结束自己的诊断进程。

## Live gates — need account/quota permission

提前说明各来源、精确模型和请求次数预算；不运行旧项目未审查的 verify 命令。
第一次批准一个有界批次即可，不重复确认同范围步骤；超出次数/来源另行确认。
固定提示词、空私有目录、无项目文件。每请求超时 120 秒（CLI 180 秒）、
自动重试 0；401/403/429、策略拒绝时停止，不换身份、来源或模型。
若用 `request_budget_file`，检查本次已使用次数（包括先前的直连诊断）。
不能只靠 CLI 退出码假定它只发了一次请求；桥接的持久化计数用于限制实际转发。
给 UI 的辅助请求留余量；手动用户回合与自动探测的授权/计数边界单独记录。
测试端口有界不等于正式服务永久只能发这一批请求，反之取消测试限额不等于
授权 agent 无限自主请求。改额度前确认，保留原账本。
宿主阻止配置/启动时，已有的独立 App SSE 结果只能记作 `A_UPSTREAM_SSE`，
不能提升成 `A_WINDOWS`、`A_CLI` 或 `A_UI`。

1. 各来源一个 SSE 请求，`store:false`、明确 model/effort。
   记录 HTTP 200、SSE、真实 `response.completed`、无 failed/error 事件和
   完整预定标记 `COPILOT_DUAL_OK`，不能只检查 headers 或首个 delta。
   明确标记来自真实上游；测试中的合成 terminal event 不是证据。
2. 各来源经 Codex CLI/profile 的固定文本回合成功退出 0 并返回精确标记。
   inspect 全局 hooks、instructions、MCP/外部集成，不让空目录 probe
   仍把私有全局材料送出。保留审批和只读 sandbox，不用 bypass flag。
3. Windows 至少一个有界工具两轮回合：模型产生一个无副作用、合成工具调用，
   验证名称/参数、提交固定 `function_call_output`，模型返回终止标记。
   不执行模型提供的 shell、不读文件，不把纯文本成功当成 Codex agent 能力。
   Messages 必须把完整的上一轮 output（含加密 reasoning）与工具结果一起回传，
   不仅复制 function_call。Claude 使用 auto tool choice；不要强制调用后伪装为成功。
   经用户授权的实际 Codex 文件验收，应只读写空私有目录中的固定合成文件，
   验证真实 `apply_patch` 和命令返回；命令明确提供 workdir 和绝对目标路径。
4. 普通目标 UI 新会话分别选 GitHub 和 Windows 前缀模型，确认完整回复和来源。
   需要真实 GUI 或用户确认；只看 model/list、CLI 成功、模型自述均不够。
5. 如果批准持续续期，跨 token 更新验证 relay 是否取得新 token、两来源是否
   仍可用。App 重启会中断 App 工作，不能偷偷开启 keepalive。注销/重启单独验。

若只验证某个模型，不宣称全目录都通过。Windows `/responses/compact` 当前
不支持，不能以短回合通过推断长会话可用。
Messages 切回原生 Responses 可用固定合成历史验证：只省略本包生成的思考项，
不把它的解密内容发给新来源。反向或其他跨来源状态仍新开会话，不尝试解码或
丢弃原生密文。UI 选择还可能改变持久默认模型，收尾核对并保留用户的最终选择。

## Completion

合同各项逐项列出 passed / failed / not_tested；默认路由改变前后比对原基线，
原 GitHub 模型必须真实仍可用。没有 live/工具/UI 证据则 install/verify 为
waiting_for_user/failed/blocked，不是 succeeded。只需文档维护时不为了补证据重新
启动 App、发送请求或重跑用户会话；复核历史记录须明确标成 record review。
诊断发现和材料变更分别写 findings 和新 evidence，原始数据留库外。

## 目前已验证的边界

经用户批准复核的同日记录覆盖：指定 GitHub/Windows GPT 的 SSE、隔离 CLI，
Opus5.5/high 的 Messages 转换、合成工具往返、实际 Codex patch/显式路径读回，
以及用户操作的目标 UI。模型目录曾为 13+9，并不代表每个模型/effort 都实测。
UI 使用的是用户选择的工作区，不把它重标为自动化的空目录实验。

旧目标接通问题已关闭；新机器从空白状态重建、所有模型、长会话/远程压缩、
注销/重启恢复仍未验证。当前 skill 因这些明确的边界保持 draft，而不是继续
声称“目标桥接尚未启动”。源记录和关闭依据见 [findings](../findings.json)。
