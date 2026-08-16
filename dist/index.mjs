import { extname } from "node:path";
import z from "@deepseek-ai/schemastery";
import { FsError } from "@deepseek-ai/dsh-fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { extractText, getDocumentProxy } from "unpdf";
//#region src/extract.ts
/**
* PDF text extraction and output presentation for the `read_pdf` tool. The
* extractor wraps unpdf (a serverless build of Mozilla PDF.js) and returns one
* text string per page; the presentation half bounds the result to a character
* budget and renders the model-facing envelope.
*/
/**
* Extract the text of every page from raw PDF bytes.
* @param data - the complete PDF file bytes.
* @returns the total page count and one entry per page, in document order.
*/
async function extractPdfText(data) {
	const bytes = data.constructor === Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const pdf = await getDocumentProxy(bytes);
	const { totalPages, text } = await extractText(pdf, { mergePages: false });
	return {
		pageCount: totalPages,
		pages: (Array.isArray(text) ? text : [text]).map((pageText, index) => ({
			page: index + 1,
			text: pageText
		}))
	};
}
/**
* Bound extracted pages to a total character budget. The page that overflows is
* truncated in place and every following page is dropped; empty pages are kept
* so page numbering stays faithful to the source document.
* @param pages - the full extracted pages.
* @param maxChars - the total character budget across all returned pages.
* @returns the bounded pages and whether truncation happened.
*/
function capPages(pages, maxChars) {
	let remaining = maxChars;
	const out = [];
	for (const page of pages) {
		if (remaining <= 0) return {
			pages: out,
			truncated: true
		};
		if (page.text.length <= remaining) {
			out.push(page);
			remaining -= page.text.length;
			continue;
		}
		out.push({
			page: page.page,
			text: page.text.slice(0, remaining)
		});
		return {
			pages: out,
			truncated: true
		};
	}
	return {
		pages: out,
		truncated: false
	};
}
/**
* Format a bounded PDF read as the model-facing envelope.
* @param value - the bounded canonical outcome.
* @param maxOutputChars - the character budget the outcome was bounded to, rendered in the truncation footer.
* @returns the model-facing envelope with per-page markers.
*/
function formatPdfReadOutput(value, maxOutputChars) {
	const body = value.pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join("\n\n");
	const footer = value.truncated ? `(Output capped at ${maxOutputChars} characters. The remaining pages were not extracted.)` : `(End of PDF - total ${value.pageCount} pages)`;
	return `<path>${value.path}</path>
<type>pdf</type>
<pages>${value.pageCount}</pages>
<content>
${body}
${footer}
</content>`;
}
//#endregion
//#region src/index.ts
/**
* A model-facing `read_pdf` tool for DeepSeek Harness: reads a PDF's bytes
* through `ctx.fs`, extracts text page by page, bounds the result, and renders
* an OpenCode-style envelope. It owns the schema, validation, path resolution,
* and formatting; it never owns a concrete filesystem backend or PDF extractor.
*/
/** Default maximum PDF file bytes read by one `read_pdf` call. */
const DEFAULT_MAX_FILE_BYTES = 52428800;
/** Default maximum extracted-text characters returned by one `read_pdf` call. */
const DEFAULT_MAX_OUTPUT_CHARS = 1e5;
/** Cordis plugin name used by loader diagnostics. */
const name = "tool-pdf";
/** Services required by the PDF tool. */
const inject = ["tools", "fs"];
const Config = z.object({
	maxFileBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_BYTES),
	maxOutputChars: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_CHARS)
});
/**
* Resolve a model-supplied path, observe absence, and require a regular file.
* Relative paths resolve against the calling agent's session workspace; a
* non-agent caller leaves the backend's own default base.
* @param ctx - the plugin context providing filesystem resolution and observation events.
* @param exec - the current tool execution, including session cwd and cancellation.
* @param requestedPath - the raw path supplied to the tool.
* @returns the resolved target and its single stat result.
*/
async function resolvePdfTarget(ctx, exec, requestedPath) {
	const cwd = exec.agent?.session.header.cwd;
	const target = await ctx.fs.resolve(requestedPath, {
		...cwd !== void 0 ? { cwd } : {},
		signal: exec.signal
	});
	const info = await ctx.fs.stat(target, exec.signal);
	if (info === void 0) {
		ctx.emit("fs/observed", target, { kind: "absent" }, exec);
		throw new FsError(`cannot read "${target.displayPath}": not found`, "FS_NOT_FOUND");
	}
	if (info.type !== "file") throw new FsError(`cannot read "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
	return {
		target,
		info
	};
}
/** Register the `read_pdf` tool. */
function apply(ctx, config) {
	const maxFileBytes = config.maxFileBytes ?? 52428800;
	const maxOutputChars = config.maxOutputChars ?? 1e5;
	ctx.tools.register(defineTool({
		name: "read_pdf",
		description: "Extract text from a PDF file, page by page, and return the extracted text.",
		parameters: { file_path: {
			type: "string",
			required: true,
			description: "Path to the PDF file, resolved by the filesystem backend."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					pageCount: {
						type: "integer",
						required: true
					},
					pages: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								page: {
									type: "integer",
									required: true
								},
								text: {
									type: "string",
									required: true
								}
							}
						}
					},
					truncated: {
						type: "boolean",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: formatPdfReadOutput(value, maxOutputChars)
			}]
		},
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			if (args.file_path.trim().length === 0) throw new Error("file_path must be a non-empty string");
			if (extname(args.file_path).toLowerCase() !== ".pdf") throw new Error(`cannot read "${args.file_path}": read_pdf only accepts PDF paths`);
			const { target, info } = await resolvePdfTarget(ctx, exec, args.file_path);
			const data = await ctx.fs.readBytes(target, exec.signal, maxFileBytes);
			let extraction;
			try {
				extraction = await extractPdfText(data);
			} catch (error) {
				throw new Error(`cannot read "${target.displayPath}" as a PDF: the file is not a readable PDF document`, { cause: error });
			}
			const { pages, truncated } = capPages(extraction.pages, maxOutputChars);
			ctx.emit("fs/observed", target, {
				kind: "present",
				version: info.version
			}, exec);
			return {
				path: target.displayPath,
				pageCount: extraction.pageCount,
				pages,
				truncated
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Read PDF ${args.file_path}`,
				kind: "read",
				locations: [{ path: args.file_path }]
			};
		}
	}));
}
//#endregion
export { Config, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_OUTPUT_CHARS, apply, inject, name };
