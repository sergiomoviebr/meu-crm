'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, FileText, LayoutDashboard, Lightbulb, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

const sections = [
  { href: '/content', label: 'Visão geral', icon: LayoutDashboard, exact: true },
  { href: '/content/swipe-file', label: 'Inspiração', icon: Sparkles },
  { href: '/content/ideas', label: 'Ideias', icon: Lightbulb },
  { href: '/content/posts', label: 'Produção', icon: FileText, matches: ['/content/new'] },
  { href: '/content/calendar', label: 'Planejamento', icon: CalendarDays },
]

export function ContentWorkspaceNav() {
  const pathname = usePathname()
  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label="Navegação da Central de Conteúdo">
          {sections.map(({ href, label, icon: Icon, exact, matches }) => {
            const active = exact ? pathname === href : pathname.startsWith(href) || matches?.some((path) => pathname.startsWith(path))
            return (
              <Link key={href} href={href} className={cn('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')} aria-current={active ? 'page' : undefined}>
                <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
              </Link>
            )
          })}
        </nav>
        <Link href="/content/new" className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
          <Plus className="h-4 w-4" /><span className="hidden sm:inline">Criar conteúdo</span><span className="sm:hidden">Criar</span>
        </Link>
      </div>
    </div>
  )
}
