/**
 * Spreadsheet parsing for the contacts import modal — CSV text and
 * pre-split rows (from an Excel file, see parse-contact-excel.ts) both
 * funnel through the same row-building logic, so tag/company/column
 * handling stays aligned regardless of source format.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the header includes a `company` column. */
  hasCompanyColumn: boolean;
}

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const;

/**
 * Pick the field delimiter by counting candidates in the header line and
 * taking whichever splits it into the most columns.
 *
 * Why this exists: Excel's own "Save As → CSV" export uses `,` only on
 * an English/US-locale install. Excel configured for pt-BR (or most of
 * Europe/Latin America) exports `;`-delimited files instead — the
 * region's decimal separator is `,`, so a plain-comma CSV would be
 * ambiguous for any numeric column. A hardcoded `,` split then sees a
 * whole data row as a single field (no commas in it at all), which is
 * exactly the "not recognizing it as comma-separated" symptom this was
 * written to fix. Comma remains the default when nothing else appears
 * (e.g. a single-column file), preserving prior behaviour.
 */
export function detectDelimiter(headerLine: string): string {
  let best: string = CANDIDATE_DELIMITERS[0];
  let bestCount = 0;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    // Count occurrences outside quoted spans so a quoted field like
    // "Doe, John" doesn't inflate the comma count for a semicolon file.
    const count = countUnquoted(headerLine, delimiter);
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }
  return best;
}

function countUnquoted(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === char && !inQuotes) count++;
  }
  return count;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseDelimitedLine(lines[0], delimiter).map((h) =>
    h.trim().toLowerCase().replace(/["']/g, '')
  );
  const dataRows = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => parseDelimitedLine(line, delimiter));

  return buildContactRows(headerCells, dataRows);
}

/**
 * Build parsed contact rows from an already-split header + data grid.
 * Shared by the CSV text path above and the Excel path
 * (parse-contact-excel.ts), which gets cells directly from the
 * worksheet — no delimiter guessing needed there since Excel already
 * hands over real cell boundaries.
 */
export function buildContactRows(
  headerCells: string[],
  dataRows: string[][]
): ParseContactCsvResult {
  const headers = headerCells.map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');

  const rows: ParsedContactRow[] = [];

  for (const values of dataRows) {
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** CSV-style line parse (handles quoted fields) for an arbitrary delimiter. */
function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
