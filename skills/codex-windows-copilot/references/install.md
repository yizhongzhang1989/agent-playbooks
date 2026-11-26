# Install a second route without replacing the first

已有单台 Windows 目标的指定模型验收，**不是新机器免验收的安装器**。
先完成 [diagnose](diagnose.md)，任何失败保留原 GitHub 路由。
仓库脚本没有自动安装证书、授权、注册服务或修改 Codex 的功能。

## 新机器的执行顺序

| 顺序 | 必须满足后才能继续 |
|---|---|
| 1. 确定客户端与授权 | 本机用户和 App Code 权限明确；找到目标 Codex 实际二进制；使用正常交互审批 |
| 2. 准备 GitHub 基线 | 原 GitHub 服务、普通本地密钥和可被 Codex 解析的实际目录均已可用并备份 |
| 3. 准备 App 运行副本 | 固定源码、有效 Python 环境、私有 ACL；必要的证书检查补丁已验证 |
| 4. 启动并维护令牌 | 经授权启动 App/relay；真实 models 返回 200；长期使用另确认 keepalive |
| 5. 生成并测试目录 | 需要 Opus/全部模型时同时启用 `--messages` 和 `enable_messages`；测试用独立端口 |
| 6. 分层验收 | 鉴权/目录、SSE、工具、实际 CLI、目标 UI 分别通过；模型和额度先明确 |
| 7. 正式切换与交接 | 比对配置哈希后切换；保留旧 provider；正式服务不引用临时测试账本；核对续期/进程归属 |

本包不是空白机器上的 GitHub 网关安装器。若没有第 2 步的基线，先检索
`codex-copilot-gateway` 的适用 Windows 操作并完成它，不从另一台机器复制账号、
DPAPI 缓存、CA/私钥或 `.venv`。不同账号的模型目录可能不同；13+9 只是已观察
目标的数量，不是目录生成器的固定清单。

### 先建立正常审批通道

`codex` 不在 PATH 不等于 VS Code 扩展没安装。通过目标扩展清单或实际运行进程
定位其 bundled Codex，检查 `--version`；不要另装一个 CLI 来代替被验证的客户端。
同一机器有多个 VS Code/远程环境时，不能只选“最新”目录。

Windows `Full access` 可能同时使用 `approval_policy="never"`：它禁止弹出审批，
不等于所有命令都获准。已观察到目标会话通过 **Change permissions → Ask for
approval** 切换到 `on-request`。CLI/配置的对应交互模式为：

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

保留已有、受支持的 Windows sandbox 后端。检查目标会话的实际生效设置和组织
限制，而不只看 TOML；随后让需要许可的操作进入正常审批。若明确禁止则停止，
由用户/管理员处理。相关 Windows URL 启动启发式只是原拒绝的有依据候选解释；
没有对旧命令重做分类器跟踪，不能承诺改一个设置就清除所有 `blocked by policy`。
参见 [来源](../sources.json) 中的官方审批文档和已核对的版本资料。

## 1. 固定外部来源，隔离运行数据

用户提供的参考源：`madderscientist/copilot-app-proxy`，
提交 `cfb409bbce234f0ce8e80c89f21bf7afe79a6e87`，包版本 `0.2.0`。
检查实际源内容、工作树与组织许可，不默默升级；依赖 `mitmproxy==12.3.1`，
Python 3.12+，其他 Python 依赖在该项目 manifest 中，不是完整 lockfile。
新环境需要记录实际解析版本。旧副本的损坏 `.venv` 不应覆盖或删除。

在库外创建新的、当前用户/SYSTEM 私有 ACL 目录，放审查后的 tracked 源副本、
新的 `.venv`、之后的 `.local` 和桥接配置。只复制源码，不复制运行记录、
证书、令牌、已安装依赖。安装和离线测试可以先做；不要运行 App launcher。
Node 桥接只用标准库，无额外 npm runtime 依赖。
ACL 的 mode:0600 在 Windows 不生效；创建任何 CA/密钥前检查实际 ACL。

例如在**新建、已检查私有 ACL 的源副本**内执行，不对未知旧环境运行：

```powershell
Set-Location 'C:\private\windows-copilot\app'
$env:PYTHONIOENCODING = 'utf-8'
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
$env:PIP_NO_INPUT = '1'
python --version # 确认当前选中的解释器 >= 3.12
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install '.[dev]'
& '.\.venv\Scripts\python.exe' -m pytest -q
& '.\.venv\Scripts\python.exe' -m ruff check copilot_app_proxy tests
```

每步检查退出码，失败即停；这里的 `python` 应换成已核对的绝对解释器路径。
历史目标的 Python 3.13.5、mitmproxy 12.3.1、aiohttp 3.14.5 组合通过
55 项供应源测试及 ruff，随后也完成过 relay 启动；新机器仍须逐层验证。
不要使用 WindowsApps 中尚未绑定真实解释器的占位入口。

### Windows PowerShell 证书检查差异

实测某个 Windows PowerShell 5.1 子进程未自动加载 `Certificate` provider，
导致 `certutil -user -addstore Root` 成功后，旧启动器的 `Test-Path Cert:...`
仍返回 False。**不是证书无效，也不是关闭 TLS 验证的理由。**
先用当前用户证书库和本次 thumbprint 独立核对。若已添加而启动器退出，
只清理该次新增 CA，保留失败记录；不要反复启动累积根证书。

[patch-cert-provider.py](../scripts/patch-cert-provider.py) 只修正固定源的
`cli/windows.py`：显式从子进程自身 `$PSHOME` 加载
`Microsoft.PowerShell.Security`。它核对固定源 SHA-256、保留原始备份字节和
CRLF/LF、拒绝其它改动，不操作证书库。仅用于**私有运行副本**：

```powershell
Set-Location 'C:\path\agent-playbooks'
$env:PYTHONIOENCODING = 'utf-8'
python skills\codex-windows-copilot\scripts\patch-cert-provider.py `
  --app-root 'C:\private\windows-copilot\app'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s skills\codex-windows-copilot\tests -p test_cert_patch.py
```

不把整个源文件重新写成 LF 来修复哈希差异。某次 `git archive` 输出含 CRLF，
运行副本与 ZIP 相同但与 Git blob 原始字节不同；比较归档及逻辑内容后保留原字节。
只有换行差异的判断不能用来忽略实际代码改动。

## 2. 获得敏感步骤许可，再启动 App relay

向用户明确说明根证书/重启/令牌中继/额度影响并等待许可。不要引用历史同意。
若 App 有未完成工作，先让用户保存。命令在私有源根目录执行，显式设置
`PYTHONIOENCODING=utf-8`，使用新环境的绝对 Python 路径：

```powershell
# 已获准的 App 重启/用户根证书/本人访问令牌中继；不是只读命令。
Set-Location 'C:\private\windows-copilot\app'
$env:PYTHONIOENCODING = 'utf-8'
& '.\.venv\Scripts\python.exe' -m copilot_app_proxy.cli start --detach --no-keepalive
```

后台辅助进程须隐藏窗口；原启动器使用 CREATE_NO_WINDOW。
App 是用户需要参与的 GUI，按授权打开 Code 页/完成正常登录，不代输账号凭据。
只监听本机 IPv4；确认 relay 与 HTTPS observer 两个 owner 的地址。
初次只读模型请求不消耗 inference 额度，但涉及本人账号网络访问。
采集实际 `/v1/models` 到私有 JSON，禁用系统代理/重定向，超时 20 秒。
不能用 `vscode-config` 的历史 fallback 或让 App 发消息代替 metadata 检查。

### 已有 relay 的令牌过期与持续续期

relay 在监听、`/healthz` 返回 200，不代表令牌有效。若
`upstreamAuthenticated=false` 或真实 models 返回 token-expired 401，先核对
已存在的 gateway/observer/CA；不要重装或重复 `start` 一个正在运行的实例。

确认持续 App 重启影响后，可以在已运行的 `--no-keepalive` 实例上，用原项目
公开命令启动**一个**续期 worker：

```powershell
Set-Location 'C:\private\windows-copilot\app'
$env:PYTHONIOENCODING = 'utf-8'
& 'C:\private\windows-copilot\app\.venv\Scripts\python.exe' `
  -m copilot_app_proxy.cli keepalive --gateway-port 19324
```

这条前台命令需要长期运行。由宿主的正常后台管理启动时，记录其 handle、根 PID、
子进程和启动时间，并确认能脱离临时 agent shell 存活；不能靠启动成功推断续期成功。
停止时使用已核对的本次 worker 进程树；只停虚拟环境启动器可能留下真正的 Python
子进程。宿主 handle 失效时重新核对身份，不按进程名批量结束。
它会在已过期或接近到期时走正常 App 重启/Code 页流程，核对更新的 expiry 和真实
models 200；不读取登录缓存。过早手动 `refresh` 可能只是复用旧 token，不要循环重启。

独立 `keepalive` 命令**不会自动把自身写入原 launcher 的 `pids.json`**。
启动前排除已有 worker；停 relay/清理 CA 前先停本次独立 worker，以免它重新拉起 App。
若首次启动前就已授权持续续期，原 `start` 可省略 `--no-keepalive`，此时由 launcher
登记 worker。两种方式不要同时使用。锁屏、休眠、需重新登录及注销/重启仍是限制；
本包未实现登录自启，必须交接按实际状态恢复和清理的方法。

## 3. 合并目录，保持模型来源可见

从原 GitHub Codex catalog 的副本和**新采集**的 App `/v1/models` 生成：

```powershell
Set-Location 'C:\path\agent-playbooks'
$env:NODE_ENV = 'production'
node skills\codex-windows-copilot\scripts\catalog.mjs `
  'C:\private\github-catalog.json' 'C:\private\windows-models.json' `
  'C:\private\new-catalog-generation'
```

输出路径必须不存在。`model-catalog.json` 给 Codex，`routes.json` 给桥接，
`excluded.json` 明确列出 Messages-only、上游关闭等未接入条目。
GitHub 的每个原始条目保持不变；不会追加旧 GitHub 目录排除的模型。
目录新增只代表 metadata 兼容，不代表流、工具或免费可用。

### 同时接入 Claude / Opus

App 目录里的 Claude 使用 `/v1/messages`，Codex 使用 Responses；原 App 项目
没有实现两者转换。需要全部当前 Windows 模型时，在上述目录生成命令的
`catalog.mjs` 后加 `--messages`，并在桥接配置中加 `"enable_messages": true`。
只接入实际声明 `/responses` 或 `/v1/messages` 且未被禁用的条目。
复制运行脚本时同时带上 `messages.mjs`，不覆盖正在运行的版本。

先在独立测试端口验证 Messages 分支，再更新正式目录/分流器。保留当前
GitHub 和 Windows 原生路由、当前默认模型和用户的后续配置修改。
不得把某个 Opus 的成功说成整个 Claude 目录都已实测。

例如，为明确要求包含 Opus 的目标生成一个新目录：

```powershell
Set-Location 'C:\path\agent-playbooks'
$env:NODE_ENV = 'production'
node skills\codex-windows-copilot\scripts\catalog.mjs --messages `
  'C:\private\github-catalog.json' 'C:\private\windows-models.json' `
  'C:\private\windows-copilot\bridge\catalog'
```

Messages 分支的边界：

- `reasoning.effort` 按实际目录转为 `output_config.effort`；
  固定使用 `thinking: {"type":"adaptive"}`，不伪造 `none` 或 `budget_tokens`。
- 未指定输出长度时 `max_tokens=32768`；显式 `max_output_tokens` 必须在
  1–128000 内。上限来自固定 App 项目的有界观察，不是未来 API 承诺。
- 函数工具及 namespace 保持名称/调用 ID；freeform 工具使用字符串参数包装，
  返回时还原为原 `custom_tool_call`，包括 `apply_patch`，不改成 shell 替代工具。
- 原样保留签名 thinking/redacted thinking，以独立用途密钥加密后放入
  `reasoning.encrypted_content`。不保存额外服务器会话，不暴露思考正文。
  密钥由持久 bridge key 派生；密钥轮换或传给另一 Claude 模型的历史需新会话。
- 切到原生 Responses 后端时，出站历史只省略同时具有 `rs_wcm_` ID 和 `wcm1.`
  密文标记、没有 summary/content 正文的纯不透明 reasoning 项。原始会话、
  可见文本、工具历史与原生后端自己的密文
  不变，也不解密后转交。反向切换遇到原生密文仍需新会话。
- 只支持 `tool_choice=auto/none`、文本输出和内联 base64 图片。
  托管 web/file/computer 工具、服务端 `previous_response_id`、自动截断、
  结构化输出与未知语义参数明确返回 400，不静默删除。
  `prompt_cache_key` 和客户端 metadata 不转发；不承诺跨协议缓存等价。
- 只有收到完整有效 `message_stop` 才能输出 Responses 成功终止；
  长度耗尽为 incomplete，上游拒绝/错误/截断不是成功。转换并非原生协议。

## 4. 配置独立鉴权桥接

在私有目录内生成新的随机 32 字节十六进制 bridge key；不使用 GitHub key、
Microsoft token 或 admin key。配置引用 key **文件路径**，不把值放命令行。
确保配置、密钥、父目录和备份 ACL 私有。配置结构（替换路径和检查后的端口）：

当前加载器要求 bridge key 和 GitHub 普通本地 key 都是不同的 64 位小写十六进制
字符串。新机器现有 key 若格式不同，应明确报告兼容性边界，不擅自轮换其密钥或
把上游账号 token 当成本地 key；本包尚未验证任意网关格式的干净安装。

私有运行目录须一起保存 `bridge.mjs`、`messages.mjs` 和 `budget.mjs`，不要只复制
入口脚本。下面示例假定 key 文件名为 `proxy-key`，目录生成路径与上一节一致。
测试实例须换成检查过的独立端口、密钥和账本，不与正式实例同时占用此端口。

```json
{
  "port": 47832,
  "key_file": "C:\\private\\windows-copilot\\bridge\\proxy-key",
  "github": {
    "base_url": "http://127.0.0.1:47831/v1",
    "key_file": "C:\\private\\existing-github-key"
  },
  "windows": { "base_url": "http://127.0.0.1:19324/v1" },
  "routes_file": "C:\\private\\windows-copilot\\bridge\\catalog\\routes.json",
  "enable_messages": true,
  "timeout_ms": 180000
}
```

`github.key_file` 指向原网关的普通本地密钥，不是 GitHub 上游 token。
实现只接受两端独立的 `http://127.0.0.1/.../v1`，启动时拒绝自转发。
只读 `/healthz` 也需要鉴权，只证明桥接存活，不查询上游。
原 Windows relay 无本地密钥：它的端口仍可被其他本机用户访问；
新增 bridge 鉴权**不能**修复这一点。多用户环境应停下，先设计 relay 鉴权。

为 Codex 的命令鉴权，在这个私有目录中保存 `token.mjs`：

```javascript
import { readFile } from "node:fs/promises";

const key = (await readFile(new URL("proxy-key", import.meta.url), "utf8")).trim();
if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid local bridge key.");
process.stdout.write(key);
```

它只供 Codex 读取本地 bridge key，不能写成 Microsoft token，也不要手动执行后把
stdout 贴到日志/聊天。`proxy-key` 的文件名必须与 `key_file` 指向同一文件。

通过 host 管理的隐藏后台进程或专用终端启动，不依赖短暂 agent shell。
每次设置工作目录、Node 路径、`NODE_ENV=production`、
`COPILOT_BRIDGE_CONFIG=<绝对私有配置路径>`，再运行 `scripts/bridge.mjs`。
不要修改已有 GitHub Run 项、停止它的进程或让桥接自动 fallback。
未实现开机注册；不要把 detached process 当作注销/重启保障。
若宿主拒绝命令，记录拒绝发生在执行前还是执行后，并核查真实状态；
不要把拒绝猜成某个特定关键字受限，也不要换 shell/编码/入口重试同一被拒动作。
文件准备成功、分流器启动成功和 Codex 调用成功是三个不同验收阶段。

已获准的前台入口示例（长驻后台使用宿主管理，而非改成另一个绕过入口）：

```powershell
Set-Location 'C:\private\windows-copilot\bridge'
$env:NODE_ENV = 'production'
$env:COPILOT_BRIDGE_CONFIG = 'C:\private\windows-copilot\bridge\config.json'
& 'C:\Program Files\nodejs\node.exe' '.\bridge.mjs'
```

### 有界真实验证的计数

可在私有 bridge 配置中加入 `request_budget_file`，指向一个新建的私有 JSON：

```json
{"schema_version": 1, "limit": 8, "used": 0}
```

已有获准请求必须计入 `used`，不能因为重启服务、换探测脚本或重建配置而清零。
桥接每次转发前用互斥锁持久化预留次数，失败/取消也计一次；达到上限返回 429，
账本损坏/锁冲突返回 503，均不转发。`GET /v1/models` 不占推理次数。
残留 `.lock` 或不确定状态要核查 owner 与实际请求，不自动删除或重置。
无此配置时桥接**没有**批次数上限，不能声称它已限制额度。
这限制的是请求次数，不是 token 或金额，也不拦截绕过桥接直连 App 的其它调用。

对已有正常服务做升级时，使用独立端口和测试配置，不把临时限额挂在正式端口。
一个 UI 回合可能发起多次实际请求，预算应留余量。验收完成后按获准范围保留账本，
正常使用配置不引用测试账本；不能重置 used 或把“无测试限额”当无限自主验证许可。

## 5. Codex 先隔离验收，再切换

官方文档当前采用 `$CODEX_HOME/<name>.config.toml` profiles，0.134+ 不再使用
旧 `[profiles.name]`；先核对实际 Codex。在用户层新增独立 profile，保留主
`config.toml` 字节和原默认值。正式 profile 不能代替隐私隔离：真实自动验收使用
空工作目录及新建的私有 `CODEX_HOME`，不复制全局 instructions/hooks/MCP。
以下 provider 配置也用于隔离 home；其中默认 model/effort 由本次目标明确设置，
不能从 `model/list.isDefault` 反推实际会话选择。

```toml
model_provider = "copilot_dual"
model_catalog_json = 'C:\private\windows-copilot\bridge\catalog\model-catalog.json'
web_search = "disabled"

[model_providers.copilot_dual]
name = "GitHub + Windows Copilot (local)"
base_url = "http://127.0.0.1:47832/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
supports_websockets = false

[model_providers.copilot_dual.auth]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\private\windows-copilot\bridge\token.mjs']
timeout_ms = 5000

[model_providers.copilot_dual.capabilities]
remote_compaction = "unsupported"
external_web_access = false
```

示例使用 `auth.command/args`，也可改用已获准安全传递的 `env_key`，不要两种方式
混用，不要把 token 写入 TOML；
命令认证也不要与 `requires_openai_auth` 合并，按实际版本的官方配置约束核对。
Messages 不支持托管 web 工具，Windows 不支持远程压缩，故测试配置显式禁用。
这些设置可能是 provider/客户端级别而非单模型级别；正式合并时向用户说明差异，
保留原 GitHub provider 定义，不擅自关闭其原有能力。不要为通过验收放宽 sandbox。
保留原默认 model/effort；Windows probe 指定从 metadata 得出的精确前缀 ID 和
其支持的 effort。profile、模型目录与 token 全部在用户层，不写项目 `.codex`。
隔离 home 还需显式设置所选 model/effort；只在测试 home 中按需限制项目文档读取。
不要把隔离用的 instructions/hooks 设置复制回正式用户配置。

先用实际 bundled app-server `initialize`、`model/list` 验证目录，再做获准的
真实 CLI/工具请求。实际 UI 是否支持选 profile 需检查；CLI 支持不是 UI 证据。
若 UI 只能使用默认 provider，待双路真实验收及用户同意后，备份并只改默认
provider 与 catalog、追加 bridge provider；原 GitHub provider 保留且可回滚。
主配置有后续变动则停止，不覆盖。完成 [验收](verify.md) 前不宣告成功。
