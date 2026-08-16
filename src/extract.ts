/**
 * PDF text extraction and output presentation for the `read_pdf` tool. The
 * extractor wraps unpdf (a serverless build of Mozilla PDF.js) and returns one
 * text string per page; the presentation half bounds the result to a character
 * budget and renders the model-facing envelope.
 */

import { extractText, getDocumentProxy } from 'unpdf'

/** One extracted page, numbered 1-based. */
export interface PdfPage {
  /** 1-based page number. */
  page: number
  /** The page's extracted text. */
  text: string
}

/** The canonical `read_pdf` outcome declared by its output schema. */
export interface PdfReadValue {
  /** The backend-resolved path the PDF was read from. */
  path: string
  /** Total page count of the source document. */
  pageCount: number
  /** Extracted pages, bounded to the deployment's character budget. */
  pages: PdfPage[]
  /** Whether the extracted text hit the character budget and was truncated. */
  truncated: boolean
}

/**
 * Extract the text of every page from raw PDF bytes.
 * @param data - the complete PDF file bytes.
 * @returns the total page count and one entry per page, in document order.
 */
export async function extractPdfText(data: Uint8Array): Promise<{ pageCount: number; pages: PdfPage[] }> {
  // unpdf's pdf.js build rejects a Node Buffer (a Uint8Array subclass) at its
  // data-prop boundary, and the local fs backend's readBytes returns a Buffer;
  // re-view the bytes as a plain Uint8Array (zero-copy) before handing them across.
  const bytes = data.constructor === Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const pdf = await getDocumentProxy(bytes)
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pageTexts = Array.isArray(text) ? text : [text]
  return {
    pageCount: totalPages,
    pages: pageTexts.map((pageText, index) => ({ page: index + 1, text: pageText })),
  }
}

/**
 * Bound extracted pages to a total character budget. The page that overflows is
 * truncated in place and every following page is dropped; empty pages are kept
 * so page numbering stays faithful to the source document.
 * @param pages - the full extracted pages.
 * @param maxChars - the total character budget across all returned pages.
 * @returns the bounded pages and whether truncation happened.
 */
export function capPages(pages: PdfPage[], maxChars: number): { pages: PdfPage[]; truncated: boolean } {
  let remaining = maxChars
  const out: PdfPage[] = []
  for (const page of pages) {
    if (remaining <= 0) return { pages: out, truncated: true }
    if (page.text.length <= remaining) {
      out.push(page)
      remaining -= page.text.length
      continue
    }
    out.push({ page: page.page, text: page.text.slice(0, remaining) })
    return { pages: out, truncated: true }
  }
  return { pages: out, truncated: false }
}

/**
 * Format a bounded PDF read as the model-facing envelope.
 * @param value - the bounded canonical outcome.
 * @param maxOutputChars - the character budget the outcome was bounded to, rendered in the truncation footer.
 * @returns the model-facing envelope with per-page markers.
 */
export function formatPdfReadOutput(value: PdfReadValue, maxOutputChars: number): string {
  const body = value.pages.map(page => `--- Page ${page.page} ---\n${page.text}`).join('\n\n')
  const footer = value.truncated
    ? `(Output capped at ${maxOutputChars} characters. The remaining pages were not extracted.)`
    : `(End of PDF - total ${value.pageCount} pages)`
  return `<path>${value.path}</path>
<type>pdf</type>
<pages>${value.pageCount}</pages>
<content>
${body}
${footer}
</content>`
}
