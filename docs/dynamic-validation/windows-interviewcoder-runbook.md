# InterviewCoder Windows 动态验证 Runbook

这份 runbook 用于在**授权的 Windows 虚拟机**中验证 `interviewcoder-setup.exe` 的运行时行为，并把可重复的证据映射回本地重建版本。

当前 Linux 容器没有 Windows VM，因此这里只提交流程和证据格式，不运行原始安装包、Electron PE 或 native agent。

## 1. 隔离环境

- 使用一次性 Windows 11 x64 VM，先创建干净快照。
- 关闭共享剪贴板、共享目录、拖放和宿主凭据同步。
- 使用测试账户，不输入真实 InterviewCoder、Google、Recall 或公司账户。
- 网络默认断开；需要观察 API 时只允许通过受控代理和目标白名单。
- 保留 VM 快照、Windows 版本、补丁级别、区域、显示器数量和音频设备信息。

## 2. 样本确认

在 VM 中复制安装包后先计算哈希。`tools/windows-dynamic-preflight.ps1` 默认会再次核对下方授权 fixture hash；不一致会直接退出，且不会启动样本：

```powershell
Get-FileHash .\interviewcoder-setup.exe -Algorithm SHA256
.\tools\windows-dynamic-preflight.ps1 -SamplePath .\interviewcoder-setup.exe
Get-Item .\interviewcoder-setup.exe | Format-List Length,CreationTimeUtc,LastWriteTimeUtc
```

期望安装包 SHA-256：

```text
37843b027f36c67153bf16fae40d94fc3542d765a5a41cb67e7fc39755a96f39
```

哈希不一致时停止该轮，保留样本和输出，不继续运行。

## 3. 观测工具

优先使用已安装且来源可信的工具：

- Process Explorer：进程树、命令行、加载模块、句柄。
- Procmon：进程、文件、注册表、进程创建和网络事件。
- Wireshark 或受控代理：DNS、TLS SNI、HTTP/WebSocket 目标和时间线。
- Windows Event Viewer：应用崩溃、代码签名和 Defender 记录。
- x64dbg/WinDbg：只在需要确认 agent 命令分发或崩溃边界时使用。

不要为动态验证关闭 Defender、绕过签名检查或修改系统安全策略。

## 4. 安装前基线

记录以下基线：

```powershell
$case = "C:\IR\interviewcoder-<date>"
New-Item -ItemType Directory -Force $case | Out-Null
Get-CimInstance Win32_OperatingSystem | Out-File "$case\os.txt"
Get-Process | Sort-Object ProcessName | Out-File "$case\processes-before.txt"
Get-ChildItem Env: | Sort-Object Name | Out-File "$case\environment.txt"
Get-ScheduledTask | Select-Object TaskName,TaskPath,State | Out-File "$case\tasks-before.txt"
reg query HKCU\Software /s /f interviewcoder /k > "$case\registry-before.txt" 2>$null
```

如果使用 Procmon，先清空 capture，再只过滤目标进程和安装器路径。

## 5. 安装阶段

1. 启动 Procmon capture。
2. 运行安装器，记录安装目录、权限请求、子进程和写入路径。
3. 记录安装后的进程树、启动项、计划任务、快捷方式和卸载项。
4. 关闭安装器后保存 Procmon PML 和筛选条件。
5. 不要把安装目录中的大文件复制回 Git 仓库。

重点路径：

```text
%LOCALAPPDATA%\InterviewCoder\
%APPDATA%\InterviewCoder\
%TEMP%\
%PROGRAMDATA%\
注册表 HKCU\Software\Microsoft\Windows\CurrentVersion\Run
```

## 6. 应用启动阶段

记录：

- `interviewcoder.exe` 的命令行、父进程和子进程。
- 是否启动 `agent-windows.exe`，何时加载 `libbot_desktop_rs.dll`。
- GStreamer DLL 搜索路径和当前工作目录。
- 本地监听端口、命名管道、临时目录和日志文件。
- Dashboard/Overlay 窗口样式、窗口标题、显示器位置和关闭行为。
- 认证失败、API 不可达和离线时的行为。

保存进程树：

```powershell
Get-CimInstance Win32_Process |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine |
  Sort-Object ParentProcessId,ProcessId |
  Export-Csv "$case\process-tree.csv" -NoTypeInformation
```

## 7. 录音与屏幕采集阶段

只使用测试会议或本地空白窗口，不录制第三方真实内容。

按顺序记录：

1. 点击开始监听前的设备和权限状态。
2. 开始录制后出现的进程、模块、临时文件和句柄。
3. `agent-windows.exe` 的 stdin/stdout/stderr 行协议。
4. 屏幕、窗口、麦克风、系统音频分别是否启动。
5. 暂停、恢复、停止、异常退出和自动重启行为。
6. 录制结束后是否删除本地缓存、临时文件和 token。

重点对照本地重建事件：

```text
capture.started
transcript.partial
transcript.final
suggestion
session.paused
session.resumed
session.stopped
capture.stopped
```

## 8. 网络阶段

只在测试账户和白名单代理中进行。记录：

- DNS 查询、TLS SNI、目标 IP 和时间。
- HTTP method、路径、状态码、响应类型和重试。
- WebSocket URL、握手头部名称和关闭码。
- `Authorization`、`x-desktop-access-token` 等敏感头的存在性；报告中只保留头名和脱敏值。
- 更新源、平台 API、Recall API、转写服务和 PostHog 等独立目标。

不要把真实 token、Cookie、Authorization 值写入 Git 或报告；用 `<redacted>` 替换。

## 9. 证据目录

每一轮动态验证使用一个新的目录：

```text
work/dynamic-validation/<yyyy-mm-dd>-<sample-hash-prefix>/
  scope.md
  hashes.txt
  vm-baseline/
  process-tree.csv
  procmon.pml
  network/
  windows-events/
  screenshots/
  redacted-notes.md
  findings.md
```

`findings.md` 使用以下格式：

```markdown
## F-001: 简短标题

- Evidence: 文件名、时间、进程 PID、事件序号或请求序号
- Observation: 看到的事实
- Confidence: high / medium / low
- Local rebuild impact: 要修改的 provider、事件或 UI
- Reproduction: 在干净 VM 中重现所需的最小步骤
- Sensitive data: 是否包含已脱敏凭据或用户内容
```

## 10. 映射回本地重建

只把动态证据支持的行为接入本地 provider：

| 动态证据 | 本地重建目标 |
|---|---|
| agent stdin/stdout 命令顺序 | `packages/providers/transcription.cjs` 事件调度 |
| 真实 pause/resume/stop 语义 | `packages/core/session.cjs` 状态转换 |
| 屏幕/窗口选择规则 | `packages/providers/capture.cjs` 和 Overlay |
| HTTP 路径和响应 schema | `services/local-api/server.cjs` 适配器测试 |
| 崩溃、重试和清理 | main 生命周期与 provider cleanup |
| 更新 manifest/签名行为 | 单独的更新适配器和测试 |

每个映射都要同时保留原始证据、脱敏摘要和对应回归测试。动态验证不能改变本地重建的安全边界：不复制真实 token、不绕过登录、不隐藏用户可见状态。
