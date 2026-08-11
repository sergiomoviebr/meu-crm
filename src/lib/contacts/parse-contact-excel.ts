/**
 * Excel (.xlsx/.xls) parsing for the contacts import modal. Reads the
 * first worksheet and hands its cells to the same row-building logic
 * the CSV path uses (buildContactRows in parse-contact-csv.ts), so an
 * Excel file and a CSV file with identical columns import identically.
 *
 * `exceljs` is imported dynamically (not at module top level) so its
 * ~1MB+ (it bundles zip read/write, streaming, styling — far more than
 * this feature needs) only ever loads into the browser bundle for a
 * user who actually picks an .xlsx file, not on every page that renders
 * the import modal's dropzone.
 */

import {
  buildContactRows,
  type ParseContactCsvResult,
} from './parse-contact-csv';

/** Coerce one exceljs cell value into the plain string the CSV path
 *  already works with. Cells can be a plain string/number/Date, or a
 *  richer object for formulas, hyperlinks, or rich text — this reduces
 *  all of those to their displayed text, best-effort. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as {
      text?: string;
      result?: unknown;
      richText?: { text: string }[];
      hyperlink?: string;
    };
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.result !== undefined) return cellToString(v.result);
    if (typeof v.hyperlink === 'string') return v.hyperlink;
  }
  return String(value);
}

/**
 * Parse the first worksheet of an uploaded .xlsx/.xls file into the same
 * shape parseContactCsv() produces. Returns an all-empty result (same
 * as an unparseable CSV) if the workbook has no worksheets or the
 * sheet has no header row — callers already handle that as "no valid
 * rows found."
 */
export async function parseContactExcelFile(
  file: File
): Promise<ParseContactCsvResult> {
  const ExcelJS = (await import('exceljs')).default;
  const buffer = await file.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` is 1-indexed (index 0 is always empty) — drop it so
    // column indices line up with a normal 0-indexed array, matching
    // what the CSV parser's split() produces.
    const values = (row.values as unknown[]).slice(1).map(cellToString);
    grid.push(values);
  });

  if (grid.length < 1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const [headerRow, ...dataRows] = grid;
  const headerCells = headerRow.map((h) => h.trim().toLowerCase());
  return buildContactRows(headerCells, dataRows);
}

/** True for filenames ending in .xlsx/.xls (case-insensitive) — used to
 *  route the import modal's file picker to this path instead of the
 *  plain-text CSV one. */
export function isExcelFilename(name: string): boolean {
  return /\.xlsx?$/i.test(name);
}
