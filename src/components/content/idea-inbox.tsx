'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Archive, ArrowRight, Check, Lightbulb, Link2, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useCan } from '@/hooks/use-can'
import type { Contact, ContentIdea } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function IdeaInbox() {
  const { account, user } = useAuth()
  const canManage = useCan('manage-content')
  const [ideas, setIdeas] = useState<ContentIdea[] | null>(null)
  const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name'>[]>([])
  const [body, setBody] = useState('')
  const [contactId, setContactId] = useState('none')
  const [view, setView] = useState<'inbox' | 'organized'>('inbox')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [ideasResult, contactsResult] = await Promise.all([
      supabase.from('content_ideas').select('*, contact:contacts(id, name)').neq('status', 'archived').order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, name').order('name'),
    ])
    if (ideasResult.error) toast.error('Não foi possível carregar as ideias.')
    setIdeas((ideasResult.data ?? []) as ContentIdea[])
    setContacts((contactsResult.data ?? []) as Pick<Contact, 'id' | 'name'>[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const visibleIdeas = useMemo(() => (ideas ?? []).filter((idea) => idea.status === view), [ideas, view])
  const counts = useMemo(() => ({ inbox: (ideas ?? []).filter((idea) => idea.status === 'inbox').length, organized: (ideas ?? []).filter((idea) => idea.status === 'organized').length }), [ideas])

  async function save() {
    if (!body.trim() || !account?.id || !user?.id) return
    setSaving(true)
    const sourceUrl = /^https?:\/\//i.test(body.trim()) ? body.trim() : null
    const { error } = await createClient().from('content_ideas').insert({ account_id: account.id, created_by: user.id, contact_id: contactId === 'none' ? null : contactId, body: body.trim(), source_url: sourceUrl, kind: sourceUrl ? 'url' : 'text' })
    setSaving(false)
    if (error) { toast.error('Não foi possível salvar a ideia.'); return }
    setBody(''); toast.success('Ideia capturada.'); load()
  }

  async function setStatus(id: string, status: ContentIdea['status']) {
    const { error } = await createClient().from('content_ideas').update({ status }).eq('id', id)
    if (error) toast.error('Não foi possível atualizar a ideia.')
    else setIdeas((current) => current?.filter((idea) => idea.id !== id || status !== 'archived').map((idea) => idea.id === id ? { ...idea, status } : idea) ?? null)
  }

  return <div className="space-y-6">
    <div><p className="text-sm font-medium text-primary">Captura rápida</p><h1 className="text-2xl font-bold">Inbox de ideias</h1><p className="mt-1 text-sm text-muted-foreground">Registre em segundos e organize quando estiver pronto.</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <Card className="border-primary/20 lg:sticky lg:top-20"><CardContent className="space-y-4 p-5"><div><h2 className="font-semibold">O que você está pensando?</h2><p className="mt-1 text-xs text-muted-foreground">Pode ser uma frase, observação ou URL.</p></div><Textarea autoFocus rows={7} className="resize-none" placeholder="Ex.: Reel mostrando os 3 erros mais comuns no primeiro atendimento..." value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save() }} /><Select value={contactId} onValueChange={(v) => setContactId(v ?? 'none')}><SelectTrigger className="w-full"><SelectValue>{contactId === 'none' ? 'Sem cliente definido' : contacts.find((contact) => contact.id === contactId)?.name || 'Cliente selecionado'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none">Sem cliente definido</SelectItem>{contacts.map((contact) => <SelectItem key={contact.id} value={contact.id}>{contact.name || 'Sem nome'}</SelectItem>)}</SelectContent></Select><Button className="w-full" onClick={save} disabled={!canManage || saving || !body.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}Salvar na inbox</Button><p className="text-center text-xs text-muted-foreground">Ctrl/⌘ + Enter para salvar</p></CardContent></Card>

      <section className="min-w-0 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><Tabs value={view} onValueChange={(value) => setView(value as 'inbox' | 'organized')}><TabsList><TabsTrigger value="inbox">Para organizar <Badge variant="secondary" className="ml-1">{counts.inbox}</Badge></TabsTrigger><TabsTrigger value="organized">Organizadas <Badge variant="secondary" className="ml-1">{counts.organized}</Badge></TabsTrigger></TabsList></Tabs><p className="text-xs text-muted-foreground">{visibleIdeas.length} ideia(s)</p></div>
        {ideas === null ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div> : visibleIdeas.length === 0 ? <div className="rounded-xl border border-dashed bg-muted/20 p-12 text-center"><Lightbulb className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" /><p className="font-medium">{view === 'inbox' ? 'Nada para organizar' : 'Nenhuma ideia organizada'}</p><p className="mt-1 text-sm text-muted-foreground">{view === 'inbox' ? 'Novas ideias aparecerão aqui.' : 'Marque ideias prontas para mantê-las organizadas.'}</p></div> : <div className="space-y-3">{visibleIdeas.map((idea) => <Card key={idea.id} className="group shadow-none transition-colors hover:border-primary/20"><CardContent className="p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="mb-3 flex flex-wrap items-center gap-2"><Badge variant="outline">{idea.kind === 'url' ? <><Link2 /> URL</> : 'Ideia'}</Badge>{idea.contact?.name && <Badge variant="secondary">{idea.contact.name}</Badge>}<span className="text-xs text-muted-foreground">{new Date(idea.created_at).toLocaleDateString('pt-BR')}</span></div><p className="whitespace-pre-wrap text-sm leading-6">{idea.body}</p></div><Button variant="ghost" size="icon-sm" title="Arquivar" onClick={() => setStatus(idea.id, 'archived')}><Archive /></Button></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><Button variant="ghost" size="sm" onClick={() => setStatus(idea.id, idea.status === 'inbox' ? 'organized' : 'inbox')}><Check />{idea.status === 'inbox' ? 'Marcar organizada' : 'Voltar para inbox'}</Button><Link href={`/content/new?idea_id=${idea.id}${idea.contact_id ? `&contact_id=${idea.contact_id}` : ''}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Criar conteúdo <ArrowRight /></Link></div></CardContent></Card>)}</div>}
      </section>
    </div>
  </div>
}
