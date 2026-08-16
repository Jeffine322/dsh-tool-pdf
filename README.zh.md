# dsh-tool-pdf

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，添加 **`read_pdf` 工具**，用于 **PDF 文本提取**——让 AI agent（LLM）逐页读取、提取并总结 PDF 文件。

基于 [unpdf](https://github.com/unjs/unpdf)（Mozilla [PDF.js](https://mozilla.github.io/pdf.js/) 的 serverless 构建）。它通过 harness 的文件系统 seam（`ctx.fs`）读取 PDF 字节，因此与内置 `read` 工具遵守相同的工作区与沙箱策略。

**关键词：** DeepSeek Harness · dsh · dsh 插件 · read_pdf · PDF 阅读器 · PDF 文本提取 · 提取 PDF 文本 · AI agent 工具 · LLM 工具 · PDF.js · unpdf

> **`read_pdf` 是面向模型的工具，不是界面按钮。** 它不会以菜单项或设置项的形式出现。只有当模型真正读取 PDF 时，它才会在对话中出现——你通过「让模型读 PDF」来触发它。

## 快速开始

### 1. 安装到 `web` profile

`dsh web` 启动的是 **`web` profile**，所以把插件装到那里（不要装进新 profile）：

```sh
dsh plugin --profile web add github:Jeffine322/dsh-tool-pdf
```

### 2. 启动 Web UI

```sh
dsh web
```

### 3. 配置模型与工作区

在浏览器中：**设置 → 模型**（输入你的 DeepSeek API Key 并保存），然后**选择工作区**，选中包含 PDF 的目录。

### 4. 让模型读取 PDF

新建会话并说：

> 读取 `/path/to/report.pdf` 并总结。

模型会调用 `read_pdf({ file_path: "/path/to/report.pdf" })`，你就能在对话中看到提取出的文本。

### 验证是否已安装

```sh
dsh web --dump-config
```

如果输出里包含 `tool-pdf` 行（`- id: tool-pdf`、`name: dsh-tool-pdf`），说明插件已挂载。

## 安装详情

需要已安装 `dsh` CLI（在 PATH 上）。

```sh
# 从这个仓库的 git URL
dsh plugin --profile <name> add github:Jeffine322/dsh-tool-pdf

# 或从本地检出
dsh plugin --profile <name> add ./dsh-tool-pdf
```

本包声明了 `dsh.bundle`，所以 `dsh plugin` 会自动把它追加到 profile 的 bundle 层。构建产物 `dist/index.mjs` 已提交进本仓库，因此 git 安装无需构建步骤，也无需 `allowBuilds` 放行。

## 工作原理

PDF 是二进制格式，不是纯文本：页面上的可见字符以**字形码（glyph code）**的形式存放在内容流里，再通过每个字体的编码表映射回 Unicode。因此内置 `read` 工具会把 PDF 当作二进制拒绝——而 `read_pdf` 负责解码它。

解析委托给 [unpdf](https://github.com/unjs/unpdf)，它内嵌 Mozilla 的 [PDF.js](https://mozilla.github.io/pdf.js/)（Firefox 使用的引擎），所以本插件不碰 PDF 的二进制细节。流水线如下：

```text
read_pdf({ file_path })
  → 扩展名门禁（必须是 .pdf）
  → ctx.fs.resolve + stat            # 普通文件；缺失/目录 → 类型化错误
  → ctx.fs.readBytes(…, maxFileBytes)  # 遵守工作区/沙箱策略
  → 重视图为纯 Uint8Array           # pdf.js 会拒绝 Node Buffer
  → getDocumentProxy(bytes)          # 加载文档
  → extractText(pdf, { mergePages: false })  # 逐页文本
  → capPages(…, maxOutputChars)      # 限制总输出
  → formatPdfReadOutput(…)           # <path>/<pages>/<content> 信封
  → 返回文本给模型 + 发出 fs/observed
```

两重限界防止大 PDF 撑爆模型上下文：`maxFileBytes`（文件读取）和 `maxOutputChars`（提取文本）。它只提取纯文本——不含版面、表格或图片（见[限制](#限制)）。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxFileBytes` | `52428800`（50 MiB） | 每次调用读取的 PDF 文件最大字节数；更大文件以 `FS_TOO_LARGE` 失败。 |
| `maxOutputChars` | `100000` | 每次调用返回的最大提取文本字符数；溢出会截断最后一页。 |

要修改它们，在你的 profile 的 `cordis.patch.yml` 里覆盖该行（patch 会替换整个 config，所以要重述你改动的每个键）：

```yaml
- id: tool-pdf
  name: dsh-tool-pdf
  config:
    maxFileBytes: 10485760
    maxOutputChars: 50000
```

## 开发

```sh
pnpm install
pnpm build        # tsdown 把 src/*.ts 打包成 dist/index.mjs（已提交）
```

结构：

```
src/index.ts      # 插件本体：name/inject/Config/apply，注册 read_pdf
src/extract.ts    # unpdf 提取 + 输出裁剪 + 信封格式化
cordis.patch.yml  # bundle 层：插入插件行
```

插件把 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-fs` 和 `@deepseek-ai/cordis` 作为**外部导入**（通过 tsdown 的 `deps.neverBundle`），而不是打包副本，因此运行时共享运行中 harness 的单例服务实例。所以它们不声明为 npm 依赖：插件加载时由 Node 从 dsh 安装的 `node_modules` 解析。`unpdf` 和 `@deepseek-ai/schemastery` 是普通依赖。

## 限制

- **无版面或表格结构** —— 提取按阅读顺序返回纯文本；表格、多栏和图片不会被重建。
- **扫描版 PDF 没有文本层** —— 纯光栅页面提取为空文本；OCR 不在范围内。
- **加密 PDF** —— 受密码保护的文档会被报告为不可读。

## 许可证

MIT
