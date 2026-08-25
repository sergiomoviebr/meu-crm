'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, Check, Circle, Clock3, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import type { Contact, Deal, SalesTask, SalesTaskPriority, SalesTaskStatus, SalesTaskType } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Member = { user_id: string; full_name: string | null; email: string };
type Form = { title: string; description: string; task_type: SalesTaskType; status: SalesTaskStatus; priority: SalesTaskPriority; due_at: string; contact_id: string; deal_id: string; assigned_to: string };
const blank = (userId = ''): Form => ({ title: '', description: '', task_type: 'task', status: 'todo', priority: 'medium', due_at: '', contact_id: '', deal_id: '', assigned_to: userId });
const priorityStyle: Record<SalesTaskPriority, string> = { low: 'bg-slate-500/10 text-slate-600', medium: 'bg-blue-500/10 text-blue-600', high: 'bg-orange-500/10 text-orange-600', urgent: 'bg-red-500/10 text-red-600' };
const labels = { task: 'Tarefa', call: 'Ligação', meeting: 'Reunião', follow_up: 'Follow-up', low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' } as const;

export default function TasksPage() {
  const { user, accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);
  const [deals, setDeals] = useState<Pick<Deal, 'id' | 'title'>[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState('mine');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SalesTask | null>(null);
  const [form, setForm] = useState<Form>(() => blank());
  const [saving, setSaving] = useState(false);
  const deepLinkHandled = useRef(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();
    const [taskRes, contactRes, dealRes, memberRes] = await Promise.all([
      fetch('/api/tasks').then((r) => r.json()),
      supabase.from('contacts').select('id,name,phone').eq('account_id', accountId).is('deleted_at', null).order('name'),
      supabase.from('deals').select('id,title').eq('account_id', accountId).order('created_at', { ascending: false }),
      fetch('/api/account/members').then((r) => r.json()),
    ]);
    setTasks(taskRes.tasks ?? []); setContacts(contactRes.data ?? []); setDeals(dealRes.data ?? []); setMembers(memberRes.members ?? []); setLoading(false);
  }, [accountId]);
  useEffect(() => {
    // Data loading resolves asynchronously; this effect only starts the synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedFilter = params.get('filter');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requestedFilter && ['mine', 'open', 'overdue', 'today', 'done', 'all'].includes(requestedFilter)) setFilter(requestedFilter);
    if (params.get('new') === '1') {
      const type = params.get('type');
      const taskType: SalesTaskType = type === 'meeting' || type === 'follow_up' || type === 'call' ? type : 'task';
      setEditing(null); setForm({ ...blank(user?.id), task_type: taskType }); setOpen(true);
    }
  }, [user?.id]);
  useEffect(() => {
    if (deepLinkHandled.current || tasks.length === 0) return;
    const id = new URLSearchParams(window.location.search).get('task');
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    deepLinkHandled.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(task); setForm({ title: task.title, description: task.description ?? '', task_type: task.task_type, status: task.status, priority: task.priority,
      due_at: task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : '', contact_id: task.contact_id ?? '', deal_id: task.deal_id ?? '', assigned_to: task.assigned_to }); setOpen(true);
  }, [tasks]);

  const visible = (() => {
    const now = new Date(), end = new Date(); end.setHours(23, 59, 59, 999);
    return tasks.filter((task) => {
      if (filter === 'mine' && task.assigned_to !== user?.id) return false;
      if (filter === 'overdue') return !!task.due_at && new Date(task.due_at) < now && !['done', 'cancelled'].includes(task.status);
      if (filter === 'today') return !!task.due_at && new Date(task.due_at) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && new Date(task.due_at) <= end;
      if (filter === 'done') return task.status === 'done';
      return filter === 'all' || !['done', 'cancelled'].includes(task.status);
    });
  })();

  function showCreate() { setEditing(null); setForm(blank(user?.id)); setOpen(true); }
  function showEdit(task: SalesTask) {
    setEditing(task); setForm({ title: task.title, description: task.description ?? '', task_type: task.task_type, status: task.status, priority: task.priority,
      due_at: task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : '', contact_id: task.contact_id ?? '', deal_id: task.deal_id ?? '', assigned_to: task.assigned_to }); setOpen(true);
  }
  async function save() {
    if (!form.title.trim() || !form.assigned_to) return toast.error('Informe o título e o responsável.');
    setSaving(true);
    const body = { ...form, description: form.description || null, due_at: form.due_at ? new Date(form.due_at).toISOString() : null, contact_id: form.contact_id || null, deal_id: form.deal_id || null };
    const response = await fetch(editing ? `/api/tasks/${editing.id}` : '/api/tasks', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) return toast.error(result.error ?? 'Não foi possível salvar.');
    toast.success(editing ? 'Tarefa atualizada.' : 'Tarefa criada.'); setOpen(false); void load();
  }
  async function patchTask(id: string, patch: Partial<SalesTask>) {
    const response = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!response.ok) return toast.error('Não foi possível atualizar.'); void load();
  }
  async function remove(id: string) {
    if (!confirm('Excluir esta tarefa?')) return;
    const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!response.ok) return toast.error('Não foi possível excluir.'); toast.success('Tarefa excluída.'); void load();
  }
  const contactName = (id?: string | null) => contacts.find((c) => c.id === id)?.name || contacts.find((c) => c.id === id)?.phone;
  const dealName = (id?: string | null) => deals.find((d) => d.id === id)?.title;
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.full_name || members.find((m) => m.user_id === id)?.email || 'Membro';

  return <div className="space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><CalendarCheck className="text-primary" /> Tarefas e agenda</h1><p className="text-muted-foreground mt-1 text-sm">Organize próximos passos, ligações, reuniões e follow-ups.</p></div><Button onClick={showCreate} disabled={!canEdit}><Plus /> Nova tarefa</Button></div>
    <div className="flex flex-wrap gap-2">{[['mine','Minhas'],['open','Em aberto'],['overdue','Atrasadas'],['today','Hoje'],['done','Concluídas'],['all','Todas']].map(([key,label]) => <Button key={key} size="sm" variant={filter === key ? 'default' : 'outline'} onClick={() => setFilter(key)}>{label}</Button>)}</div>
    {loading ? <p className="text-muted-foreground py-12 text-center">Carregando tarefas...</p> : visible.length === 0 ? <Card><CardContent className="flex flex-col items-center py-14 text-center"><CalendarCheck className="text-muted-foreground mb-3 size-10" /><p className="font-medium">Nenhuma tarefa nesta visão</p><p className="text-muted-foreground text-sm">Crie uma tarefa para registrar o próximo passo comercial.</p></CardContent></Card> : <div className="space-y-3">{visible.map((task) => {
      const overdue = !!task.due_at && new Date(task.due_at) < new Date() && !['done','cancelled'].includes(task.status);
      return <Card key={task.id} className={overdue ? 'border-red-500/40' : ''}><CardContent className="flex gap-3 p-4"><button aria-label="Concluir tarefa" disabled={!canEdit} onClick={() => void patchTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })} className="mt-0.5">{task.status === 'done' ? <Check className="size-5 rounded-full bg-emerald-500 p-1 text-white" /> : <Circle className="text-muted-foreground size-5" />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={task.status === 'done' ? 'text-muted-foreground line-through' : 'font-medium'}>{task.title}</p><Badge className={priorityStyle[task.priority]}>{labels[task.priority]}</Badge><Badge variant="outline">{labels[task.task_type]}</Badge></div>{task.description && <p className="text-muted-foreground mt-1 text-sm">{task.description}</p>}<div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{task.due_at && <span className={overdue ? 'font-medium text-red-600' : ''}><Clock3 className="mr-1 inline size-3" />{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(task.due_at))}</span>}<span>{memberName(task.assigned_to)}</span>{contactName(task.contact_id) && <span>Contato: {contactName(task.contact_id)}</span>}{dealName(task.deal_id) && <span>Negócio: {dealName(task.deal_id)}</span>}</div></div>{canEdit && <div className="flex gap-1"><Button size="icon-sm" variant="ghost" onClick={() => showEdit(task)}><Pencil /><span className="sr-only">Editar</span></Button><Button size="icon-sm" variant="ghost" onClick={() => void remove(task.id)}><Trash2 /><span className="sr-only">Excluir</span></Button></div>}</CardContent></Card>})}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? 'Editar tarefa' : 'Nova tarefa'}</DialogTitle></DialogHeader><div className="grid gap-4">
      <label className="grid gap-1 text-sm">Título<Input value={form.title} maxLength={240} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></label>
      <label className="grid gap-1 text-sm">Descrição<Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Tipo" value={form.task_type} onChange={(v) => setForm({ ...form, task_type: v as SalesTaskType })} options={[['task','Tarefa'],['call','Ligação'],['meeting','Reunião'],['follow_up','Follow-up']]} /><Field label="Prioridade" value={form.priority} onChange={(v) => setForm({ ...form, priority: v as SalesTaskPriority })} options={[['low','Baixa'],['medium','Média'],['high','Alta'],['urgent','Urgente']]} /></div>
      <label className="grid gap-1 text-sm">Prazo<Input type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></label>
      <Field label="Responsável" value={form.assigned_to} onChange={(v) => setForm({ ...form, assigned_to: v })} options={members.map((m) => [m.user_id, m.full_name || m.email])} />
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Contato (opcional)" value={form.contact_id} onChange={(v) => setForm({ ...form, contact_id: v })} options={[['','Nenhum'], ...contacts.map((c) => [c.id, c.name || c.phone])]} /><Field label="Negócio (opcional)" value={form.deal_id} onChange={(v) => setForm({ ...form, deal_id: v })} options={[['','Nenhum'], ...deals.map((d) => [d.id, d.title])]} /></div>
      {editing && <Field label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v as SalesTaskStatus })} options={[['todo','A fazer'],['in_progress','Em andamento'],['done','Concluída'],['cancelled','Cancelada']]} />}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button></div>
    </div></DialogContent></Dialog>
  </div>;
}

function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <label className="grid gap-1 text-sm">{label}<select className="border-input bg-background h-8 rounded-lg border px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([key, text]) => <option key={key || 'none'} value={key}>{text}</option>)}</select></label>;
}
