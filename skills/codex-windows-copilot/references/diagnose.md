# Diagnose before touching accounts or services

1. 确定目标当前用户、本机/WSL/远程环境、Codex 实际可执行文件和版本、
   `CODEX_HOME`、provider URL、默认模型/effort、catalog、鉴权方式。
   只输出必要元数据；不要直接执行会打印密钥的 auth command。
   PATH 找不到 `codex` 时检查目标扩展的实际 bundled 二进制，不自行换一套 CLI。
2. 查实际端口的地址和 owner PID，不根据默认端口判断故障。既有 GitHub
   网关可能为 `copilot-proxy-api`，并非 Linux skill 的固定 gateway。
   不重装、不重启它；先记录配置/目录/启动器哈希，并留私有备份。
3. Windows 旧项目检查 `pyproject.toml`、Git 状态、提交、Python 实际版本和
   `Scripts/python.exe`，而不是把存在 `.venv/` 当成安装成功。
   已观察到一份 `.venv/pyvenv.cfg` 指向不存在的 Python 3.6.8、没有 python.exe；
   项目要求 Python 3.12+。保留该目录，使用新的私有运行副本/环境，不删除未知内容。
4. Copilot App 必须实际具有 Code 页且本人能合法使用。消费版 Chat、GitHub
   VS Code 扩展和网页登录不可替代。检查当前 App 版本，不从进程名推断模型权限。
5. 不启动 `start`/`refresh`/`stop` 来“检查”：这些命令会重启/关闭 App、改变
   当前用户根证书或进程代理。`doctor`/`status` 先审查版本和实现再用。

## 分层判断

| 观察 | 结论与下一步 |
|---|---|
| GitHub 带普通密钥 `/v1/models` 200，无密钥 401 | 本地鉴权/元数据路径可用；不是 inference 成功 |
| `/health` 404 | 该部署可能没有此路径，不用猜测 endpoint 宣称服务死掉 |
| App relay 没监听 | 尚未启动或已退出；先确认 CA/App 重启授权，不并发反复 start |
| health 显示 token 未过期 | 只是缓存 `exp` 检查；实际 `/v1/models` 仍可能 401/403 |
| health 200 但 token expired / models 401 | relay 存活不代表账号可用；按安装参考核查/恢复正常 App 续期，不重装或重建另一套 relay |
| 仅启动 App 没有 token | 历史观察：首次 Code 页触发 models，Chat/configuration 的 token 不适用 |
| App 能回复但无 relay 观察 | 不能证明经过代理；启动参数和子进程 HTTP(S)_PROXY 都需核对 |
| `AADSTS65002`、`access_blocked`、`model_not_allowed` | 停止该授权/模型分支，不换客户端 ID、版本头或场景头绕过 |
| App 名称与 GitHub 名称相同 | 使用前缀显式区分来源；不要“更正”上游 ID，例如 `gpt-61-sol` |
| Claude/Opus 在 App 目录里、Codex 却只有 GPT | Claude 声明 `/v1/messages`，默认目录只选原生 Responses；按安装参考显式启用并验证 Messages 兼容层，不只改模型名 |
| Messages 分支 `messages_*` 400 | 检查工具、历史、effort、输出格式等明确不支持的参数；不删工具或静默降级后重试 |
| `messages_hosted_tool_unsupported` / web_search | 使用已说明限制的测试 profile，关闭托管 web 工具和 external_web_access；不将托管调用偷偷改成普通函数 |
| `messages_reasoning_state_invalid` | 旧会话来自其他模型/来源，或 bridge key 已变化；保留历史，新开目标模型会话，不伪造签名 |
| 原生 GPT 报 `rs_wcm_...` 的 encrypted content 无法验证 | 旧版桥接把 Messages 私有密文直通给原生后端；当前桥接只在原生出站请求中省略带本包双重标记的 reasoning，保留聊天/工具及原生密文。确认实际部署版本，不清空会话或重登账号 |
| Sydney Chat | 不支持此会话协议，不伪造成 Messages 或 Responses |
| model/list 有模型但请求失败 | metadata 不等于真实执行；查 Responses 错误/SSE 终止/工具回合 |
| Windows 501 compact | 未实现的上游能力，不是重装问题；长会话验收不能通过 |
| certutil 成功但 CA 检查 False | 检查子进程 Certificate provider 是否加载；按安装参考做固定源补丁，独立核对/清理该次 CA |
| Full Access 下 `blocked by policy` | 先看实际 approval_policy，`never` 不能发起审批；按安装参考进入正常 `on-request` 通道。明确禁止时仍停止，不靠改 shell/编码绕过 |
| App 原始 SSE 成功、bridge/Codex 未运行 | 只证明上游原生 Responses，不能关闭双来源 live finding |
| 一次 UI 回合后 429 / `approved_request_budget_exhausted` | 查响应来源和实际账本，不能都当上游限流；一个 UI 回合已观察到两个请求。测试用独立端口，完成后获准的正式配置不引用测试账本，历史 used 不清零 |
| 模型选择器的默认值与会话不一致 | `model/list.isDefault` 不是实际 model/effort 的唯一依据；对照配置和目标 turn/UI，保留用户最终选择 |
| apply_patch 成功，但相对路径 Get-Content 找不到文件 | 先独立核对文件是否存在与实际命令目录，再用显式 workdir 和绝对路径；已观察到这样通过，不据此认定代理丢文件或 shell 根因已定位 |
| 本地 bridge 配置在普通 key 上被拒 | 当前只接受两枚不同的 64 位小写十六进制 key；报告不兼容，不替换原 GitHub 的账号或密钥 |

Messages 不是 Responses 的地址别名。提供的 App 项目明确只原样转发两种
协议，本包兼容层才处理 Codex 请求/工具定义、Anthropic SSE 和签名思考历史。
仅 metadata 可见仍不能证明 Opus 的工具回合可用。
原生路由省略兼容层状态时会记录不含内容的条目数，并返回
`x-copilot-bridge-omitted-reasoning`；不会把解密后的 Claude 思考转交另一来源。

## 历史项目的边界

参考项目记录了 App Code 的模型接口和过去的单独推理，明确未实测 Codex CLI。
它的 `vscode-config` 在无法联网时使用 fallback；不能用于生成已授权模型目录。
它的 `start` 默认 keepalive 会在令牌临近过期时重复重启 App，首次验证使用
`--no-keepalive`；后续启用要获得持续影响授权。引用位置见
[sources](../sources.json)，不要把原始日志或完整历史记录搬入本库。
