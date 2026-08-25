import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Real commercial attribution: campaign/ad -> lead contact -> deal.
//
// Fixes the placeholder this module's own context-gathering code
// used to rely on (src/lib/traffic/context.ts's "commercial funnel"
// section used to read `deals.contact_id = clientContactId` directly
// -- but ad_accounts.contact_id is the MANAGED CLIENT, not the leads
// that client's campaigns generate). A lead is a distinct `contacts`
// row (relationship_type = 'lead', created by the WhatsApp webhook or
// the personal-WhatsApp ingest as before) that this module now links
// back to the client contact whose ads produced it, via
// contacts.managed_by_contact_id (migration 062).
//
// Two capture paths feed attributeLeadIfNeeded below, both converging
// on the same AdReferral shape because WhatsApp attaches the same
// click-to-WhatsApp-ad metadata to the message itself regardless of
// transport:
//   - Meta Cloud API webhook: the `referral` object
//     (src/app/api/whatsapp/webhook/route.ts).
//   - Baileys personal WhatsApp: contextInfo.externalAdReply on the
//     raw message (src/lib/whatsapp-personal/ingest.ts).
// ============================================================

export interface AdReferral {
  sourceId: string | null
  sourceUrl: string | null
  ctwaClid: string | null
  headline: string | null
  body: string | null
}

/** Normalizes the Meta Cloud API webhook's `referral` object. */
export function referralFromMetaWebhook(
  referral:
    | {
        source_id?: string | null
        source_url?: string | null
        ctwa_clid?: string | null
        headline?: string | null
        body?: string | null
      }
    | null
    | undefined,
): AdReferral | null {
  if (!referral) return null
  return {
    sourceId: referral.source_id ?? null,
    sourceUrl: referral.source_url ?? null,
    ctwaClid: referral.ctwa_clid ?? null,
    headline: referral.headline ?? null,
    body: referral.body ?? null,
  }
}

/** Normalizes Baileys' `contextInfo.externalAdReply` (same ad-context
 *  shape WhatsApp forwards to the Cloud API's `referral`, just with
 *  different field casing since it comes off the raw protocol). */
export function referralFromExternalAdReply(
  info:
    | {
        sourceId?: string | null
        sourceUrl?: string | null
        ctwaClid?: string | null
        title?: string | null
        body?: string | null
      }
    | null
    | undefined,
): AdReferral | null {
  if (!info) return null
  return {
    sourceId: info.sourceId ?? null,
    sourceUrl: info.sourceUrl ?? null,
    ctwaClid: info.ctwaClid ?? null,
    headline: info.title ?? null,
    body: info.body ?? null,
  }
}

interface ResolvedAd {
  campaignId: string
  adSetId: string
  adId: string
  managedByContactId: string
  platform: 'meta' | 'google' | 'other'
}

/**
 * Walks a referral's source_id (the ad's external id, as WhatsApp
 * forwards it in ad-context metadata) back up to the specific
 * ad/ad_set/campaign/client chain in this account's Traffic module.
 * Sequential queries rather than one joined select, matching
 * src/lib/traffic/context.ts's style -- keeps each hop trivially
 * mockable in tests. Scoped by accountId at the final ad_accounts hop:
 * external ids are only unique per ad platform, not globally, so an
 * unscoped match could resolve to a different account's ad.
 */
export async function resolveAdAttribution(
  db: SupabaseClient,
  accountId: string,
  sourceId: string,
): Promise<ResolvedAd | null> {
  const { data: ad } = await db
    .from('ads')
    .select('id, ad_set_id')
    .eq('external_id', sourceId)
    .maybeSingle()
  if (!ad) return null

  const { data: adSet } = await db
    .from('ad_sets')
    .select('id, campaign_id')
    .eq('id', ad.ad_set_id)
    .maybeSingle()
  if (!adSet) return null

  const { data: campaign } = await db
    .from('ad_campaigns')
    .select('id, ad_account_id')
    .eq('id', adSet.campaign_id)
    .maybeSingle()
  if (!campaign) return null

  const { data: adAccount } = await db
    .from('ad_accounts')
    .select('id, contact_id, platform')
    .eq('id', campaign.ad_account_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!adAccount) return null

  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    adId: ad.id,
    managedByContactId: adAccount.contact_id,
    platform: adAccount.platform as 'meta' | 'google' | 'other',
  }
}

/**
 * Writes attribution onto a lead contact, at most once
 * (`attributed_at IS NULL` guard -- a contact clicking a second ad
 * later doesn't overwrite its first-touch attribution). Best-effort
 * by design: callers wrap this in try/catch and never let it fail the
 * message ingest it's attached to. A referral with no resolvable ad
 * (unknown source_id, or an ad from an account not yet registered
 * here) still records the click-level facts we do have.
 */
export async function attributeContactFromReferral(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  referral: AdReferral,
): Promise<void> {
  const resolved = referral.sourceId
    ? await resolveAdAttribution(db, accountId, referral.sourceId)
    : null

  const patch: Record<string, unknown> = {
    attribution_source: 'ctwa_referral',
    attribution_click_id: referral.ctwaClid,
    attribution_headline: referral.headline,
    attribution_source_url: referral.sourceUrl,
    attributed_at: new Date().toISOString(),
  }
  if (resolved) {
    patch.managed_by_contact_id = resolved.managedByContactId
    patch.attribution_platform = resolved.platform
    patch.attribution_campaign_id = resolved.campaignId
    patch.attribution_ad_set_id = resolved.adSetId
    patch.attribution_ad_id = resolved.adId
  }

  await db.from('contacts').update(patch).eq('id', contactId).is('attributed_at', null)
}

/**
 * Fallback for a personal WhatsApp connection pre-linked to the one
 * client it's dedicated to (whatsapp_personal_sessions.client_contact_id,
 * set in Settings). Coarser than a referral -- no specific
 * campaign/ad -- but still correctly separates this client's leads
 * from anyone else's, which is the whole point.
 */
export async function attributeContactFromPersonalSession(
  db: SupabaseClient,
  sessionId: string,
  contactId: string,
): Promise<void> {
  const { data: session } = await db
    .from('whatsapp_personal_sessions')
    .select('client_contact_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session?.client_contact_id) return

  await db
    .from('contacts')
    .update({
      managed_by_contact_id: session.client_contact_id,
      attribution_source: 'personal_whatsapp_session',
      attributed_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .is('attributed_at', null)
}

/**
 * Single call site both inbound-message paths (Meta Cloud API webhook,
 * Baileys personal ingest) use. Only runs on a contact's first inbound
 * message -- attributing a long-standing contact because they happen
 * to click an ad much later would misrepresent that ad's real yield.
 * A resolved ad referral (granular) always wins over the
 * session-level fallback (client-only, no ad detail); never both.
 */
export async function attributeLeadIfNeeded(
  db: SupabaseClient,
  params: {
    accountId: string
    contactId: string
    isFirstInboundMessage: boolean
    referral?: AdReferral | null
    personalSessionId?: string | null
  },
): Promise<void> {
  if (!params.isFirstInboundMessage) return

  if (params.referral && (params.referral.sourceId || params.referral.ctwaClid)) {
    await attributeContactFromReferral(db, params.accountId, params.contactId, params.referral)
    return
  }
  if (params.personalSessionId) {
    await attributeContactFromPersonalSession(db, params.personalSessionId, params.contactId)
  }
}

// ------------------------------------------------------------
// Commercial funnel metrics for one Traffic client, built on real
// attribution instead of the client's own contact_id. Deliberately
// stops short of "agendamentos" (no canonical pipeline stage exists
// to detect one generically -- stage names are user-defined) and a
// marketing-vs-comercial comparison view; both are listed as later
// priorities, not silently faked here.
// ------------------------------------------------------------

export interface CommercialFunnelMetrics {
  leadsCount: number
  leadsRespondedCount: number
  leadsUnattendedCount: number
  /** Null when no lead has been both messaged and answered yet. */
  avgFirstResponseMinutes: number | null
  qualifiedCount: number
  dealsCount: number
  dealsWonCount: number
  dealsLostCount: number
  /** Sum of won deals' value -- real revenue, not a projection. */
  revenue: number
  /** Total ad spend for this client's campaigns in the period,
   *  independent of how many of those campaigns produced an
   *  attributed lead -- spend on a zero-lead campaign still counts. */
  spend: number
  /** spend / dealsWonCount. Null with zero deals won (would divide by
   *  zero) -- not the same as "free," so never render this as 0. */
  cac: number | null
  /** (revenue - spend) / spend. Null with zero spend. */
  roi: number | null
}

async function sumClientSpend(
  db: SupabaseClient,
  accountId: string,
  clientContactId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const { data: adAccountRows } = await db
    .from('ad_accounts')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', clientContactId)
  const adAccountIds = ((adAccountRows ?? []) as { id: string }[]).map((a) => a.id)
  if (adAccountIds.length === 0) return 0

  const { data: campaignRows } = await db
    .from('ad_campaigns')
    .select('id')
    .in('ad_account_id', adAccountIds)
  const campaignIds = ((campaignRows ?? []) as { id: string }[]).map((c) => c.id)
  if (campaignIds.length === 0) return 0

  const { data: metricRows } = await db
    .from('traffic_metrics_daily')
    .select('spend')
    .eq('entity_type', 'campaign')
    .in('entity_id', campaignIds)
    .gte('date', periodStart)
    .lte('date', periodEnd)

  return ((metricRows ?? []) as { spend: number }[]).reduce((sum, r) => sum + (r.spend ?? 0), 0)
}

/**
 * Real (not assumed) commercial funnel for one Traffic client:
 * campaign spend -> attributed leads -> qualified -> deals -> revenue.
 * Leads are contacts with managed_by_contact_id = clientContactId, not
 * clientContactId's own deals.
 */
export async function computeCommercialFunnelMetrics(
  db: SupabaseClient,
  accountId: string,
  clientContactId: string,
  periodStart: string,
  periodEnd: string,
): Promise<CommercialFunnelMetrics> {
  const { data: leadRows } = await db
    .from('contacts')
    .select('id, lead_temperature')
    .eq('account_id', accountId)
    .eq('managed_by_contact_id', clientContactId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)

  const leads = (leadRows ?? []) as { id: string; lead_temperature: string | null }[]
  const leadIds = leads.map((l) => l.id)
  // 'cold' is the sales-qualification classifier's default for a lead
  // with no qualifying signal yet (migration 060) -- anything past it
  // has shown real buying intent, which is this metric's definition
  // of "qualified".
  const qualifiedCount = leads.filter((l) => l.lead_temperature && l.lead_temperature !== 'cold').length

  let leadsRespondedCount = 0
  let leadsUnattendedCount = 0
  let responseMinutesSum = 0
  let responseMinutesCount = 0
  let dealsCount = 0
  let dealsWonCount = 0
  let dealsLostCount = 0
  let revenue = 0

  if (leadIds.length > 0) {
    const { data: convRows } = await db
      .from('conversations')
      .select('id, contact_id')
      .in('contact_id', leadIds)
    const conversations = (convRows ?? []) as { id: string; contact_id: string }[]
    const conversationIds = conversations.map((c) => c.id)

    if (conversationIds.length > 0) {
      const { data: msgRows } = await db
        .from('messages')
        .select('conversation_id, sender_type, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: true })
      const messages = (msgRows ?? []) as {
        conversation_id: string
        sender_type: string
        created_at: string
      }[]

      const byConversation = new Map<string, typeof messages>()
      for (const m of messages) {
        const list = byConversation.get(m.conversation_id) ?? []
        list.push(m)
        byConversation.set(m.conversation_id, list)
      }

      for (const conv of conversations) {
        const convMessages = byConversation.get(conv.id) ?? []
        const firstCustomer = convMessages.find((m) => m.sender_type === 'customer')
        const firstAgent = convMessages.find(
          (m) =>
            m.sender_type === 'agent' &&
            (!firstCustomer || m.created_at >= firstCustomer.created_at),
        )
        if (firstAgent) {
          leadsRespondedCount += 1
          if (firstCustomer) {
            const minutes =
              (new Date(firstAgent.created_at).getTime() - new Date(firstCustomer.created_at).getTime()) /
              60000
            if (minutes >= 0) {
              responseMinutesSum += minutes
              responseMinutesCount += 1
            }
          }
        } else {
          leadsUnattendedCount += 1
        }
      }
    } else {
      leadsUnattendedCount = leadIds.length
    }

    const { data: dealRows } = await db.from('deals').select('id, status, value').in('contact_id', leadIds)
    const deals = (dealRows ?? []) as { id: string; status: string | null; value: number }[]
    dealsCount = deals.length
    dealsWonCount = deals.filter((d) => d.status === 'won').length
    dealsLostCount = deals.filter((d) => d.status === 'lost').length
    revenue = deals.filter((d) => d.status === 'won').reduce((sum, d) => sum + (d.value ?? 0), 0)
  }

  const spend = await sumClientSpend(db, accountId, clientContactId, periodStart, periodEnd)

  return {
    leadsCount: leads.length,
    leadsRespondedCount,
    leadsUnattendedCount,
    avgFirstResponseMinutes: responseMinutesCount > 0 ? responseMinutesSum / responseMinutesCount : null,
    qualifiedCount,
    dealsCount,
    dealsWonCount,
    dealsLostCount,
    revenue,
    spend,
    cac: dealsWonCount > 0 ? spend / dealsWonCount : null,
    roi: spend > 0 ? (revenue - spend) / spend : null,
  }
}
