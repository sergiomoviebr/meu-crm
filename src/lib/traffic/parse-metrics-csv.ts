import type { TrafficEntityType } from '@/types'

/**
 * CSV bulk import for `traffic_metrics_daily` — the manual-data-entry
 * path used while real ad-platform API pulls aren't wired up yet (see
 * src/lib/traffic/providers/*.ts). Mirrors
 * src/lib/contacts/parse-contact-csv.ts's delimiter-detection
 * approach; the row-building logic is different enough (numeric
 * metric columns vs. contact fields) that it's a separate small file
 * rather than a shared one.
 *
 * Expected header (case-insensitive, any column order):
 *   entity_type, entity_external_id_or_name, date, impressions, reach,
 *   clicks, spend, leads, conversions, revenue, visits
 * Only entity_type/entity_external_id_or_name/date are required — the
 * numeric columns default to 0 when the column is absent or a cell is
 * blank.
 */

export interface ParsedMetricsRow {
  entityType: TrafficEntityType
  /** The CSV's raw external_id-or-name — resolved to a real UUID by
   *  the caller (POST /api/traffic/metrics/import) before insert, so
   *  this parser stays pure/testable with no DB dependency. */
  entityRef: string
  date: string
  impressions: number
  reach: number
  clicks: number
  spend: number
  leads: number
  conversions: number
  revenue: number
  visits: number
}

export interface MetricsRowError {
  /** 1-indexed line number in the original file (header is line 1). */
  line: number
  message: string
}

export interface ParseMetricsCsvResult {
  rows: ParsedMetricsRow[]
  errors: MetricsRowError[]
}

const VALID_ENTITY_TYPES: TrafficEntityType[] = ['ad_account', 'campaign', 'ad_set', 'ad', 'landing_page']
const NUMERIC_COLUMNS = ['impressions', 'reach', 'clicks', 'spend', 'leads', 'conversions', 'revenue', 'visits'] as const

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const

/** Same header-based delimiter sniff as parse-contact-csv.ts's
 *  detectDelimiter — picks whichever candidate splits the header
 *  into the most columns. */
function detectDelimiter(headerLine: string): string {
  let best: string = CANDIDATE_DELIMITERS[0]
  let bestCount = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const count = countUnquoted(headerLine, delimiter)
    if (count > bestCount) {
      bestCount = count
      best = delimiter
    }
  }
  return best
}

function countUnquoted(line: string, char: string): number {
  let count = 0
  let inQuotes = false
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes
    else if (c === char && !inQuotes) count++
  }
  return count
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes
    else if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

function parseNonNegativeNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return 0
  const n = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function isValidDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(raw).getTime())
}

export function parseMetricsCsv(text: string): ParseMetricsCsvResult {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { rows: [], errors: [{ line: 1, message: 'CSV vazio ou sem linhas de dados.' }] }

  const delimiter = detectDelimiter(lines[0])
  const headers = parseDelimitedLine(lines[0], delimiter).map((h) => h.trim().toLowerCase().replace(/["']/g, ''))

  const entityTypeIdx = headers.indexOf('entity_type')
  const entityRefIdx = headers.indexOf('entity_external_id_or_name')
  const dateIdx = headers.indexOf('date')

  if (entityTypeIdx === -1 || entityRefIdx === -1 || dateIdx === -1) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: 'Cabeçalho precisa conter entity_type, entity_external_id_or_name e date.',
        },
      ],
    }
  }

  const numericIdx = Object.fromEntries(NUMERIC_COLUMNS.map((c) => [c, headers.indexOf(c)])) as Record<
    (typeof NUMERIC_COLUMNS)[number],
    number
  >

  const rows: ParsedMetricsRow[] = []
  const errors: MetricsRowError[] = []
  const seenKeys = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const line = i + 1 // 1-indexed, header already consumed line 1
    const values = parseDelimitedLine(raw, delimiter)

    const entityType = values[entityTypeIdx]?.replace(/["']/g, '').trim()
    if (!VALID_ENTITY_TYPES.includes(entityType as TrafficEntityType)) {
      errors.push({ line, message: `entity_type inválido: "${entityType}"` })
      continue
    }

    const entityRef = values[entityRefIdx]?.replace(/["']/g, '').trim()
    if (!entityRef) {
      errors.push({ line, message: 'entity_external_id_or_name vazio' })
      continue
    }

    const date = values[dateIdx]?.replace(/["']/g, '').trim()
    if (!date || !isValidDate(date)) {
      errors.push({ line, message: `date inválida: "${date}" (use YYYY-MM-DD)` })
      continue
    }

    const key = `${entityType}:${entityRef}:${date}`
    if (seenKeys.has(key)) {
      errors.push({ line, message: `Linha duplicada para ${entityType} "${entityRef}" em ${date}` })
      continue
    }

    const numericValues: Record<string, number> = {}
    let numericError: string | null = null
    for (const col of NUMERIC_COLUMNS) {
      const idx = numericIdx[col]
      const parsed = idx >= 0 ? parseNonNegativeNumber(values[idx]) : 0
      if (parsed == null) {
        numericError = `${col} inválido: "${values[idx]}"`
        break
      }
      numericValues[col] = parsed
    }
    if (numericError) {
      errors.push({ line, message: numericError })
      continue
    }

    seenKeys.add(key)
    rows.push({
      entityType: entityType as TrafficEntityType,
      entityRef,
      date,
      impressions: numericValues.impressions,
      reach: numericValues.reach,
      clicks: numericValues.clicks,
      spend: numericValues.spend,
      leads: numericValues.leads,
      conversions: numericValues.conversions,
      revenue: numericValues.revenue,
      visits: numericValues.visits,
    })
  }

  return { rows, errors }
}
