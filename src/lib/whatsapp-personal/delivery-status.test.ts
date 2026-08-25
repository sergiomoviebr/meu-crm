import { describe, expect, it } from 'vitest'
import { canAdvanceMessageStatus, personalAckToStatus, receiptToStatus } from './delivery-status'

describe('personal WhatsApp delivery status', () => {
  it('maps Baileys acknowledgements to CRM statuses', () => {
    expect(personalAckToStatus(0)).toBe('failed')
    expect(personalAckToStatus(2)).toBe('sent')
    expect(personalAckToStatus(3)).toBe('delivered')
    expect(personalAckToStatus(4)).toBe('read')
    expect(personalAckToStatus(99)).toBeNull()
  })

  it('maps user receipts with their real timestamps', () => {
    expect(receiptToStatus({ receiptTimestamp: 1_700_000_000 })).toEqual({ status: 'delivered', occurredAt: '2023-11-14T22:13:20.000Z' })
    expect(receiptToStatus({ readTimestamp: 1_700_000_100 })?.status).toBe('read')
  })

  it('only advances monotonically and keeps terminal states terminal', () => {
    expect(canAdvanceMessageStatus('sent', 'delivered')).toBe(true)
    expect(canAdvanceMessageStatus('read', 'delivered')).toBe(false)
    expect(canAdvanceMessageStatus('failed', 'sent')).toBe(false)
    expect(canAdvanceMessageStatus('delivered', 'failed')).toBe(false)
  })
})
