'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BriefcaseBusiness, CalendarPlus, FilePlus2, ListTodo, MessageSquarePlus, Plus, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { GlobalSearchResult } from '@/app/api/search/route';

const actions = [
  { label: 'Novo contato', href: '/contacts?new=1', icon: UserPlus },
  { label: 'Nova mensagem', href: '/inbox?new=1', icon: MessageSquarePlus },
  { label: 'Novo negócio', href: '/pipelines?new=1', icon: BriefcaseBusiness },
  { label: 'Nova tarefa', href: '/tasks?new=1&type=task', icon: ListTodo },
  { label: 'Novo follow-up', href: '/tasks?new=1&type=follow_up', icon: CalendarPlus },
  { label: 'Nova reunião', href: '/tasks?new=1&type=meeting', icon: CalendarPlus },
  { label: 'Novo conteúdo', href: '/content/new', icon: FilePlus2 },
];
const typeLabel = { contact: 'Contato', deal: 'Negócio', task: 'Tarefa', content: 'Conteúdo' };

export function CommandCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen((value) => !value); }
      if (event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement)?.tagName)) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setLoading(true); void fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then((r) => r.json()).then((body) => setResults(body.results ?? [])).catch((error) => { if (error.name !== 'AbortError') setResults([]); }).finally(() => setLoading(false)); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  function changeQuery(value: string) { setQuery(value); if (value.trim().length < 2) { setResults([]); setLoading(false); } }
  function go(href: string) { setOpen(false); setQuery(''); router.push(href); }
  return <>
    <Button variant="outline" className="text-muted-foreground hidden w-56 justify-between md:flex" onClick={() => setOpen(true)}><span className="flex items-center gap-2"><Search className="size-4" /> Buscar no CRM</span><kbd className="bg-muted rounded px-1.5 py-0.5 text-[10px]">Ctrl K</kbd></Button>
    <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Buscar no CRM" onClick={() => setOpen(true)}><Search /></Button>
    <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" />}><Plus /> <span className="hidden sm:inline">Criar</span></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52">{actions.map(({ label, href, icon: Icon }) => <DropdownMenuItem key={label} onClick={() => go(href)}><Icon className="size-4" />{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="top-[15%] translate-y-0 p-0 sm:max-w-xl"><DialogHeader className="sr-only"><DialogTitle>Pesquisa global</DialogTitle></DialogHeader><div className="border-border flex items-center gap-2 border-b px-4"><Search className="text-muted-foreground size-5" /><Input autoFocus value={query} onChange={(e) => changeQuery(e.target.value)} placeholder="Buscar contatos, negócios, tarefas e conteúdos..." className="h-12 border-0 px-0 shadow-none focus-visible:ring-0" /></div><div className="max-h-[55vh] overflow-y-auto p-2">{query.length < 2 ? <div><p className="text-muted-foreground px-2 py-2 text-xs font-medium uppercase">Ações rápidas</p>{actions.slice(0, 5).map(({ label, href, icon: Icon }) => <button key={label} onClick={() => go(href)} className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"><Icon className="text-muted-foreground size-4" />{label}</button>)}</div> : loading ? <p className="text-muted-foreground p-8 text-center text-sm">Buscando...</p> : results.length === 0 ? <p className="text-muted-foreground p-8 text-center text-sm">Nenhum resultado encontrado.</p> : results.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => go(result.href)} className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"><span className="bg-primary/10 text-primary rounded px-2 py-1 text-[10px] font-semibold">{typeLabel[result.type]}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{result.title}</span>{result.subtitle && <span className="text-muted-foreground block truncate text-xs">{result.subtitle}</span>}</span></button>)}</div></DialogContent></Dialog>
  </>;
}
