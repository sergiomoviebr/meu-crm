// ============================================================
// Demo data seeder — fantasy clients, conversations, content posts
// and traffic/AI-copilot data so the CRM can be explored visually
// without needing real WhatsApp/ad-platform/AI credentials.
//
// Not part of the app runtime. Run manually against a LOCAL
// Supabase instance only:
//   node scripts/seed-demo-data.mjs
//
// Safe to re-run: it always deletes rows it previously created for
// the same account (tagged via a fixed marker in contacts.email
// domain) before inserting fresh ones.
// ============================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var is required (service-role key, local only).')
  process.exit(1)
}
if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  console.error('Refusing to run against a non-local Supabase URL:', SUPABASE_URL)
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)
const DEMO_EMAIL_DOMAIN = 'demo.wacrm.local' // marks rows this script owns, for safe re-seeding

function daysAgo(n, from = new Date()) {
  const d = new Date(from)
  d.setDate(d.getDate() - n)
  return d
}
function isoDate(d) {
  return d.toISOString().slice(0, 10)
}
function isoAt(d) {
  return d.toISOString()
}
function rand(min, max) {
  return min + Math.random() * (max - min)
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function main() {
  console.log('== Seeding demo data ==')

  const { data: profileRow, error: profileErr } = await db
    .from('profiles')
    .select('user_id, account_id')
    .limit(1)
    .maybeSingle()
  if (profileErr || !profileRow) {
    console.error('No profile found — sign up / bootstrap an account first.', profileErr)
    process.exit(1)
  }
  const ACCOUNT_ID = profileRow.account_id
  const USER_ID = profileRow.user_id
  console.log(`Using account ${ACCOUNT_ID}, user ${USER_ID}`)

  await cleanupPrevious(ACCOUNT_ID)

  const contacts = await seedContacts(ACCOUNT_ID, USER_ID)
  await seedConversations(ACCOUNT_ID, USER_ID, contacts)
  const { stages } = await seedPipelineAndDeals(ACCOUNT_ID, USER_ID, contacts)
  const socialProfilesByContact = await seedContentModule(ACCOUNT_ID, USER_ID, contacts)
  await seedTrafficModule(ACCOUNT_ID, USER_ID, contacts)

  console.log('\n== Done. Refresh the app to see it. ==')
  console.log(`Contacts: ${contacts.length}`)
}

async function cleanupPrevious(accountId) {
  console.log('Cleaning up any previous demo data…')
  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .like('email', `%@${DEMO_EMAIL_DOMAIN}`)
  const ids = (existing ?? []).map((c) => c.id)
  if (ids.length > 0) {
    // Cascades (ON DELETE CASCADE) take care of conversations/messages,
    // deals, social_profiles/content_posts, ad_accounts/.../ads,
    // landing_pages, traffic_recommendations/tasks/log.
    await db.from('contacts').delete().in('id', ids)
    console.log(`  removed ${ids.length} previous demo contact(s) and everything under them`)
  }
  // Pipeline is account-scoped, not per-contact — remove the demo one by name.
  await db.from('pipelines').delete().eq('account_id', accountId).eq('name', 'Funil Comercial (Demo)')
}

// ------------------------------------------------------------
// 1. Contacts (the "clients")
// ------------------------------------------------------------
async function seedContacts(accountId, userId) {
  const defs = [
    { name: 'Clínica Bella Vita', phone: '+5511987650001', company: 'Clínica Bella Vita', segment: 'clinic' },
    { name: 'Trend Fashion Store', phone: '+5511987650002', company: 'Trend Fashion', segment: 'fashion' },
    { name: 'Restaurante Sabor Real', phone: '+5511987650003', company: 'Sabor Real', segment: 'restaurant' },
    { name: 'Academia PowerFit', phone: '+5511987650004', company: 'PowerFit', segment: 'gym' },
    { name: 'Studio Beleza Prime', phone: '+5511987650005', company: 'Beleza Prime', segment: 'beauty' },
  ]
  const rows = defs.map((d) => ({
    user_id: userId,
    account_id: accountId,
    name: d.name,
    phone: d.phone,
    email: `contato@${d.company.toLowerCase().replace(/\s+/g, '')}.${DEMO_EMAIL_DOMAIN}`,
    company: d.company,
  }))
  const { data, error } = await db.from('contacts').insert(rows).select()
  if (error) throw error
  console.log(`✓ ${data.length} clientes fantasia criados`)
  return data.map((c, i) => ({ ...c, segment: defs[i].segment }))
}

// ------------------------------------------------------------
// 2. Conversations + messages (WhatsApp inbox + AI auto-reply demo)
// ------------------------------------------------------------
async function seedConversations(accountId, userId, contacts) {
  const scripts = {
    clinic: [
      ['customer', 'Oi, boa tarde! Vocês têm horário disponível essa semana para avaliação?'],
      ['bot', 'Olá! Tudo bem? 😊 Temos horários na quarta e sexta, período da tarde. Qual seria melhor para você?'],
      ['customer', 'Sexta à tarde é ótimo pra mim'],
      ['bot', 'Perfeito! Vou verificar com a recepção e já te confirmo o horário exato. Pode ser às 15h?'],
      ['customer', 'Pode sim, obrigada!'],
      ['agent', 'Oi! Aqui é a Fernanda da clínica. Confirmado sexta às 15h, te aguardamos 💙'],
    ],
    fashion: [
      ['customer', 'Aquele vestido que vi no Instagram ainda tem no tamanho M?'],
      ['bot', 'Oi! Deixa eu confirmar o estoque pra você — só um instante 🙏'],
      ['agent', 'Oi! Temos sim, em 2 cores: preto e vinho. Qual prefere?'],
      ['customer', 'Vinho! Como faço pra comprar?'],
      ['agent', 'Te mando o link do checkout aqui, só um momento'],
    ],
    restaurant: [
      ['customer', 'Vocês fazem reserva pra hoje à noite, mesa pra 6 pessoas?'],
      ['bot', 'Boa tarde! Deixa eu verificar a disponibilidade pra hoje às 20h, pode ser?'],
      ['customer', 'Pode sim'],
      ['bot', 'Consegui encaixar sim! Reserva confirmada pra 6 pessoas às 20h. Algum pedido especial (aniversário, restrição alimentar)?'],
      ['customer', 'É aniversário de um amigo, se puder trazer uma sobremesa surpresa seria ótimo'],
      ['agent', 'Combinado! Vamos preparar uma surpresa especial 🎉'],
    ],
    gym: [
      ['customer', 'Qual o valor do plano trimestral?'],
      ['bot', 'Oi! O plano trimestral está R$ 289,90 (R$ 96,63/mês), com acesso a musculação e todas as aulas coletivas. Quer que eu te envie mais detalhes?'],
      ['customer', 'Quero sim, e tem taxa de matrícula?'],
      ['bot', 'Nesse mês a matrícula está isenta em qualquer plano a partir de 3 meses 🎉'],
      ['customer', 'Show, vou aparecer aí essa semana'],
    ],
    beauty: [
      ['customer', 'Vi as fotos das unhas em gel no Instagram, vocês atendem sábado?'],
      ['bot', 'Oi! Sim, atendemos sábado das 9h às 17h. Quer que eu já veja um horário disponível?'],
      ['customer', 'Quero, de manhã se possível'],
      ['agent', 'Consegui às 10h30 no sábado, pode ser?'],
      ['customer', 'Perfeito, pode confirmar'],
    ],
  }

  for (const contact of contacts) {
    const { data: conv, error } = await db
      .from('conversations')
      .insert({ user_id: userId, account_id: accountId, contact_id: contact.id, status: 'open' })
      .select()
      .single()
    if (error) throw error

    const script = scripts[contact.segment]
    const now = new Date()
    const rows = script.map(([senderType, text], i) => ({
      conversation_id: conv.id,
      sender_type: senderType,
      content_type: 'text',
      content_text: text,
      status: 'read',
      created_at: isoAt(new Date(now.getTime() - (script.length - i) * 6 * 60000)),
    }))
    const { error: msgErr } = await db.from('messages').insert(rows)
    if (msgErr) throw msgErr

    const last = rows[rows.length - 1]
    await db
      .from('conversations')
      .update({ last_message_text: last.content_text, last_message_at: last.created_at, unread_count: 0 })
      .eq('id', conv.id)
  }
  console.log(`✓ Conversas e mensagens (com respostas de IA simuladas) criadas`)
}

// ------------------------------------------------------------
// 3. Pipeline + deals — the commercial funnel (Lead -> ... -> Venda)
// ------------------------------------------------------------
async function seedPipelineAndDeals(accountId, userId, contacts) {
  const { data: pipeline, error: pErr } = await db
    .from('pipelines')
    .insert({ user_id: userId, account_id: accountId, name: 'Funil Comercial (Demo)' })
    .select()
    .single()
  if (pErr) throw pErr

  const stageDefs = [
    { name: 'Lead', color: '#3b82f6', position: 0 },
    { name: 'Contato', color: '#6366f1', position: 1 },
    { name: 'Agendamento', color: '#eab308', position: 2 },
    { name: 'Oportunidade', color: '#f97316', position: 3 },
    { name: 'Venda', color: '#22c55e', position: 4 },
  ]
  const { data: stages, error: sErr } = await db
    .from('pipeline_stages')
    .insert(stageDefs.map((s) => ({ ...s, pipeline_id: pipeline.id })))
    .select()
  if (sErr) throw sErr
  const stageByName = Object.fromEntries(stages.map((s) => [s.name, s]))

  // Deliberate funnel-shape mix per client — most volume near the top,
  // a visible drop-off before "Oportunidade" for one client (feeds the
  // "gargalo comercial, não de tráfego" recommendation), and a couple
  // of closed deals for realism.
  const dealPlan = [
    { contactIdx: 0, deals: [['Lead', 1], ['Lead', 1], ['Contato', 1], ['Agendamento', 1]] }, // Clínica: lots of leads, funnel narrows
    { contactIdx: 1, deals: [['Lead', 1], ['Contato', 1], ['Oportunidade', 1], ['Venda', 1]] },
    { contactIdx: 2, deals: [['Lead', 1], ['Lead', 1], ['Agendamento', 1]] },
    { contactIdx: 3, deals: [['Lead', 1], ['Contato', 1], ['Contato', 1], ['Oportunidade', 1]] },
  ]
  const rows = []
  for (const plan of dealPlan) {
    const contact = contacts[plan.contactIdx]
    plan.deals.forEach(([stageName], i) => {
      rows.push({
        user_id: userId,
        account_id: accountId,
        pipeline_id: pipeline.id,
        stage_id: stageByName[stageName].id,
        contact_id: contact.id,
        title: `${contact.company} — oportunidade ${i + 1}`,
        value: Math.round(rand(300, 3500)),
        currency: 'BRL',
        status: stageName === 'Venda' ? 'won' : 'open',
      })
    })
  }
  const { error: dErr } = await db.from('deals').insert(rows)
  if (dErr) throw dErr
  console.log(`✓ Funil comercial (pipeline + ${rows.length} negócios) criado`)
  return { pipeline, stages }
}

// ------------------------------------------------------------
// 4. Content & Social module
// ------------------------------------------------------------
async function seedContentModule(accountId, userId, contacts) {
  const platformsByContact = {
    clinic: ['instagram', 'facebook'],
    fashion: ['instagram', 'facebook', 'linkedin'],
    restaurant: ['instagram', 'facebook'],
    gym: ['instagram'],
    beauty: ['instagram', 'facebook'],
  }

  const captionBank = {
    clinic: [
      { caption: 'Cuidar de você é o nosso propósito 💙 Agende sua avaliação gratuita esta semana!', hashtags: ['#saude', '#bemestar', '#clinicabellavita'] },
      { caption: 'Novidade: agora com atendimento também aos sábados! Confira nossos horários.', hashtags: ['#novidade', '#saude'] },
      { caption: 'Depoimento real de paciente: "Nunca me senti tão bem cuidada." ❤️', hashtags: ['#depoimento', '#confianca'] },
    ],
    fashion: [
      { caption: 'Coleção nova chegou! Peças exclusivas com até 30% OFF só essa semana ✨', hashtags: ['#moda', '#novacolecao', '#trendfashion'] },
      { caption: 'Look do dia 🖤 Combina com qualquer ocasião. Disponível em 4 cores.', hashtags: ['#lookdodia', '#moda'] },
      { caption: 'Últimas peças do estoque de inverno! Corre que acaba rápido.', hashtags: ['#promocao', '#inverno'] },
    ],
    restaurant: [
      { caption: 'Sexta é dia de feijoada! Reserve sua mesa 🍲', hashtags: ['#feijoada', '#saborreal', '#gastronomia'] },
      { caption: 'Novo prato no cardápio: risoto de camarão com toque especial da casa 🦐', hashtags: ['#novocardapio', '#gastronomia'] },
      { caption: 'Happy hour todos os dias das 18h às 20h 🍹', hashtags: ['#happyhour'] },
    ],
    gym: [
      { caption: 'Bora começar a semana com tudo? Aula de HIIT às 7h! 🔥', hashtags: ['#treino', '#powerfit', '#hiit'] },
      { caption: 'Resultado real de aluno em 90 dias de treino 💪', hashtags: ['#resultado', '#transformacao'] },
      { caption: 'Matrícula sem taxa esse mês! Vem treinar com a gente.', hashtags: ['#promocao', '#matricula'] },
    ],
    beauty: [
      { caption: 'Unhas em gel com design personalizado 💅 Agende seu horário!', hashtags: ['#unhas', '#belezaprime'] },
      { caption: 'Dica de cuidado: hidrate suas cutículas diariamente para unhas mais fortes.', hashtags: ['#dicabeleza'] },
      { caption: 'Promoção de sobrancelha + design esse mês 👁️', hashtags: ['#sobrancelha', '#promocao'] },
    ],
  }

  const socialProfilesByContact = {}
  const now = new Date()

  for (const contact of contacts) {
    const platforms = platformsByContact[contact.segment]
    const profiles = []
    for (const platform of platforms) {
      const handle =
        platform === 'linkedin'
          ? contact.company.replace(/\s+/g, '-').toLowerCase()
          : `@${contact.company.replace(/\s+/g, '').toLowerCase()}`
      const { data: profile, error } = await db
        .from('social_profiles')
        .insert({
          account_id: accountId,
          contact_id: contact.id,
          user_id: userId,
          platform,
          handle,
          display_name: contact.company,
          connection_status: 'not_connected', // honest: no real OAuth wired up yet
        })
        .select()
        .single()
      if (error) throw error
      profiles.push(profile)
    }
    socialProfilesByContact[contact.id] = profiles

    // One content post per lifecycle status, so every filter/tab in
    // /content/posts and /content/calendar has something to show.
    const captions = captionBank[contact.segment]
    const igProfile = profiles.find((p) => p.platform === 'instagram') ?? profiles[0]
    const fbProfile = profiles.find((p) => p.platform === 'facebook')

    const postDefs = [
      { status: 'draft', capIdx: 0, targets: [igProfile] },
      { status: 'pending_approval', capIdx: 1, targets: [igProfile, fbProfile].filter(Boolean) },
      { status: 'approved', capIdx: 2, targets: [igProfile] },
      { status: 'scheduled', capIdx: 0, targets: [igProfile], scheduledInDays: 2 },
      { status: 'published', capIdx: 1, targets: [igProfile, fbProfile].filter(Boolean), publishedDaysAgo: 3 },
      { status: 'published', capIdx: 2, targets: [igProfile], publishedDaysAgo: 8 },
      {
        status: 'failed',
        capIdx: 0,
        targets: [igProfile],
        scheduledInDays: -1,
        errorMessage: 'Instagram account is not connected. Configure a real access token to enable publishing.',
      },
      { status: 'cancelled', capIdx: 1, targets: [fbProfile ?? igProfile] },
    ]

    for (const def of postDefs) {
      const cap = captions[def.capIdx % captions.length]
      const seed = `${contact.id}-${def.status}-${def.capIdx}`.replace(/[^a-z0-9]/gi, '')
      const media = [{ url: `https://picsum.photos/seed/${seed}/600/600`, path: `demo/${seed}.jpg`, kind: 'image', position: 0 }]

      const row = {
        account_id: accountId,
        contact_id: contact.id,
        created_by: userId,
        content_type: 'image',
        caption: cap.caption,
        hashtags: cap.hashtags,
        media,
        link_url: null,
        cta: pick(['Saiba mais', 'Agende agora', 'Peça já', null]),
        status: def.status,
        scheduled_at: def.scheduledInDays != null ? isoAt(daysAgo(-def.scheduledInDays, now)) : null,
        published_at: def.publishedDaysAgo != null ? isoAt(daysAgo(def.publishedDaysAgo, now)) : null,
        error_message: def.errorMessage ?? null,
      }
      const { data: post, error: postErr } = await db.from('content_posts').insert(row).select().single()
      if (postErr) throw postErr

      const targetRows = def.targets.map((p) => ({
        post_id: post.id,
        social_profile_id: p.id,
        status: def.status === 'published' ? 'published' : def.status === 'failed' ? 'failed' : 'pending',
        error_code: def.status === 'failed' ? 'provider_not_configured' : null,
        error_message: def.status === 'failed' ? def.errorMessage : null,
        published_at: def.status === 'published' ? row.published_at : null,
      }))
      if (targetRows.length > 0) {
        const { error: targetErr } = await db.from('content_post_targets').insert(targetRows)
        if (targetErr) throw targetErr
      }
    }
  }
  console.log('✓ Perfis sociais e conteúdos (todos os status) criados')
  return socialProfilesByContact
}

// ------------------------------------------------------------
// 5. Traffic & Performance module — accounts, campaigns, ad sets,
// ads (with a deliberate fatigue trend), metrics, landing pages, and
// AI-style recommendations/tasks/history.
// ------------------------------------------------------------
async function seedTrafficModule(accountId, userId, contacts) {
  // Only 4 of the 5 clients get a full traffic setup — the 5th
  // (beauty studio) stays traffic-empty on purpose, so the executive
  // view / "clientes monitorados" count also shows a client with
  // nothing to diagnose yet (realistic: not every client onboarded).
  const withTraffic = contacts.filter((c) => c.segment !== 'beauty')

  for (const contact of withTraffic) {
    await seedClientTraffic(accountId, userId, contact)
  }
  console.log('✓ Contas de anúncio, campanhas, criativos e métricas (30 dias) criados')
  console.log('✓ Recomendações, tarefas e histórico de otimização (estilo IA) criados')
}

async function seedClientTraffic(accountId, userId, contact) {
  const { data: metaAccount, error: e1 } = await db
    .from('ad_accounts')
    .insert({
      account_id: accountId,
      contact_id: contact.id,
      user_id: userId,
      platform: 'meta',
      name: `Meta Ads — ${contact.company}`,
      connection_status: 'not_connected',
      currency: 'BRL',
    })
    .select()
    .single()
  if (e1) throw e1

  const { data: campaign, error: e2 } = await db
    .from('ad_campaigns')
    .insert({
      ad_account_id: metaAccount.id,
      name: `Captação de Leads — ${contact.company}`,
      objective: 'Geração de leads',
      status: 'active',
      budget: Math.round(rand(40, 120)),
      budget_type: 'daily',
      currency: 'BRL',
      start_date: isoDate(daysAgo(35)),
    })
    .select()
    .single()
  if (e2) throw e2

  const { data: adSet, error: e3 } = await db
    .from('ad_sets')
    .insert({
      campaign_id: campaign.id,
      name: 'Público principal — 25-45 anos',
      targeting_summary: 'Interesses relacionados ao segmento, raio de 15km, 25-45 anos',
      budget: Math.round(rand(30, 90)),
      status: 'active',
    })
    .select()
    .single()
  if (e3) throw e3

  const { data: landingPage, error: e4 } = await db
    .from('landing_pages')
    .insert({
      account_id: accountId,
      contact_id: contact.id,
      name: `Página de captação — ${contact.company}`,
      url: `https://${contact.company.toLowerCase().replace(/\s+/g, '')}.com.br/promo`,
    })
    .select()
    .single()
  if (e4) throw e4

  // Two ads: one healthy/recent, one fatigued (declining CTR, running
  // long enough to cross the "replace" threshold in signals.ts).
  const { data: healthyAd, error: e5 } = await db
    .from('ads')
    .insert({
      ad_set_id: adSet.id,
      name: `Criativo Novo — ${contact.company}`,
      headline: 'Confira a novidade!',
      cta: 'Saiba mais',
      landing_page_id: landingPage.id,
      status: 'active',
      launched_at: isoDate(daysAgo(6)),
    })
    .select()
    .single()
  if (e5) throw e5

  const { data: fatiguedAd, error: e6 } = await db
    .from('ads')
    .insert({
      ad_set_id: adSet.id,
      name: `Criativo Principal — ${contact.company}`,
      headline: 'Oferta especial esta semana',
      cta: 'Peça já',
      landing_page_id: landingPage.id,
      status: 'active',
      launched_at: isoDate(daysAgo(32)),
    })
    .select()
    .single()
  if (e6) throw e6

  // --- Metrics: 30 days, at ad_account level (dashboard/report totals)
  //     and at ad level (per-creative fatigue detection) ---
  const accountSeries = genSeries({ days: 30, baseImpressions: rand(1800, 3200), baseCtr: 0.021, ctrTrend: 'stable', baseCpm: rand(22, 34), leadRate: 0.09 })
  await insertMetrics(accountId, 'ad_account', metaAccount.id, accountSeries, userId)

  const healthySeries = genSeries({ days: 30, baseImpressions: rand(300, 600), baseCtr: 0.024, ctrTrend: 'stable', baseCpm: rand(20, 28), leadRate: 0.1 })
  await insertMetrics(accountId, 'ad', healthyAd.id, healthySeries, userId)

  const fatiguedSeries = genSeries({ days: 30, baseImpressions: rand(700, 1100), baseCtr: 0.026, ctrTrend: 'decline', baseCpm: rand(20, 26), cpmTrend: 'rise', leadRate: 0.08 })
  await insertMetrics(accountId, 'ad', fatiguedAd.id, fatiguedSeries, userId)

  const lpSeries = genLandingPageSeries({ days: 30, baseVisits: rand(60, 110), baseConvRate: 0.14, trend: 'decline' })
  await insertMetrics(accountId, 'landing_page', landingPage.id, lpSeries, userId)

  // --- Recommendations, written in the exact shape/voice the real AI
  //     diagnostic engine (src/lib/traffic/diagnostic.ts) would produce,
  //     computed against the fatigue trend just seeded above. ---
  const last7 = fatiguedSeries.slice(-7)
  const prev7 = fatiguedSeries.slice(-14, -7)
  const ctrNow = last7.reduce((a, r) => a + r.clicks, 0) / last7.reduce((a, r) => a + r.impressions, 0)
  const ctrPrev = prev7.reduce((a, r) => a + r.clicks, 0) / prev7.reduce((a, r) => a + r.impressions, 0)
  const ctrDropPct = Math.round((1 - ctrNow / ctrPrev) * 100)

  const recDefs = [
    {
      entity_type: 'ad',
      entity_id: fatiguedAd.id,
      category: 'creative_fatigue',
      priority: ctrDropPct >= 35 ? 'critical' : 'high',
      status: 'new',
      problem: `O criativo "${fatiguedAd.name}" está com queda de desempenho.`,
      diagnosis: `O CTR caiu ${ctrDropPct}% nos últimos 7 dias e o criativo está ativo há mais de 30 dias. Há indício claro de fadiga criativa — o público já viu este anúncio muitas vezes.`,
      recommended_action: 'Criar 2-3 novas variações do criativo mantendo a mesma oferta, mas alterando o gancho, a abertura visual e o CTA.',
      expected_impact: 'Recuperação do CTR e redução do CPL nos próximos 5-7 dias.',
    },
    {
      entity_type: 'landing_page',
      entity_id: landingPage.id,
      category: 'landing_page',
      priority: 'medium',
      status: 'new',
      problem: 'A taxa de conversão da landing page está em queda.',
      diagnosis: 'O tráfego para a página se manteve estável, mas a taxa de conversão de visita para lead caiu nas últimas semanas — o problema não parece estar no anúncio, e sim na página.',
      recommended_action: 'Revisar a headline, a proposta de valor, o CTA principal e adicionar prova social (depoimentos) acima da dobra.',
      expected_impact: 'Aumento da taxa de conversão sem precisar aumentar investimento em tráfego.',
    },
    {
      entity_type: 'funnel',
      entity_id: null,
      category: 'funnel',
      priority: 'medium',
      status: 'in_review',
      problem: 'Boa geração de leads, mas baixo avanço para as etapas comerciais.',
      diagnosis: 'O tráfego está gerando leads a um custo saudável. Entretanto, poucos leads avançam para as etapas de Contato e Agendamento. O principal gargalo não está na campanha, e sim no processo comercial.',
      recommended_action: 'Revisar o tempo de resposta do time comercial e o roteiro de follow-up para os leads recém-chegados.',
      expected_impact: 'Mais leads avançando no funil sem custo adicional de mídia.',
    },
    {
      entity_type: 'campaign',
      entity_id: campaign.id,
      category: 'budget',
      priority: 'low',
      status: 'approved',
      problem: 'A campanha apresenta espaço para escala.',
      diagnosis: 'O CPL se manteve estável e abaixo da média da conta nos últimos 30 dias, com volume de leads consistente — sinal de que a campanha pode absorver mais orçamento sem perder eficiência.',
      recommended_action: 'Aumentar o orçamento diário em 15-20% e monitorar o CPL nos 3 dias seguintes.',
      expected_impact: 'Mais volume de leads mantendo o custo por lead atual.',
    },
  ]

  const { data: recs, error: recErr } = await db
    .from('traffic_recommendations')
    .insert(
      recDefs.map((r) => ({
        account_id: accountId,
        contact_id: contact.id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        category: r.category,
        priority: r.priority,
        status: r.status,
        problem: r.problem,
        diagnosis: r.diagnosis,
        recommended_action: r.recommended_action,
        expected_impact: r.expected_impact,
        ai_raw: { seeded: true, note: 'Dado de demonstração — não gerado por uma chamada real de IA.' },
      })),
    )
    .select()
  if (recErr) throw recErr

  // Log a "recommendation_created" entry per recommendation, then a
  // couple of downstream events for the fatigue one to tell a small
  // story in the contact's history tab (spec section 18).
  const logRows = recs.map((r) => ({
    account_id: accountId,
    contact_id: contact.id,
    recommendation_id: r.id,
    event: 'recommendation_created',
    detail: r.problem,
  }))
  await db.from('traffic_optimization_log').insert(logRows)

  const fatigueRec = recs.find((r) => r.category === 'creative_fatigue')
  if (fatigueRec) {
    const { data: task, error: taskErr } = await db
      .from('traffic_optimization_tasks')
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        recommendation_id: fatigueRec.id,
        title: fatigueRec.recommended_action,
        priority: fatigueRec.priority,
        status: 'in_progress',
        due_date: isoDate(daysAgo(-3)),
        notes: 'Criativos novos em produção com o time de design.',
      })
      .select()
      .single()
    if (taskErr) throw taskErr

    await db.from('traffic_optimization_log').insert([
      {
        account_id: accountId,
        contact_id: contact.id,
        task_id: task.id,
        recommendation_id: fatigueRec.id,
        event: 'task_created',
        detail: 'Tarefa criada a partir da recomendação de fadiga criativa.',
      },
      {
        account_id: accountId,
        contact_id: contact.id,
        task_id: task.id,
        recommendation_id: fatigueRec.id,
        event: 'status_changed',
        detail: 'Tarefa -> in_progress (novos criativos em produção)',
      },
    ])
  }
}

function genSeries({ days, baseImpressions, baseCtr, ctrTrend, baseCpm, cpmTrend = 'stable', leadRate }) {
  const rows = []
  for (let i = days; i >= 1; i--) {
    const progress = (days - i) / (days - 1) // 0 at oldest day, 1 at most recent
    let ctr = baseCtr
    if (ctrTrend === 'decline') ctr = baseCtr * (1 - 0.45 * progress)
    if (ctrTrend === 'improve') ctr = baseCtr * (1 + 0.25 * progress)
    ctr *= rand(0.88, 1.12)

    let cpm = baseCpm
    if (cpmTrend === 'rise') cpm = baseCpm * (1 + 0.35 * progress)
    cpm *= rand(0.92, 1.08)

    const impressions = Math.round(baseImpressions * rand(0.85, 1.15))
    const reach = Math.round(impressions / rand(1.2, 1.6))
    const clicks = Math.max(1, Math.round(impressions * ctr))
    const spend = +((impressions / 1000) * cpm).toFixed(2)
    const leads = Math.max(0, Math.round(clicks * leadRate * rand(0.75, 1.25)))
    const conversions = Math.round(leads * rand(0.2, 0.4))
    const revenue = +(conversions * rand(120, 260)).toFixed(2)

    rows.push({ date: isoDate(daysAgo(i)), impressions, reach, clicks, spend, leads, conversions, revenue, visits: 0 })
  }
  return rows
}

function genLandingPageSeries({ days, baseVisits, baseConvRate, trend }) {
  const rows = []
  for (let i = days; i >= 1; i--) {
    const progress = (days - i) / (days - 1)
    let convRate = baseConvRate
    if (trend === 'decline') convRate = baseConvRate * (1 - 0.4 * progress)
    convRate *= rand(0.85, 1.15)

    const visits = Math.round(baseVisits * rand(0.85, 1.15))
    const leads = Math.max(0, Math.round(visits * convRate))
    rows.push({
      date: isoDate(daysAgo(i)),
      impressions: 0,
      reach: 0,
      clicks: 0,
      spend: 0,
      leads,
      conversions: Math.round(leads * 0.3),
      revenue: 0,
      visits,
    })
  }
  return rows
}

async function insertMetrics(accountId, entityType, entityId, series, userId) {
  const rows = series.map((r) => ({
    account_id: accountId,
    entity_type: entityType,
    entity_id: entityId,
    ...r,
    source: 'manual',
    created_by: userId,
  }))
  const { error } = await db.from('traffic_metrics_daily').insert(rows)
  if (error) throw error
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
