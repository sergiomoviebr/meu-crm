'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Cake, CalendarClock, CheckCircle2, Clock3, Flame, MessageSquareWarning, UserPlus, UsersRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { SalesTask } from '@/types';

type Data = { counts: { awaiting: number; overdueTasks: number; failedMessages: number; newLeads: number; staleContacts: number; staleDeals: number; birthdays: number; todayTasks: number }; today: SalesTask[] };

export function AttentionCenter() {
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => { const response = await fetch('/api/dashboard/attention'); const body = await response.json().catch(() => null); if (response.ok) setData(body); }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (!data) return <div className="space-y-3"><div className="bg-muted h-8 w-72 animate-pulse rounded" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-muted h-24 animate-pulse rounded-xl" />)}</div></div>;
  const items = [
    { count: data.counts.awaiting, label: 'clientes aguardando resposta', href: '/pipelines?view=awaiting', icon: MessageSquareWarning, tone: 'text-red-600 bg-red-500/10' },
    { count: data.counts.overdueTasks, label: 'tarefas e follow-ups atrasados', href: '/tasks?filter=overdue', icon: AlertCircle, tone: 'text-orange-600 bg-orange-500/10' },
    { count: data.counts.failedMessages, label: 'mensagens falharam nos últimos 7 dias', href: '/inbox', icon: MessageSquareWarning, tone: 'text-red-600 bg-red-500/10' },
    { count: data.counts.staleContacts, label: 'clientes sem contato há mais de 10 dias', href: '/contacts', icon: UsersRound, tone: 'text-amber-600 bg-amber-500/10' },
    { count: data.counts.staleDeals, label: 'oportunidades paradas há mais de 7 dias', href: '/pipelines', icon: Flame, tone: 'text-orange-600 bg-orange-500/10' },
    { count: data.counts.newLeads, label: 'novos contatos hoje', href: '/contacts', icon: UserPlus, tone: 'text-blue-600 bg-blue-500/10' },
    { count: data.counts.birthdays, label: 'aniversários hoje', href: '/contacts?birthday=today', icon: Cake, tone: 'text-primary bg-primary/10' },
    { count: data.counts.todayTasks, label: 'compromissos e tarefas hoje', href: '/tasks?filter=today', icon: CalendarClock, tone: 'text-primary bg-primary/10' },
  ];
  const active = items.filter((item) => item.count > 0);
  return <section className="space-y-3"><div><h2 className="text-lg font-semibold">O que precisa da sua atenção</h2><p className="text-muted-foreground text-sm">Pendências reais, ordenadas para você decidir o próximo passo.</p></div>{active.length === 0 ? <Card className="border-emerald-500/25"><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="size-6 text-emerald-600" /><div><p className="font-medium">Tudo em dia por enquanto</p><p className="text-muted-foreground text-sm">Nenhuma pendência crítica foi encontrada.</p></div></CardContent></Card> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{active.map(({ count, label, href, icon: Icon, tone }) => <Link key={label} href={href} className="border-border bg-card hover:border-primary/30 group rounded-xl border p-4 transition"><div className="flex items-start justify-between gap-3"><span className={`flex size-9 items-center justify-center rounded-lg ${tone}`}><Icon className="size-4" /></span><span className="text-2xl font-semibold tabular-nums">{count}</span></div><p className="text-muted-foreground group-hover:text-foreground mt-3 text-sm">{label}</p></Link>)}</div>}
    <Card><CardContent className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Hoje</h3><p className="text-muted-foreground text-xs">Sua agenda em ordem cronológica.</p></div><Button variant="ghost" size="sm" render={<Link href="/tasks?filter=today" />}>Ver agenda</Button></div>{data.today.length === 0 ? <p className="border-border text-muted-foreground rounded-lg border border-dashed p-5 text-center text-sm">Você não possui tarefas com horário para hoje.</p> : <div className="divide-border divide-y">{data.today.slice(0, 6).map((task) => <Link key={task.id} href={`/tasks?task=${task.id}`} className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-3"><span className="text-primary w-12 text-sm font-semibold tabular-nums">{task.due_at ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(task.due_at)) : '—'}</span><Clock3 className="text-muted-foreground size-4" /><span className="min-w-0 flex-1 truncate text-sm">{task.title}</span></Link>)}</div>}</CardContent></Card>
  </section>;
}
