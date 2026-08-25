'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Grid2X2,
  Heart,
  LayoutList,
  Link2,
  Loader2,
  Plus,
  Search,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type {
  Contact,
  ContentCollection,
  ContentReference,
  ContentReferenceStatus,
  ContentTag,
} from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const STATUSES: ContentReferenceStatus[] = [
  'idea',
  'analyze',
  'reference',
  'created',
  'archived',
];
const STATUS_LABEL: Record<ContentReferenceStatus, string> = {
  idea: 'Ideia',
  analyze: 'Analisar',
  reference: 'Usar como referência',
  created: 'Conteúdo criado',
  archived: 'Arquivado',
};

export function SwipeFile() {
  const { account, user } = useAuth();
  const canManage = useCan('manage-content');
  const [items, setItems] = useState<ContentReference[] | null>(null);
  const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name'>[]>([]);
  const [collections, setCollections] = useState<ContentCollection[]>([]);
  const [tags, setTags] = useState<ContentTag[]>([]);
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [url, setUrl] = useState('');
  const [contactId, setContactId] = useState('none');
  const [manualTitle, setManualTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [refs, clients, cols, tagRows] = await Promise.all([
      supabase
        .from('content_references')
        .select(
          '*, contact:contacts(id, name), reference_tags:content_reference_tags(tag:content_tags(*)), reference_collections:content_reference_collections(collection:content_collections(*))'
        )
        .order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, name').order('name'),
      supabase.from('content_collections').select('*').order('name'),
      supabase.from('content_tags').select('*').order('name'),
    ]);
    if (refs.error) toast.error('Não foi possível carregar o Swipe File.');
    setItems((refs.data ?? []) as ContentReference[]);
    setContacts((clients.data ?? []) as Pick<Contact, 'id' | 'name'>[]);
    setCollections((cols.data ?? []) as ContentCollection[]);
    setTags((tagRows.data ?? []) as ContentTag[]);
  }, []);

  useEffect(() => {
    // Initial synchronization with the account-scoped Supabase store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      (items ?? []).filter((item) => {
        const haystack = [
          item.title,
          item.description,
          item.author,
          item.topic,
          item.category,
          item.notes,
          ...(item.reference_tags ?? []).map((row) => row.tag.name),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return (
          (!query || haystack.includes(query.toLowerCase())) &&
          (platform === 'all' || item.platform === platform) &&
          (status === 'all' || item.status === status) &&
          (!favoritesOnly || item.is_favorite)
        );
      }),
    [items, query, platform, status, favoritesOnly]
  );

  const platforms = [...new Set((items ?? []).map((item) => item.platform))];

  async function capture() {
    if (!url.trim()) return;
    setSaving(true);
    const response = await fetch('/api/content/references', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        contact_id: contactId === 'none' ? null : contactId,
        title: manualTitle,
        notes,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      toast.error(body.error ?? 'Não foi possível salvar a referência.');
      return;
    }
    toast.success('Referência adicionada ao Swipe File.');
    setUrl('');
    setManualTitle('');
    setNotes('');
    setContactId('none');
    await load();
  }

  async function updateItem(id: string, values: Partial<ContentReference>) {
    const { error } = await createClient()
      .from('content_references')
      .update(values)
      .eq('id', id);
    if (error) {
      toast.error('Não foi possível atualizar a referência.');
      return;
    }
    setItems(
      (current) =>
        current?.map((item) =>
          item.id === id ? { ...item, ...values } : item
        ) ?? null
    );
  }

  async function createTaxonomy(kind: 'collection' | 'tag', name: string) {
    if (!account?.id || !user?.id || !name.trim()) return;
    const table =
      kind === 'collection' ? 'content_collections' : 'content_tags';
    const { error } = await createClient().from(table).insert({
      account_id: account.id,
      created_by: user.id,
      name: name.trim(),
    });
    if (error)
      toast.error(
        error.code === '23505'
          ? 'Esse nome já existe.'
          : 'Não foi possível criar.'
      );
    else {
      toast.success(kind === 'collection' ? 'Coleção criada.' : 'Tag criada.');
      load();
    }
  }

  async function attach(
    referenceId: string,
    kind: 'collection' | 'tag',
    id: string
  ) {
    const client = createClient();
    const { error } =
      kind === 'collection'
        ? await client
            .from('content_reference_collections')
            .upsert(
              { reference_id: referenceId, collection_id: id },
              {
                onConflict: 'reference_id,collection_id',
                ignoreDuplicates: true,
              }
            )
        : await client
            .from('content_reference_tags')
            .upsert(
              { reference_id: referenceId, tag_id: id },
              { onConflict: 'reference_id,tag_id', ignoreDuplicates: true }
            );
    if (error) toast.error('Não foi possível organizar a referência.');
    else {
      toast.success(
        kind === 'collection' ? 'Adicionada à coleção.' : 'Tag adicionada.'
      );
      load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-primary text-sm font-medium">
            Central de Inteligência de Conteúdo
          </p>
          <h1 className="text-2xl font-bold">Swipe File</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Capture, organize e transforme referências em conteúdo original.
          </p>
        </div>
        <div className="flex gap-2">
          <TaxonomyDialog
            title="Nova coleção"
            icon={Plus}
            onCreate={(name) => createTaxonomy('collection', name)}
          />
          <TaxonomyDialog
            title="Nova tag"
            icon={Tag}
            onCreate={(name) => createTaxonomy('tag', name)}
          />
        </div>
      </div>

      <Card className="border-primary/20 from-primary/5 to-card bg-gradient-to-br">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="text-primary h-5 w-5" />
            <h2 className="font-semibold">
              Cole uma URL para salvar uma referência
            </h2>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row">
            <Input
              className="flex-1"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && capture()}
            />
            <Select
              value={contactId}
              onValueChange={(value) => setContactId(value ?? 'none')}
            >
              <SelectTrigger className="lg:w-56">
                <SelectValue>{contactId === 'none' ? 'Sem cliente' : contacts.find((contact) => contact.id === contactId)?.name || 'Cliente selecionado'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem cliente</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || 'Sem nome'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={capture}
              disabled={!canManage || saving || !url.trim()}
            >
              {saving ? <Loader2 className="animate-spin" /> : 'Capturar'}
            </Button>
          </div>
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              A plataforma bloqueia a leitura? Adicione dados manuais
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Título manual"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
              />
              <Textarea
                className="md:row-span-2"
                placeholder="Observações"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          <Input
            className="pl-9"
            placeholder="Buscar por tema, autor, categoria ou tag..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={platform} onValueChange={(v) => setPlatform(v ?? 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue>{platform === 'all' ? 'Plataforma' : platform}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Plataformas</SelectItem>
            {platforms.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v ?? 'all')}>
          <SelectTrigger className="w-48">
            <SelectValue>{status === 'all' ? 'Status' : STATUS_LABEL[status as ContentReferenceStatus]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={favoritesOnly ? 'default' : 'outline'}
          onClick={() => setFavoritesOnly((v) => !v)}
          title="Favoritos"
        >
          <Heart className={favoritesOnly ? 'fill-current' : ''} />
          Favoritos
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
        >
          {view === 'grid' ? <LayoutList /> : <Grid2X2 />}
        </Button>
      </div>

      {items === null ? (
        <div className="flex justify-center py-20">
          <Loader2 className="text-muted-foreground animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-16 text-center">
          <p className="font-medium">Nenhuma referência encontrada</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Cole uma URL acima para começar sua biblioteca criativa.
          </p>
        </div>
      ) : (
        <div
          className={
            view === 'grid'
              ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
              : 'space-y-3'
          }
        >
          {filtered.map((item) => (
            <ReferenceCard
              key={item.id}
              item={item}
              compact={view === 'list'}
              collections={collections}
              tags={tags}
              onAttach={attach}
              onUpdate={updateItem}
            />
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {filtered.length} referência(s) · {collections.length} coleção(ões) ·{' '}
        {tags.length} tag(s)
      </p>
    </div>
  );
}

function ReferenceCard({
  item,
  compact,
  collections,
  tags,
  onAttach,
  onUpdate,
}: {
  item: ContentReference;
  compact: boolean;
  collections: ContentCollection[];
  tags: ContentTag[];
  onAttach: (
    referenceId: string,
    kind: 'collection' | 'tag',
    id: string
  ) => void;
  onUpdate: (id: string, values: Partial<ContentReference>) => void;
}) {
  return (
    <Card className={compact ? 'overflow-hidden' : 'group overflow-hidden'}>
      <div className={compact ? 'flex' : ''}>
        {item.thumbnail_url && (
          <div
            className={
              compact ? 'bg-muted h-32 w-44 shrink-0' : 'bg-muted aspect-[16/9]'
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <CardContent className="flex-1 space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Badge variant="secondary" className="mb-2 capitalize">
                {item.platform}
              </Badge>
              <h3 className="line-clamp-2 font-semibold">{item.title}</h3>
              {item.author && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {item.author}
                </p>
              )}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                onUpdate(item.id, { is_favorite: !item.is_favorite })
              }
            >
              <Heart
                className={
                  item.is_favorite ? 'fill-rose-500 text-rose-500' : ''
                }
              />
            </Button>
          </div>
          {item.description && (
            <p className="text-muted-foreground line-clamp-2 text-sm">
              {item.description}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {item.contact?.name && (
              <Badge variant="outline">{item.contact.name}</Badge>
            )}
            {item.reference_collections?.map(({ collection }) => (
              <Badge key={collection.id} variant="secondary">
                {collection.name}
              </Badge>
            ))}
            {item.reference_tags?.map(({ tag }) => (
              <Badge key={tag.id} variant="outline">
                #{tag.name}
              </Badge>
            ))}
          </div>
          <details className="group/organize rounded-lg border bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <Tag className="h-3.5 w-3.5" /> Organizar em coleção ou tag
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t p-2">
            <Select
              onValueChange={(v) =>
                v && onAttach(item.id, 'collection', String(v))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="+ Coleção" />
              </SelectTrigger>
              <SelectContent>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(v) => v && onAttach(item.id, 'tag', String(v))}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="+ Tag" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    #{tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </details>
          <div className="flex items-center justify-between gap-2">
            <Select
              value={item.status}
              onValueChange={(v) =>
                onUpdate(item.id, { status: v as ContentReferenceStatus })
              }
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue>{STATUS_LABEL[item.status]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            >
              <ExternalLink />
            </a>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function TaxonomyDialog({
  title,
  icon: Icon,
  onCreate,
}: {
  title: string;
  icon: typeof Plus;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <Icon />
        {title}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button
            className="w-full"
            onClick={() => {
              onCreate(name);
              setName('');
            }}
          >
            Criar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
