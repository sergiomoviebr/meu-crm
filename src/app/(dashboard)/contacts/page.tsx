'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { AccountMember, Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Filter,
  X,
  Archive,
  Download,
  Tag as TagIcon,
  UserCog,
  Cake,
  RotateCcw,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';
import {
  CONTACT_RELATIONSHIP_STATUSES,
  CONTACT_RELATIONSHIP_TYPES,
} from '@/lib/contacts/profile';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const t = useTranslations('Contacts.page');
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [relationshipType, setRelationshipType] = useState('all');
  const [relationshipStatus, setRelationshipStatus] = useState('all');
  const [birthdayFilter, setBirthdayFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<Record<
    string,
    number
  > | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteText, setBulkDeleteText] = useState('');
  const [bulkAction, setBulkAction] = useState<
    'add_tag' | 'remove_tag' | 'status' | 'owner' | null
  >(null);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [birthdayNoticeDays, setBirthdayNoticeDays] = useState<number[]>([
    0, 1, 3, 7,
  ]);

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const params = new URLSearchParams({
      page: String(page + 1),
      page_size: String(pageSize),
    });
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    selectedTagIds.forEach((id) => params.append('tag', id));
    if (relationshipType !== 'all')
      params.set('relationship_type', relationshipType);
    if (relationshipStatus !== 'all') params.set('status', relationshipStatus);
    if (birthdayFilter !== 'all') params.set('birthday', birthdayFilter);
    if (ownerFilter !== 'all') params.set('owner', ownerFilter);
    if (cityFilter.trim()) params.set('city', cityFilter.trim());
    if (stateFilter.trim()) params.set('state', stateFilter.trim());
    if (showTrash) params.set('trash', 'true');
    if (showArchived) params.set('archived', 'true');

    try {
      const response = await fetch(`/api/contacts?${params}`);
      const body = await response.json().catch(() => ({}));
      if (seq !== fetchSeq.current) return;
      if (!response.ok) throw new Error(body.error ?? t('toastFailedLoad'));
      setContacts((body.contacts ?? []) as ContactWithTags[]);
      setTotalCount(Number(body.total ?? 0));
    } catch {
      if (seq === fetchSeq.current) toast.error(t('toastFailedLoad'));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [
    page,
    pageSize,
    debouncedSearch,
    selectedTagIds,
    relationshipType,
    relationshipStatus,
    birthdayFilter,
    ownerFilter,
    cityFilter,
    stateFilter,
    showTrash,
    showArchived,
    t,
  ]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void fetch('/api/account/members')
      .then((response) => response.json())
      .then((body) => setMembers((body.members ?? []) as AccountMember[]));
  }, []);

  useEffect(() => {
    void fetch('/api/contacts/birthdays?days=0')
      .then((response) => response.json())
      .then((body) => setBirthdayNoticeDays(body.noticeDays ?? [0, 1, 3, 7]));
  }, []);

  async function toggleBirthdayNotice(day: number) {
    const next = birthdayNoticeDays.includes(day)
      ? birthdayNoticeDays.filter((value) => value !== day)
      : [...birthdayNoticeDays, day].sort((a, b) => a - b);
    setBirthdayNoticeDays(next);
    const response = await fetch('/api/contacts/birthdays', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeDays: next }),
    });
    if (!response.ok) {
      toast.error('Falha ao salvar alertas de aniversário.');
      setBirthdayNoticeDays(birthdayNoticeDays);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') openAddForm();
    const contactId = params.get('contact');
    if (contactId) openDetail(contactId);
    const birthday = params.get('birthday');
    if (birthday === 'today' || birthday === '7' || birthday === '30') {
      setBirthdayFilter(birthday);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const [contactResponse, tagsResult] = await Promise.all([
      fetch(`/api/contacts/${contact.id}`),
      supabase.from('contact_tags').select('*').eq('contact_id', contact.id),
    ]);
    const body = await contactResponse.json().catch(() => ({}));
    if (!contactResponse.ok || !body.contact) {
      toast.error('Não foi possível abrir a edição deste contato.');
      return;
    }
    setEditContact(body.contact as Contact);
    setEditContactTags(tagsResult.data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteImpact(null);
    setDeleteConfirmOpen(true);
    void fetch(`/api/contacts/${contact.id}/impact`)
      .then((response) => response.json())
      .then((body) => setDeleteImpact(body.impact ?? {}));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const response = await fetch(`/api/contacts/${deleteTarget.id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(
        'Contato movido para a lixeira. O histórico foi preservado.'
      );
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    const response = await fetch('/api/contacts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action: 'delete' }),
    });
    if (!response.ok) {
      toast.error(t('toastBulkFailedDelete'));
    } else {
      toast.success(`${ids.length} contato(s) movido(s) para a lixeira.`);
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  async function restoreContact(contact: Contact) {
    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) toast.error(body.error ?? 'Falha ao restaurar contato.');
    else {
      toast.success('Contato restaurado.');
      await fetchContacts();
    }
  }

  async function runBulkAction(
    action:
      | 'archive'
      | 'unarchive'
      | 'add_tag'
      | 'remove_tag'
      | 'status'
      | 'owner'
      | 'export',
    value?: string,
    targetIds?: string[]
  ) {
    const ids = targetIds ?? [...selected];
    if (ids.length === 0) return;
    setBulkWorking(true);
    try {
      const response = await fetch('/api/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, value: value || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error ?? 'Falha na operação em massa.');
      if (action === 'export') {
        downloadCsv(body.rows ?? []);
        toast.success(`${ids.length} contato(s) exportado(s).`);
      } else {
        toast.success(`${ids.length} contato(s) atualizado(s).`);
        setSelected(new Set());
        await fetchContacts();
      }
      setBulkAction(null);
      setBulkValue('');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha na operação em massa.'
      );
    } finally {
      setBulkWorking(false);
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedTagIds.length > 0 ||
    relationshipType !== 'all' ||
    relationshipStatus !== 'all' ||
    birthdayFilter !== 'all' ||
    ownerFilter !== 'all' ||
    cityFilter.trim().length > 0 ||
    stateFilter.trim().length > 0 ||
    showArchived;

  const selectedContacts = contacts.filter((contact) =>
    selected.has(contact.id)
  );
  const selectedAreAllArchived =
    selectedContacts.length > 0 &&
    selectedContacts.every((contact) => contact.archived_at);

  const memberName = new Map(
    members.map((member) => [
      member.user_id,
      member.full_name || member.email || 'Membro',
    ])
  );

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalCount > 0
              ? t('subtitle', { count: totalCount })
              : t('subtitleZero')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showTrash ? 'secondary' : 'outline'}
            onClick={() => {
              setShowTrash((current) => !current);
              setShowArchived(false);
              setPage(0);
              setSelected(new Set());
            }}
          >
            <Trash2 className="size-4" />
            {showTrash ? 'Voltar aos contatos' : 'Lixeira'}
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground"
                />
              }
            >
              <Cake className="size-4" /> Alertas
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="text-foreground text-sm font-medium">
                Avisar sobre aniversários
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Escolha quando receber notificações internas.
              </p>
              <div className="mt-3 space-y-2">
                {[0, 1, 3, 7].map((day) => (
                  <label
                    key={day}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={birthdayNoticeDays.includes(day)}
                      onCheckedChange={() => void toggleBirthdayNotice(day)}
                    />
                    {day === 0
                      ? 'No dia'
                      : `${day} dia${day > 1 ? 's' : ''} antes`}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              {t('customFieldsBtn')}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            {t('importBtn')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addContactBtn')}
          </GatedButton>
        </div>
      </div>

      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="bg-card border-border text-foreground placeholder:text-muted-foreground pl-8"
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              {t('filterByTags')}
              {selectedTagIds.length > 0 && (
                <span className="bg-primary text-primary-foreground ml-1 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold">
                  {selectedTagIds.length}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="border-border flex items-center justify-between border-b px-3 py-2">
                <span className="text-popover-foreground text-sm font-medium">
                  {t('filterByTags')}
                </span>
                {selectedTagIds.length > 0 && (
                  <button
                    onClick={clearTagFilters}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    {t('clearAll')}
                  </button>
                )}
              </div>
              {allTags.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-center text-sm">
                  {t('noTagsYet')}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto py-1">
                  {allTags.map((tag) => (
                    <label
                      key={tag.id}
                      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-1.5"
                    >
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTagFilter(tag.id)}
                        aria-label={`Filter by ${tag.name}`}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-popover-foreground truncate text-sm">
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Select
            value={relationshipType}
            onValueChange={(value) => {
              setRelationshipType(value ?? 'all');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {CONTACT_RELATIONSHIP_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {
                    {
                      client: 'Cliente',
                      lead: 'Lead',
                      prospect: 'Prospect',
                      partner: 'Parceiro',
                      supplier: 'Fornecedor',
                      other: 'Outro',
                    }[value]
                  }
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={relationshipStatus}
            onValueChange={(value) => {
              setRelationshipStatus(value ?? 'all');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {CONTACT_RELATIONSHIP_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {
                    {
                      active: 'Ativo',
                      inactive: 'Inativo',
                      nurturing: 'Em relacionamento',
                      qualified: 'Qualificado',
                      unqualified: 'Desqualificado',
                    }[value]
                  }
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={birthdayFilter}
            onValueChange={(value) => {
              setBirthdayFilter(value ?? 'all');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <Cake className="size-4" />
              <SelectValue placeholder="Aniversários" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os aniversários</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="7">Próximos 7 dias</SelectItem>
              <SelectItem value="30">Próximos 30 dias</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger
              render={<Button variant="outline" className="shrink-0" />}
            >
              <SlidersHorizontal className="size-4" /> Mais filtros
              {(ownerFilter !== 'all' ||
                cityFilter ||
                stateFilter ||
                showArchived) && (
                <span className="bg-primary size-2 rounded-full" />
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <Select
                  value={ownerFilter}
                  onValueChange={(value) => {
                    setOwnerFilter(value ?? 'all');
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.full_name || member.email || 'Membro'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Cidade</Label>
                  <Input
                    value={cityFilter}
                    onChange={(event) => {
                      setCityFilter(event.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <Input
                    value={stateFilter}
                    onChange={(event) => {
                      setStateFilter(event.target.value);
                      setPage(0);
                    }}
                  />
                </div>
              </div>
              {!showTrash && (
                <label className="border-border flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={showArchived}
                    onCheckedChange={(checked) => {
                      setShowArchived(checked === true);
                      setPage(0);
                    }}
                  />
                  Mostrar contatos arquivados
                </label>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOwnerFilter('all');
                  setCityFilter('');
                  setStateFilter('');
                  setShowArchived(false);
                  setPage(0);
                }}
              >
                Limpar filtros avançados
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active tag-filter chips */}
        {selectedTagIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    onClick={() => toggleTagFilter(id)}
                    aria-label={`Remove ${tag.name} filter`}
                    className="hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <button
              onClick={clearTagFilters}
              className="text-muted-foreground hover:text-foreground px-1 text-xs"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* List controls: selection is intentionally always visible so bulk
          actions are discoverable before the first row is selected. */}
      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {!showTrash ? (
            <label className="text-foreground flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                className="border-muted-foreground/60 size-5 border-2 shadow-none"
                checked={allOnPageSelected}
                indeterminate={!allOnPageSelected && someOnPageSelected}
                onCheckedChange={toggleSelectAll}
                disabled={contacts.length === 0 || !canEdit}
                aria-label="Selecionar todos os contatos desta página"
              />
              Selecionar esta página
            </label>
          ) : (
            <span className="text-muted-foreground text-sm">
              Contatos excluídos podem ser restaurados individualmente.
            </span>
          )}
          {!showTrash && (
            <span
              className={
                selected.size > 0
                  ? 'bg-primary/10 text-primary rounded-full px-2.5 py-1 text-xs font-semibold'
                  : 'text-muted-foreground text-xs'
              }
            >
              {selected.size > 0
                ? `${selected.size} selecionado${selected.size > 1 ? 's' : ''}`
                : 'Nenhum selecionado'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span>Exibir</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value ?? DEFAULT_PAGE_SIZE));
                setPage(0);
                setSelected(new Set());
              }}
            >
              <SelectTrigger className="h-9 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>por página</span>
          </div>
          {!showTrash && (
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              disabled={selected.size === 0}
              gateReason="delete contacts"
              onClick={() => {
                setBulkDeleteText('');
                setBulkDeleteOpen(true);
              }}
            >
              <Trash2 className="size-4" />
              Excluir selecionados
            </GatedButton>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && !showTrash && (
        <div className="border-primary/25 bg-primary/5 flex flex-col gap-3 rounded-lg border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-foreground shrink-0 text-sm font-medium">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkAction('add_tag');
                setBulkValue('');
              }}
              disabled={!canEdit}
            >
              <TagIcon /> Adicionar tag
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkAction('status');
                setBulkValue('active');
              }}
              disabled={!canEdit}
            >
              <SlidersHorizontal /> Alterar status
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkAction('owner');
                setBulkValue('none');
              }}
              disabled={!canEdit}
            >
              <UserCog /> Responsável
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                runBulkAction(selectedAreAllArchived ? 'unarchive' : 'archive')
              }
              disabled={!canEdit || bulkWorking}
            >
              {selectedAreAllArchived ? <RotateCcw /> : <Archive />}
              {selectedAreAllArchived ? 'Desarquivar' : 'Arquivar'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runBulkAction('export')}
              disabled={!canEdit || bulkWorking}
            >
              <Download /> Exportar CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground"
            >
              {t('clearSelection')}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="bg-muted/30 w-14 text-center">
                {!showTrash && (
                  <div className="flex justify-center">
                    <Checkbox
                      className="border-muted-foreground/60 size-5 border-2 shadow-none"
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && someOnPageSelected}
                      onCheckedChange={toggleSelectAll}
                      disabled={contacts.length === 0 || !canEdit}
                      aria-label="Selecionar todos os contatos desta página"
                    />
                  </div>
                )}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.name')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">
                {t('tableColumns.company')}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t('tableColumns.phone')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">
                {t('tableColumns.email')}
              </TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">
                Status
              </TableHead>
              <TableHead className="text-muted-foreground hidden xl:table-cell">
                Responsável
              </TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">
                Último contato
              </TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={9} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="text-primary size-6 animate-spin" />
                    <p className="text-muted-foreground text-sm">
                      {t('loading')}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={9} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="text-muted-foreground size-8" />
                    <p className="text-muted-foreground text-sm">
                      {hasActiveFilters
                        ? t('noContactsMatch')
                        : t('noContactsYet')}
                    </p>
                    {!hasActiveFilters && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="add or import contacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="border-border text-muted-foreground hover:bg-muted mt-2"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirstContact')}
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  data-state={selected.has(contact.id) ? 'selected' : undefined}
                  className="border-border hover:bg-muted/50 data-[state=selected]:bg-primary/5 data-[state=selected]:hover:bg-primary/10 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell
                    className="bg-muted/20 w-14 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!showTrash && (
                      <div className="flex justify-center">
                        <Checkbox
                          className="border-muted-foreground/60 size-5 border-2 shadow-none"
                          checked={selected.has(contact.id)}
                          onCheckedChange={() => toggleSelect(contact.id)}
                          disabled={!canEdit}
                          aria-label={`Selecionar ${contact.name || contact.phone}`}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    <div className="min-w-0">
                      <p className="truncate">
                        {contact.preferred_name || contact.name || (
                          <span className="text-muted-foreground italic">
                            {t('unnamed')}
                          </span>
                        )}
                      </p>
                      {contact.preferred_name && contact.name && (
                        <p className="text-muted-foreground truncate text-[11px] font-normal">
                          {contact.name}
                        </p>
                      )}
                      {contact.tags && contact.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {contact.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag.id}
                              className="rounded-full px-1.5 py-0.5 text-[9px]"
                              style={{
                                backgroundColor: `${tag.color}20`,
                                color: tag.color,
                              }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {contact.archived_at && (
                        <span className="bg-muted text-muted-foreground mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium">
                          Arquivado
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                    {contact.company || '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-sm lg:table-cell">
                    {contact.email || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium">
                      {
                        {
                          active: 'Ativo',
                          inactive: 'Inativo',
                          nurturing: 'Relacionamento',
                          qualified: 'Qualificado',
                          unqualified: 'Desqualificado',
                        }[contact.relationship_status ?? 'active']
                      }
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs xl:table-cell">
                    {contact.owner_user_id
                      ? (memberName.get(contact.owner_user_id) ?? 'Membro')
                      : 'Sem responsável'}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                    {contact.last_contact_at
                      ? new Date(contact.last_contact_at).toLocaleDateString(
                          'pt-BR'
                        )
                      : 'Ainda não contatado'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border"
                      >
                        {showTrash ? (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void restoreContact(contact);
                            }}
                          >
                            <RotateCcw className="size-4" /> Restaurar contato
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditForm(contact);
                              }}
                              className="text-popover-foreground focus:bg-muted focus:text-foreground"
                            >
                              <Pencil className="size-4" />
                              {t('editAction')}
                            </DropdownMenuItem>
                            {contact.archived_at && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void runBulkAction('unarchive', undefined, [
                                    contact.id,
                                  ]);
                                }}
                              >
                                <RotateCcw className="size-4" /> Desarquivar
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator className="bg-border" />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete(contact);
                              }}
                            >
                              <Trash2 className="size-4" />
                              {t('deleteAction')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            {t('showingPagination', {
              start: page * pageSize + 1,
              end: Math.min((page + 1) * pageSize, totalCount),
              total: totalCount,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
        onEdit={
          showTrash
            ? undefined
            : (contact) => {
                setDetailOpen(false);
                void openEditForm(contact);
              }
        }
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      <Dialog
        open={bulkAction !== null}
        onOpenChange={(open) => !open && setBulkAction(null)}
      >
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkAction === 'status'
                ? 'Alterar status'
                : bulkAction === 'owner'
                  ? 'Alterar responsável'
                  : bulkAction === 'remove_tag'
                    ? 'Remover tag'
                    : 'Adicionar tag'}
            </DialogTitle>
            <DialogDescription>
              A alteração será aplicada a {selected.size} contato(s)
              selecionado(s).
            </DialogDescription>
          </DialogHeader>
          <Select
            value={bulkValue}
            onValueChange={(value) => setBulkValue(value ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione uma opção" />
            </SelectTrigger>
            <SelectContent>
              {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') &&
                allTags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              {bulkAction === 'status' &&
                CONTACT_RELATIONSHIP_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {
                      {
                        active: 'Ativo',
                        inactive: 'Inativo',
                        nurturing: 'Em relacionamento',
                        qualified: 'Qualificado',
                        unqualified: 'Desqualificado',
                      }[status]
                    }
                  </SelectItem>
                ))}
              {bulkAction === 'owner' && (
                <>
                  <SelectItem value="none">Sem responsável</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.full_name || member.email || 'Membro'}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') && (
            <button
              type="button"
              className="text-muted-foreground w-fit text-xs underline"
              onClick={() => {
                setBulkAction(
                  bulkAction === 'add_tag' ? 'remove_tag' : 'add_tag'
                );
                setBulkValue('');
              }}
            >
              {bulkAction === 'add_tag'
                ? 'Quero remover uma tag'
                : 'Quero adicionar uma tag'}
            </button>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!bulkValue || bulkWorking}
              onClick={() => {
                if (!bulkAction) return;
                const value =
                  bulkAction === 'owner' && bulkValue === 'none'
                    ? ''
                    : bulkValue;
                void runBulkAction(bulkAction, value);
              }}
            >
              {bulkWorking && <Loader2 className="size-4 animate-spin" />}
              Aplicar alteração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteContactTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactDesc', {
                name: deleteTarget?.name || deleteTarget?.phone || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border p-3 text-xs">
            {deleteImpact === null ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> Verificando
                relacionamentos…
              </span>
            ) : (
              <>
                <p className="text-foreground font-medium">
                  O contato irá para a lixeira; nada abaixo será apagado:
                </p>
                <p className="mt-1">
                  {Object.values(deleteImpact).reduce(
                    (sum, count) => sum + count,
                    0
                  )}{' '}
                  registro(s) relacionado(s), incluindo conversas, negócios,
                  notas e lembretes.
                </p>
              </>
            )}
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteBulkTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteBulkDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border p-3 text-xs">
            Os contatos serão movidos para a lixeira. Conversas, mensagens,
            negócios e histórico serão preservados.
          </div>
          {selected.size > 20 && (
            <div className="space-y-2">
              <Label>
                Digite {selected.size} para confirmar esta exclusão em massa
              </Label>
              <Input
                value={bulkDeleteText}
                onChange={(event) => setBulkDeleteText(event.target.value)}
                inputMode="numeric"
              />
            </div>
          )}
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={
                deleting ||
                (selected.size > 20 && bulkDeleteText !== String(selected.size))
              }
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function downloadCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [
    headers.map(cell).join(','),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(',')),
  ].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `contatos-selecionados-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
