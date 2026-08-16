# dsh-tool-pdf

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that adds a **`read_pdf` tool** for **PDF text extraction** — lets an AI agent (LLM) read, extract, and summarize PDF files, page by page.

Built on [unpdf](https://github.com/unjs/unpdf) (a serverless build of Mozilla [PDF.js](https://mozilla.github.io/pdf.js/)). It reads PDF bytes through the harness filesystem seam (`ctx.fs`), so it obeys the same workspace and sandbox policy as the built-in `read` tool.

**Keywords:** DeepSeek Harness · dsh · dsh plugin · read_pdf · PDF reader · PDF text extraction · extract text from PDF · AI agent tool · LLM tool · PDF.js · unpdf

> **`read_pdf` is a model-facing tool, not a UI button.** It does not appear as a menu item or a settings entry. It shows up in the conversation when the model actually reads a PDF — you trigger it by asking the model to read one.

## Quick start

### 1. Install into the `web` profile

`dsh web` boots the **`web` profile**, so install the plugin there (not into a new profile):

```sh
dsh plugin --profile web add github:Jeffine322/dsh-tool-pdf
```

### 2. Start the Web UI

```sh
dsh web
```

### 3. Configure a model and a workspace

In the browser: **Settings → Models** (enter your DeepSeek API key, then save), then **Choose workspace** and select the directory that contains your PDFs.

### 4. Ask the model to read a PDF

Start a session and say:

> Read `/path/to/report.pdf` and summarize it.

The model calls `read_pdf({ file_path: "/path/to/report.pdf" })`, and you see the extracted text in the conversation.

### Verify it is installed

```sh
dsh web --dump-config
```

If the output contains a `tool-pdf` row (`- id: tool-pdf`, `name: dsh-tool-pdf`), the plugin is mounted.

## Install details

Requires a `dsh` installation with the `dsh` CLI on your PATH.

```sh
# From this repo's git URL
dsh plugin --profile <name> add github:Jeffine322/dsh-tool-pdf

# Or from a local checkout
dsh plugin --profile <name> add ./dsh-tool-pdf
```

The package declares `dsh.bundle`, so `dsh plugin` appends it to the profile's bundle layers automatically. The built `dist/index.mjs` is committed to this repo, so a git install needs no build step and no `allowBuilds` approval.

## How it works

PDF is a binary format, not plain text: a page's visible characters are stored as **glyph codes** in a content stream, mapped back to Unicode through each font's encoding table. The built-in `read` tool therefore refuses PDFs as binary — `read_pdf` decodes them.

Parsing is delegated to [unpdf](https://github.com/unjs/unpdf), which bundles Mozilla's [PDF.js](https://mozilla.github.io/pdf.js/) (the engine Firefox uses), so this plugin never touches PDF's binary internals. The pipeline is:

```text
read_pdf({ file_path })
  → extension gate (must be .pdf)
  → ctx.fs.resolve + stat            # regular file; missing/dir → typed error
  → ctx.fs.readBytes(…, maxFileBytes)  # obeys workspace/sandbox policy
  → re-view as plain Uint8Array      # pdf.js rejects a Node Buffer
  → getDocumentProxy(bytes)          # load the document
  → extractText(pdf, { mergePages: false })  # text per page
  → capPages(…, maxOutputChars)      # bound the total output
  → formatPdfReadOutput(…)           # <path>/<pages>/<content> envelope
  → return text to the model + emit fs/observed
```

Two bounds keep a large PDF from blowing up the model context: `maxFileBytes` (the file read) and `maxOutputChars` (the extracted text). It extracts plain text only — no layout, tables, or images (see [Limitations](#limitations)).

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `52428800` (50 MiB) | Maximum PDF file bytes read per call; larger files fail with `FS_TOO_LARGE`. |
| `maxOutputChars` | `100000` | Maximum extracted-text characters returned per call; overflow truncates the last page. |

To change them, override the row in your profile's `cordis.patch.yml` (a patch replaces the whole config, so restate every key you change):

```yaml
- id: tool-pdf
  name: dsh-tool-pdf
  config:
    maxFileBytes: 10485760
    maxOutputChars: 50000
```

## Development

```sh
pnpm install
pnpm build        # tsdown bundles src/*.ts → dist/index.mjs (committed)
```

Structure:

```
src/index.ts      # the plugin: name/inject/Config/apply, registers read_pdf
src/extract.ts    # unpdf extraction + output capping + envelope formatting
cordis.patch.yml  # bundle layer: inserts the plugin row
```

The plugin keeps `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-fs`, and `@deepseek-ai/cordis` as **external imports** (via tsdown's `deps.neverBundle`) rather than bundled copies, so at runtime it shares the running harness's single service instances. They are therefore not declared as npm dependencies: Node resolves them against the dsh installation's `node_modules` when the plugin loads. `unpdf` and `@deepseek-ai/schemastery` are ordinary dependencies.

## Limitations

- **No layout or table structure** — extraction returns plain text in reading order; tables, columns, and images are not reconstructed.
- **Scanned PDFs have no text layer** — raster-only pages extract to empty text; OCR is out of scope.
- **Encrypted PDFs** — password-protected documents are reported as not readable.

## License

MIT
