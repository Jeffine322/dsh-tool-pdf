# dsh-tool-pdf

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a `read_pdf` tool: extract text from a PDF file, page by page.

Built on [unpdf](https://github.com/unjs/unpdf) (a serverless build of Mozilla PDF.js). It reads PDF bytes through the harness filesystem seam (`ctx.fs`), so it obeys the same workspace and sandbox policy as the built-in `read` tool.

## Install

Requires a `dsh` installation with the `dsh` CLI on your PATH.

```sh
# From this repo's git URL
dsh plugin --profile demo add github:YOUR_USERNAME/dsh-tool-pdf

# Or from a local checkout
dsh plugin --profile demo add ./dsh-tool-pdf
```

The package declares `dsh.bundle`, so `dsh plugin` appends it to the profile's bundle layers automatically.

> **Git installs build from source.** A `github:` install fetches source, so it runs this package's `prepare` script to build `dist/`. pnpm ≥ 10 blocks that build until you allow it — the first `add` prints the exact key to copy into the profile's `pnpm-workspace.yaml`:
>
> ```yaml
> allowBuilds:
>   dsh-tool-pdf: true
> ```
>
> Then re-run the `add`. Only allow packages whose source you trust; the build runs on your machine at install time.

## Usage

Boot the profile and ask the model to read a PDF:

```sh
dsh --profile demo
```

> Read `/path/to/report.pdf` and summarize it.

The model calls `read_pdf({ file_path: "/path/to/report.pdf" })` and receives the extracted text.

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
pnpm build        # tsdown bundles src/*.ts → dist/index.js
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
