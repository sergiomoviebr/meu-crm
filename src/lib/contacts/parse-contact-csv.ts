/**
 * Spreadsheet parsing for the contacts import modal — CSV text and
 * pre-split rows (from an Excel file, see parse-contact-excel.ts) both
 * funnel through the same row-building logic, so tag/company/column
 * handling stays aligned regardless of source format.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  preferredName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  cpf?: string;
  cnpj?: string;
  whatsapp?: string;
  secondaryPhone?: string;
  birthDay?: number;
  birthMonth?: number;
  birthYear?: number;
  addressZip?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressNeighborhood?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  source?: string;
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
  const headers = headerCells.map(normalizeHeader);

  const indexOf = (...names: string[]) =>
    names
      .map(normalizeHeader)
      .map((name) => headers.indexOf(name))
      .find((index) => index >= 0) ?? -1;
  const valueAt = (values: string[], index: number) =>
    index >= 0
      ? values[index]?.replace(/["']/g, '').trim() || undefined
      : undefined;

  const phoneIdx = indexOf('phone', 'telefone', 'celular');
  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const nameIdx = indexOf('name', 'nome', 'nome completo');
  const preferredNameIdx = indexOf('preferred_name', 'nome preferido');
  const emailIdx = indexOf('email', 'e-mail');
  const companyIdx = indexOf('company', 'empresa');
  const jobTitleIdx = indexOf('job_title', 'cargo');
  const cpfIdx = indexOf('cpf');
  const cnpjIdx = indexOf('cnpj');
  const whatsappIdx = indexOf('whatsapp');
  const secondaryPhoneIdx = indexOf('secondary_phone', 'segundo telefone');
  const birthDateIdx = indexOf(
    'birth_date',
    'data de nascimento',
    'aniversario'
  );
  const zipIdx = indexOf('address_zip', 'cep');
  const streetIdx = indexOf('address_street', 'endereco', 'rua');
  const numberIdx = indexOf('address_number', 'numero');
  const complementIdx = indexOf('address_complement', 'complemento');
  const neighborhoodIdx = indexOf('address_neighborhood', 'bairro');
  const cityIdx = indexOf('address_city', 'cidade');
  const stateIdx = indexOf('address_state', 'estado', 'uf');
  const countryIdx = indexOf('address_country', 'pais');
  const sourceIdx = indexOf('source', 'origem');
  const tagsIdx = indexOf('tags', 'etiquetas');

  const rows: ParsedContactRow[] = [];

  for (const values of dataRows) {
    const phone = valueAt(values, phoneIdx);
    if (!phone) continue;

    const birth = parseBirthDate(valueAt(values, birthDateIdx));
    const extra = Object.fromEntries(
      [
        ['preferredName', valueAt(values, preferredNameIdx)],
        ['jobTitle', valueAt(values, jobTitleIdx)],
        ['cpf', valueAt(values, cpfIdx)],
        ['cnpj', valueAt(values, cnpjIdx)],
        ['whatsapp', valueAt(values, whatsappIdx)],
        ['secondaryPhone', valueAt(values, secondaryPhoneIdx)],
        ['addressZip', valueAt(values, zipIdx)],
        ['addressStreet', valueAt(values, streetIdx)],
        ['addressNumber', valueAt(values, numberIdx)],
        ['addressComplement', valueAt(values, complementIdx)],
        ['addressNeighborhood', valueAt(values, neighborhoodIdx)],
        ['addressCity', valueAt(values, cityIdx)],
        ['addressState', valueAt(values, stateIdx)],
        ['addressCountry', valueAt(values, countryIdx)],
        ['source', valueAt(values, sourceIdx)],
      ].filter((entry) => entry[1] !== undefined)
    );

    rows.push({
      phone,
      name: valueAt(values, nameIdx),
      email: valueAt(values, emailIdx),
      company: valueAt(values, companyIdx),
      ...extra,
      ...birth,
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

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["']/g, '')
    .replace(/[\s-]+/g, '_');
}

function parseBirthDate(value?: string): {
  birthDay?: number;
  birthMonth?: number;
  birthYear?: number;
} {
  if (!value) return {};
  const parts = value.trim().split(/[\/-]/).map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part)))
    return {};
  const isoFirst = String(parts[0]).length === 4;
  const year = isoFirst ? parts[0] : parts[2];
  const month = isoFirst ? parts[1] : parts[1];
  const day = isoFirst ? parts[2] : parts[0];
  if (!day || !month || day > 31 || month > 12) return {};
  return {
    birthDay: day,
    birthMonth: month,
    ...(year && year >= 1900 ? { birthYear: year } : {}),
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
