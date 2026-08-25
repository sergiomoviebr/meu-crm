'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarClock, CheckCircle2, FileText, Inbox, Lightbulb, Plus, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/dashboard/skeleton'
import { cn } from '@/lib/utils'

interface WorkspaceMetrics { ideas: number; references: number; producing: number; approval: number; scheduled: number; published: number }
const EMPTY_METRICS: WorkspaceMetrics = { ideas: 0, references: 0, producing: 0, approval: 0, scheduled: 0, published: 0 }

export default function ContentDashboardPage() {
  const [metrics, setMetrics] = useState<WorkspaceMetrics | null>(null)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('content_ideas').select('id', { count: 'exact', head: true }).eq('status', 'inbox'),
      supabase.from('content_references').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
      supabase.from('content_posts').select('status'),
    ]).then(([ideas, references, posts]) => {
      const next = { ...EMPTY_METRICS, ideas: ideas.count ?? 0, references: references.count ?? 0 }
      for (const post of posts.data ?? []) {
        if (post.status === 'draft' || post.status === 'approved') next.producing++
        if (post.status === 'pending_approval') next.approval++
        if (post.status === 'scheduled') next.scheduled++
        if (post.status === 'published') next.published++
      }
      setMetrics(next)
    })
  }, [])

  const cards = [
    { label: 'Ideias na inbox', value: metrics?.ideas, icon: Lightbulb, href: '/content/ideas', tone: 'bg-amber-500/10 text-amber-600' },
    { label: 'Referências salvas', value: metrics?.references, icon: Sparkles, href: '/content/swipe-file', tone: 'bg-violet-500/10 text-violet-600' },
    { label: 'Em produção', value: metrics?.producing, icon: FileText, href: '/content/posts?status=draft', tone: 'bg-blue-500/10 text-blue-600' },
    { label: 'Aguardando aprovação', value: metrics?.approval, icon: Inbox, href: '/content/posts?status=pending_approval', tone: 'bg-orange-500/10 text-orange-600' },
    { label: 'Agendados', value: metrics?.scheduled, icon: CalendarClock, href: '/content/posts?status=scheduled', tone: 'bg-cyan-500/10 text-cyan-600' },
    { label: 'Publicados', value: metrics?.published, icon: CheckCircle2, href: '/content/posts?status=published', tone: 'bg-emerald-500/10 text-emerald-600' },
  ]

  return <div className="space-y-8">
    <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8">
      <div className="relative z-10 max-w-2xl"><Badge variant="secondary" className="mb-4">Central de conteúdo</Badge><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Da inspiração à publicação, sem perder o contexto.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">Comece capturando uma ideia ou referência. Depois transforme, produza, aprove e planeje a publicação para cada cliente.</p><div className="mt-6 flex flex-wrap gap-2"><Link href="/content/new" className={buttonVariants()}><Plus />Criar conteúdo</Link><Link href="/content/swipe-file" className={buttonVariants({ variant: 'outline' })}><Sparkles />Salvar referência</Link><Link href="/content/ideas" className={buttonVariants({ variant: 'ghost' })}><Lightbulb />Anotar ideia</Link></div></div>
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
    </section>

    <section><div className="mb-4"><h2 className="text-lg font-semibold">Seu trabalho agora</h2><p className="text-sm text-muted-foreground">Acesse diretamente o que precisa de atenção.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{cards.map(({ label, value, icon: Icon, href, tone }) => <Link key={label} href={href} className="group rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"><div className={cn('mb-4 flex h-9 w-9 items-center justify-center rounded-lg', tone)}><Icon className="h-4 w-4" /></div>{value === undefined ? <Skeleton className="mb-1 h-7 w-10" /> : <p className="text-2xl font-semibold tabular-nums">{value}</p>}<div className="mt-1 flex items-center justify-between gap-2"><p className="text-xs leading-4 text-muted-foreground">{label}</p><ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div></Link>)}</div></section>

    <section><div className="mb-4"><h2 className="text-lg font-semibold">Fluxo recomendado</h2><p className="text-sm text-muted-foreground">Uma sequência simples para o time não se perder.</p></div><div className="grid gap-3 lg:grid-cols-4">{[
      { step: '01', title: 'Capture', text: 'Salve uma ideia rápida ou cole uma URL.', href: '/content/ideas' },
      { step: '02', title: 'Organize', text: 'Classifique referências, tags e coleções.', href: '/content/swipe-file' },
      { step: '03', title: 'Produza', text: 'Crie e acompanhe rascunhos e aprovações.', href: '/content/posts' },
      { step: '04', title: 'Planeje', text: 'Distribua conteúdos no calendário editorial.', href: '/content/calendar' },
    ].map((item) => <Card key={item.step} className="shadow-none"><CardContent className="p-5"><span className="text-xs font-bold tracking-widest text-primary">{item.step}</span><h3 className="mt-2 font-semibold">{item.title}</h3><p className="mt-1 min-h-10 text-sm text-muted-foreground">{item.text}</p><Link href={item.href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Abrir <ArrowRight className="h-3.5 w-3.5" /></Link></CardContent></Card>)}</div></section>
  </div>
}
