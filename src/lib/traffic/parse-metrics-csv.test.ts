import { describe, it, expect } from 'vitest'
import { parseMetricsCsv } from './parse-metrics-csv'

describe('parseMetricsCsv', () => {
  it('parses a well-formed comma CSV', () => {
    const csv = [
      'entity_type,entity_external_id_or_name,date,impressions,reach,clicks,spend,leads,conversions,revenue,visits',
      'campaign,Captação de Pacientes,2026-08-01,1000,800,20,100.50,5,2,400,0',
    ].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entityType: 'campaign',
      entityRef: 'Captação de Pacientes',
      date: '2026-08-01',
      impressions: 1000,
      spend: 100.5,
      leads: 5,
    })
  })

  it('detects a semicolon-delimited file (pt-BR Excel export)', () => {
    const csv = [
      'entity_type;entity_external_id_or_name;date;impressions;clicks;spend',
      'ad;Criativo A;2026-08-01;500;10;50',
    ].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ entityType: 'ad', impressions: 500, clicks: 10, spend: 50 })
  })

  it('defaults missing numeric columns to 0', () => {
    const csv = ['entity_type,entity_external_id_or_name,date', 'landing_page,LP Principal,2026-08-01'].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ impressions: 0, spend: 0, visits: 0 })
  })

  it('rejects a header missing required columns', () => {
    const csv = ['foo,bar', 'a,b'].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(rows).toEqual([])
    expect(errors[0].message).toMatch(/entity_type/)
  })

  it('rejects an invalid entity_type', () => {
    const csv = ['entity_type,entity_external_id_or_name,date', 'tiktok_ad,X,2026-08-01'].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(rows).toEqual([])
    expect(errors[0].message).toMatch(/entity_type inválido/)
  })

  it('rejects an invalid date', () => {
    const csv = ['entity_type,entity_external_id_or_name,date', 'campaign,X,08/01/2026'].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(rows).toEqual([])
    expect(errors[0].message).toMatch(/date inválida/)
  })

  it('rejects a negative or non-numeric metric value', () => {
    const csv = ['entity_type,entity_external_id_or_name,date,clicks', 'campaign,X,2026-08-01,-5'].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(rows).toEqual([])
    expect(errors[0].message).toMatch(/clicks inválido/)
  })

  it('flags a duplicate (entity_type, entity_ref, date) row within the same file', () => {
    const csv = [
      'entity_type,entity_external_id_or_name,date,clicks',
      'campaign,X,2026-08-01,10',
      'campaign,X,2026-08-01,20',
    ].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors[0].message).toMatch(/duplicada/)
  })

  it('skips blank lines', () => {
    const csv = [
      'entity_type,entity_external_id_or_name,date',
      'campaign,X,2026-08-01',
      '',
      'campaign,Y,2026-08-02',
    ].join('\n')
    const { rows, errors } = parseMetricsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
  })

  it('errors out on an empty file', () => {
    const { rows, errors } = parseMetricsCsv('')
    expect(rows).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
