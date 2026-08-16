/**
 * A model-facing `read_pdf` tool for DeepSeek Harness: reads a PDF's bytes
 * through `ctx.fs`, extracts text page by page, bounds the result, and renders
 * an OpenCode-style envelope. It owns the schema, validation, path resolution,
 * and formatting; it never owns a concrete filesystem backend or PDF extractor.
 */

import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import { capPages, extractPdfText, formatPdfReadOutput } from './extract.ts'
import type { PdfReadValue } from './extract.ts'

/** Default maximum PDF file bytes read by one `read_pdf` call. */
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024

/** Default maximum extracted-text characters returned by one `read_pdf` call. */
export const DEFAULT_MAX_OUTPUT_CHARS = 100_000

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-pdf'

/** Services required by the PDF tool. */
export const inject = ['tools', 'fs']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Maximum PDF file bytes read by one `read_pdf` call. */
  maxFileBytes?: number
  /** Maximum extracted-text characters returned by one `read_pdf` call. */
  maxOutputChars?: number
}

export const Config: z<Config> = z.object({
  maxFileBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_BYTES),
  maxOutputChars: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_CHARS),
})

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * Relative paths resolve against the calling agent's session workspace; a
 * non-agent caller leaves the backend's own default base.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its single stat result.
 */
async function resolvePdfTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, { ...cwd !== undefined ? { cwd } : {}, signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}

/** Register the `read_pdf` tool. */
export function apply(ctx: Context, config: Config): void {
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS

  ctx.tools.register(defineTool({
    name: 'read_pdf',
    description: 'Extract text from a PDF file, page by page, and return the extracted text.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the PDF file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          pageCount: { type: 'integer', required: true },
          pages: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatPdfReadOutput(value, maxOutputChars) }],
    },
    // Reading a PDF never mutates the filesystem, so concurrent reads cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
      if (extname(args.file_path).toLowerCase() !== '.pdf') {
        throw new Error(`cannot read "${args.file_path}": read_pdf only accepts PDF paths`)
      }
      const { target, info } = await resolvePdfTarget(ctx, exec, args.file_path)
      const data = await ctx.fs.readBytes(target, exec.signal, maxFileBytes)
      let extraction: Awaited<ReturnType<typeof extractPdfText>>
      try {
        extraction = await extractPdfText(data)
      } catch (error: unknown) {
        throw new Error(`cannot read "${target.displayPath}" as a PDF: the file is not a readable PDF document`, { cause: error })
      }
      const { pages, truncated } = capPages(extraction.pages, maxOutputChars)
      // Record the present observation (a no-op when no policy plugin listens).
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: PdfReadValue = {
        path: target.displayPath,
        pageCount: extraction.pageCount,
        pages,
        truncated,
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along location.
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read PDF ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
