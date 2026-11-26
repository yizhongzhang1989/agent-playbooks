# Roll back only this installation

1. 检查备份与本次改动后的哈希。若用户之后更改了配置，停止并合并，不整份覆盖。
2. 先恢复 Codex 的原 GitHub provider/catalog/default model/effort，或只移除本次
   独立 profile；保留原 provider 定义、普通密钥、GitHub 认证和启动项。
   新开实际目标客户端验证。切换/重载影响活跃会话，须已有授权。
3. 停本次 bridge 的精确 PID（核对启动时间、可执行文件与配置路径），不结束所有
   node/codex。不要停止原 GitHub gateway。检查它仍可鉴权读取元数据。
   若只是 Messages 升级失败，恢复本次备份的分流脚本/配置/目录，保留旧的原生
   双来源服务和 bridge key。新建测试端口/辅助进程由本次记录单独清理。
   不因回滚转换器而停止之前已经运行的 Windows relay 或续期进程。
4. 获得 App 工作中断许可后，从本次私有源目录运行正确 Python 的
   `-m copilot_app_proxy.cli stop`。它会停 keepalive/relay、关闭 App、
   从当前用户 Root 删除本次临时 CA，可能出现 Windows 确认。
   这只覆盖 launcher 登记的 worker。若本次另用公开 `keepalive` 命令启动了独立
   worker，先按本次记录核对并停止它，再执行 relay stop；不要假设 `pids.json`
   能识别所有后台 worker。停止的是核对后的 worker 进程树，不只是虚拟环境启动器。
   仅回滚桥接升级时，不停之前已有的续期或 App。
5. 对照本次证书 thumbprint 验证删除，而不是仅看退出码。用户取消删除时保留
   清理记录并明确 pending。不要删其他 CA 或系统证书，不在代理停止后留 App
   仍指向它；需要使用 App 时由用户重新正常打开。
6. `.local/token.dpapi` 可能保留；CA 私钥、token、日志和备份仍须私有。
   删除这些材料是单独的破坏性动作，先确认确切范围并验证解析后的绝对路径。
   不用递归删整个工作区、用户目录或未知旧 `.venv` 来“卸载”。

最后按实际回滚范围确认：原 GitHub 功能、配置/启动状态、本次 bridge/worker
关闭或已恢复旧版本、本次拥有的 relay/CA 清理或待处理情况。保留的旧服务不
应因通用检查表被停掉。没有实际检验项不要写 A_ROLLBACK passed。
