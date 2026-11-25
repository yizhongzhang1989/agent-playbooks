# 技能如何积累、复用和持续修正

本仓库维护可复用的配置知识。客户端仍须主动读取入口；这里的校验工具
不会自动注册技能、执行配置、监听会话或把使用记录上传回来。

## 查找和加载

先读 `catalog.jsonl`，或在仓库根目录执行 `node tools/find.mjs "目标或错误码"`。
检索不依赖在线模型。结果中的平台、生命周期、证据日期/范围和未解决问题
用于初筛；再读选中技能的 `SKILL.md`、`contract.json`、`findings.json`，
只加载本次操作的 reference。

检索使用技能名称、别名和 findings 中的别名，支持中英文和精确错误码，
不是语义搜索。无结果时换产品名或错误码、查看目录，再判断是否需要新技能。
给别名添加用户真实使用的说法；不要添加“安装”“失败”等泛词。
描述、tags 和 avoid_when 用于判定适用性，不自动扩展为模糊匹配。

## 每次使用后的反馈闭环

1. **发现**：结束或中断一次使用时，检查是否出现新问题、版本差异、无效步骤、
   更好的做法或新的适用环境。没有新发现也明确记录；失败不等于已知根因。
2. **保留**：原始日志、账号信息、机器路径和未获准公开的观察保存在仓库外。
   私有运行记录的 `feedback.status=pending` 表示仍有待整理发现，不得把它写成无发现。
3. **分流**：先查看现有 findings、诊断表和来源。同一原因复用稳定 finding ID；
   环境偶发问题不直接上升为所有用户的规则。能明确复现或有可靠资料支持的
   可复用结论，脱敏后进入所属技能的 `findings.json` 和 `sources.json`。
4. **更正**：修正真正生效的 reference、脚本或模板，必要时同步契约、版本和别名。
   findings 记录问题的适用范围、原因和修复去向，不复制一份操作手册。
5. **验证**：运行受影响的检查和仓库验证。只验证文档或离线行为时，不能宣称
   live、GUI 或新平台通过。未确认的部分保留 open，或明确拆成另一个 open finding。
6. **收尾**：填写 resolution 和实际验证方式，再将 finding 标为 resolved。
   不采纳的发现用 dismissed 说明依据，保留其来由。更新目录并复查变更。
   本地改进不等于授权提交、发布或合并；遵循当前会话已有授权。

仅使用一个技能不自动授权修改共享库。没有仓库写权限或用户只要求执行时，
完成获准操作，并在私有记录/最终交接中留下 pending 反馈和建议修改位置。
不要为了维护反馈额外索取账号、运行付费探测或中断服务。

## findings 的最小约定

每包必须有 `findings.json`，无待记录发现时为
`{"schema_version":1,"findings":[]}`。字段由
[findings schema](../schemas/findings.schema.json) 校验：

| 字段 | 用途 |
|---|---|
| id / kind / status | 稳定问题 ID；problem 或 discovery；open、resolved、dismissed |
| summary / observed_on | 脱敏的可复用观察及实际观察日期 |
| applies_to / operations | 具体版本、平台或触发条件，以及受影响操作 |
| blocking | 问题是否使当前默认流程或验收声明不再成立 |
| aliases | 将来能搜到此症状的产品术语或错误码 |
| source_refs | sources.json 中的来源 ID；观察、推断和上游资料应明确区分 |
| resolution | 关闭依据、已修正或支撑决定的包内资源、实际通过的验证方式和范围 |

open 不允许提前填写 resolution；关闭必须有依据和验证。发现更广泛的新问题时
可以重新打开原记录，把仍适用的解释留在 reference/source 中。
`blocking=true` 的 open 记录禁止技能标为 active，但不会删除诊断/回滚入口。
CI 检查字段和引用，事实真实性及结论的适用范围仍需要维护者审查。

## 证据演进和生命周期

`contract.evidence.current` 列出仍与当前材料哈希一致的证据；
`historical` 列出已被版本变更取代的历史证据。每个证据文件必须且只能归入一组。
current 表示材料仍匹配，不表示刚执行过，更不表示所有操作通过。
日期、scope、环境、checks 和 limitations 共同限定结论。

更改依赖、补丁或其他被证据引用的文件时：

1. 保留原证据文件及其哈希，不将旧记录改成新版本的“成功”。
2. 把失配的证据移到 historical；没有可适用的当前证据时将技能标为 stale。
3. 对新材料实际执行获准检查，新增独立证据文件和准确来源，再列入 current。
4. 检查受影响验收项及 open findings，决定是否恢复 active。仅离线成功不能
   替代原来的 live/UI 验收；缺少目标环境能力时明确保留未验证范围。

| lifecycle | 含义 |
|---|---|
| draft | 流程尚未完成或验证不足，可供审阅，不能视为已验证方案 |
| active | 在声明的范围内可复用，具有当前材料证据且没有 blocking open finding |
| stale | 关键环境、依赖或流程已变化，需要复核；可检索，但先读限制和问题 |
| deprecated | 不再推荐执行，保留来源和迁移信息，默认搜索不返回 |

不按固定天数自动宣判失效；版本变化、复现失败和资料变化才是具体复核依据。
技能改动不应重写真实历史；重要行为变化应通过 findings/source/evidence 可追溯。

## 中断后继续执行

跨会话或复杂多阶段任务，在仓库外保存私有 JSON，结构见
[run schema](../schemas/run.schema.json)。记录目标和环境、operation、已完成步骤、
下一步、该操作的全部 required_acceptance（未做的填 not_tested）、备份引用、
resume_checks 和 feedback。完成任务与整理知识是两个状态：任务成功也可能
仍有 pending 反馈；recorded 必须引用实际存在的 finding ID。

在仓库根目录，用内容哈希记录准确的技能版本，包含未提交改动：

```bash
node tools/check-run.mjs --revision codex-copilot-gateway
```

把输出填入私有记录的 `skill_revision`。继续执行前，提供实际绝对路径：

```bash
node tools/check-run.mjs --file /absolute/private/run.json
```

检查器验证技能版本、操作、验收项和反馈引用，不输出记录内容，也不执行任务。
版本变化时，先审查差异、重新评估受影响步骤，再更新记录；不要只替换哈希绕过检查。
即使记录通过，也须重新检查用户/机器、现有配置、权限范围、服务状态及 open findings。
不能把旧 passed 当成本次机器的检测结果。此格式供客户端显式使用，不是工作流引擎。

## 新增技能和验证变更

优先扩展现有技能；只有目标、环境或依赖确实独立时才创建新包。
稳定 ID 使用小写连字符，与目录和 frontmatter.name 一致。

最小包需要 `SKILL.md`、`contract.json`、`sources.json`、`findings.json`，
以及 `evidence/` 中声明的证据；没有证据时可省略该目录，生命周期为 draft。
只有用得上时才添加 scripts、assets、versions 或多个 operation reference。
SKILL.md 保持简短，资源使用包内相对链接；操作 ID、输入 enum、验收项同步维护。
来源至少有稳定 id 和可核查的定位/观察说明，不应复制完整私有记录。
合同是本库扩展，运行环境依赖写在包内；根依赖只服务维护。

在仓库根目录，用明确的 Node 环境运行：

```bash
npm ci --no-audit --no-fund
npm run catalog
npm run validate
npm test
```

新建包或更改依赖/补丁时，运行 `npm run check`，其中 gateway 测试会在临时目录
安装锁定依赖。不要在服务正在使用的目录中重装。公共 CI 只执行离线/合成测试。
为修复的实际失败路径补回归测试；文档排版等低影响改动无需机械添加测试。
