import { describe, it, expect } from 'vitest'
import { parseDiagnosticResponse } from './diagnostic'
import { AiError } from '@/lib/ai/types'

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    entity_type: 'ad',
    entity_id_ref: 'ad_1',
    category: 'creative_fatigue',
    priority: 'high',
    problem: 'CTR caiu 30%',
    diagnosis: 'Fadiga criativa detectada',
    recommended_action: 'Criar 3 novos criativos',
    expected_impact: 'Recuperar CTR e reduzir CPL',
    ...overrides,
  }
}

describe('parseDiagnosticResponse', () => {
  it('parses a valid { recommendations: [...] } payload', () => {
    const raw = JSON.stringify({ recommendations: [validItem()] })
    const result = parseDiagnosticResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ entity_type: 'ad', category: 'creative_fatigue', priority: 'high' })
  })

  it('accepts a bare JSON array as an alternative shape', () => {
    const raw = JSON.stringify([validItem()])
    expect(parseDiagnosticResponse(raw)).toHaveLength(1)
  })

  it('strips a markdown ```json code fence before parsing', () => {
    const raw = '```json\n' + JSON.stringify({ recommendations: [validItem()] }) + '\n```'
    expect(parseDiagnosticResponse(raw)).toHaveLength(1)
  })

  it('returns an empty array for an explicitly empty recommendations list', () => {
    expect(parseDiagnosticResponse(JSON.stringify({ recommendations: [] }))).toEqual([])
  })

  it('throws AiError(invalid_diagnostic_json) on truncated/invalid JSON', () => {
    expect(() => parseDiagnosticResponse('{ "recommendations": [ { "problem": ')).toThrowError(AiError)
    try {
      parseDiagnosticResponse('not json at all')
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('invalid_diagnostic_json')
    }
  })

  it('throws when the JSON is valid but has no recommendations array', () => {
    expect(() => parseDiagnosticResponse(JSON.stringify({ foo: 'bar' }))).toThrowError(AiError)
  })

  it('drops an item with an invalid category, keeping the valid ones', () => {
    const raw = JSON.stringify({
      recommendations: [validItem(), validItem({ category: 'not_a_real_category' })],
    })
    expect(parseDiagnosticResponse(raw)).toHaveLength(1)
  })

  it('drops an item with an invalid priority', () => {
    const raw = JSON.stringify({ recommendations: [validItem({ priority: 'urgent' })] })
    expect(parseDiagnosticResponse(raw)).toEqual([])
  })

  it('drops an item missing a required text field', () => {
    const raw = JSON.stringify({ recommendations: [validItem({ diagnosis: '' })] })
    expect(parseDiagnosticResponse(raw)).toEqual([])
  })

  it('accepts entity_id_ref: null for a funnel-category recommendation', () => {
    const raw = JSON.stringify({
      recommendations: [validItem({ entity_type: 'funnel', entity_id_ref: null, category: 'funnel' })],
    })
    const result = parseDiagnosticResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0].entity_id_ref).toBeNull()
  })

  it('defaults a missing expected_impact to null rather than dropping the item', () => {
    const raw = JSON.stringify({ recommendations: [validItem({ expected_impact: undefined })] })
    const result = parseDiagnosticResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0].expected_impact).toBeNull()
  })
})
