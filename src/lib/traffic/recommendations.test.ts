import { describe, it, expect } from 'vitest'
import { transitionRecommendation, RECOMMENDATION_TRANSITIONS } from './recommendations'

function fakeAdmin(existing: { id: string; status: string; contact_id: string } | null) {
  const updates: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []

  const admin = {
    from(table: string) {
      if (table === 'traffic_recommendations') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: async () => ({ data: existing, error: null }) }
                  },
                }
              },
            }
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload)
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { ...existing, ...payload }, error: null }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'traffic_optimization_log') {
        return { insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }

  return { admin: admin as never, updates, inserts }
}

describe('RECOMMENDATION_TRANSITIONS', () => {
  it('defines the 5 workflow actions', () => {
    expect(Object.keys(RECOMMENDATION_TRANSITIONS).sort()).toEqual(
      ['approve', 'complete', 'dismiss', 'review', 'start'].sort(),
    )
  })
})

describe('transitionRecommendation', () => {
  it('moves a new recommendation to in_review', async () => {
    const { admin, updates, inserts } = fakeAdmin({ id: 'r1', status: 'new', contact_id: 'c1' })
    const result = await transitionRecommendation(admin, {
      id: 'r1',
      accountId: 'a1',
      actorUserId: 'u1',
      action: 'review',
    })
    expect(result.error).toBeUndefined()
    expect(updates[0]).toMatchObject({ status: 'in_review' })
    expect(inserts[0]).toMatchObject({ event: 'status_changed', recommendation_id: 'r1' })
  })

  it('rejects an illegal transition (cannot complete a brand-new recommendation)', async () => {
    const { admin, updates } = fakeAdmin({ id: 'r1', status: 'new', contact_id: 'c1' })
    const result = await transitionRecommendation(admin, {
      id: 'r1',
      accountId: 'a1',
      actorUserId: 'u1',
      action: 'complete',
    })
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/Cannot complete/)
    expect(updates).toEqual([])
  })

  it('returns 404 when the recommendation is not found for this account', async () => {
    const { admin } = fakeAdmin(null)
    const result = await transitionRecommendation(admin, {
      id: 'missing',
      accountId: 'a1',
      actorUserId: 'u1',
      action: 'approve',
    })
    expect(result.status).toBe(404)
  })

  it('allows dismissing from any non-terminal status', async () => {
    for (const status of ['new', 'in_review', 'approved', 'in_progress']) {
      const { admin } = fakeAdmin({ id: 'r1', status, contact_id: 'c1' })
      const result = await transitionRecommendation(admin, {
        id: 'r1',
        accountId: 'a1',
        actorUserId: 'u1',
        action: 'dismiss',
      })
      expect(result.error).toBeUndefined()
    }
  })
})
