'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactNote,
  CustomField,
  Deal,
  MessageTemplate,
  SocialProfile,
  ContentPost,
  ContentPostStatus,
  AdAccount,
  TrafficRecommendation,
  TrafficOptimizationLogEntry,
  ContactEvent,
  ContactReminder,
} from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  DollarSign,
  LayoutTemplate,
  Pencil,
  History,
  Clock3,
  CalendarDays,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

// Small color cue for the content-post status row in the Content tab —
// mirrors the badge-variant mapping used on /content/posts, kept as a
// text-color-only class here since this list is compact (no Badge chip).
const CONTENT_STATUS_CLASS: Partial<Record<ContentPostStatus, string>> = {
  published: 'text-primary',
  scheduled: 'text-primary',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
};

// Priority cue for the Traffic tab's recommendation list — mirrors
// the 🔴🟠🟡🟢 scheme used across /traffic/{recommendations,diagnostics}.
const RECOMMENDATION_PRIORITY_EMOJI: Record<
  TrafficRecommendation['priority'],
  string
> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};
const RECOMMENDATION_PRIORITY_CLASS: Partial<
  Record<TrafficRecommendation['priority'], string>
> = {
  critical: 'text-destructive',
  high: 'text-destructive',
};

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
  onEdit?: (contact: Contact) => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
  onEdit,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const supabase = createClient();
  const { accountId, defaultCurrency, canSendMessages } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  // Content tab — social profiles + post history for this client
  const [socialProfiles, setSocialProfiles] = useState<SocialProfile[]>([]);
  const [contentPosts, setContentPosts] = useState<ContentPost[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  // Traffic tab — ad accounts, recent AI recommendations, optimization history
  const [trafficAdAccounts, setTrafficAdAccounts] = useState<AdAccount[]>([]);
  const [trafficRecommendations, setTrafficRecommendations] = useState<
    TrafficRecommendation[]
  >([]);
  const [trafficLog, setTrafficLog] = useState<TrafficOptimizationLogEntry[]>(
    []
  );
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [reminders, setReminders] = useState<ContactReminder[]>([]);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const response = await fetch(`/api/contacts/${contactId}`);
    const body = await response.json().catch(() => ({}));
    const data = response.ok ? body.contact : null;

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId]);

  const fetchTimeline = useCallback(async () => {
    if (!contactId) return;
    setLoadingEvents(true);
    const { data } = await supabase
      .from('contact_events')
      .select('*')
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
      .limit(100);
    setEvents((data ?? []) as ContactEvent[]);
    setLoadingEvents(false);
  }, [contactId, supabase]);

  const fetchReminders = useCallback(async () => {
    if (!contactId) return;
    const response = await fetch(
      `/api/contacts/reminders?contact_id=${contactId}`
    );
    const body = await response.json().catch(() => ({}));
    if (response.ok) setReminders((body.reminders ?? []) as ContactReminder[]);
  }, [contactId]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('contact_tags')
        .select('tag_id')
        .eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  const fetchContent = useCallback(async () => {
    if (!contactId) return;
    setLoadingContent(true);
    const [profilesRes, postsRes] = await Promise.all([
      supabase
        .from('social_profiles')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      supabase
        .from('content_posts')
        .select('*')
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false })
        .limit(20),
    ]);
    setSocialProfiles((profilesRes.data ?? []) as SocialProfile[]);
    setContentPosts((postsRes.data ?? []) as ContentPost[]);
    setLoadingContent(false);
  }, [contactId, supabase]);

  const fetchTraffic = useCallback(async () => {
    if (!contactId) return;
    setLoadingTraffic(true);
    const [adAccountsRes, recsRes, logRes] = await Promise.all([
      supabase
        .from('ad_accounts')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false }),
      supabase
        .from('traffic_recommendations')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('traffic_optimization_log')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    setTrafficAdAccounts((adAccountsRes.data ?? []) as AdAccount[]);
    setTrafficRecommendations((recsRes.data ?? []) as TrafficRecommendation[]);
    setTrafficLog((logRes.data ?? []) as TrafficOptimizationLogEntry[]);
    setLoadingTraffic(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchContent();
      fetchTraffic();
      fetchTimeline();
      fetchReminders();
    }
  }, [
    open,
    contactId,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchCustomFields,
    fetchDeals,
    fetchContent,
    fetchTraffic,
    fetchTimeline,
    fetchReminders,
  ]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    setSavingDetails(true);
    const response = await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
      }),
    });

    if (!response.ok) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function createReminder() {
    if (!contactId || !reminderTitle.trim() || !reminderAt) return;
    setSavingReminder(true);
    const response = await fetch('/api/contacts/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contactId,
        title: reminderTitle.trim(),
        remind_at: new Date(reminderAt).toISOString(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) toast.error(body.error ?? 'Falha ao criar lembrete.');
    else {
      setReminderTitle('');
      setReminderAt('');
      await fetchReminders();
      await fetchTimeline();
      toast.success('Lembrete criado.');
    }
    setSavingReminder(false);
  }

  async function completeReminder(reminderId: string) {
    const response = await fetch(`/api/contacts/reminders/${reminderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    if (!response.ok) toast.error('Falha ao concluir lembrete.');
    else await fetchReminders();
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('toastUpdateFailed')
      );
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSavingCustom(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-lg"
        >
          {loading || !contact ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {/* Header */}
              <SheetHeader className="border-border/50 border-b p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="bg-muted border-border size-12 border">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-popover-foreground truncate">
                      {contact.name || t('unnamed')}
                    </SheetTitle>
                    <SheetDescription className="text-muted-foreground mt-0.5 text-xs">
                      {t('contactDetailsDesc')}
                    </SheetDescription>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                      <button
                        onClick={copyPhone}
                        className="hover:text-primary flex cursor-pointer items-center gap-1 transition-colors"
                      >
                        <Phone className="size-3" />
                        {contact.phone}
                        {copiedPhone ? (
                          <Check className="text-primary size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.company && (
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3" />
                          {contact.company}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {onEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(contact)}
                    >
                      <Pencil className="size-4" />
                      Editar contato
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => setTemplatePickerOpen(true)}
                    disabled={sendingTemplate}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {sendingTemplate ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LayoutTemplate className="size-4" />
                    )}
                    {t('sendTemplateBtn')}
                  </Button>
                </div>
              </SheetHeader>

              {/* Tabs */}
              <Tabs
                defaultValue="details"
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList className="border-border bg-muted/50 mx-4 mt-3 max-w-[calc(100%-2rem)] justify-start overflow-x-auto border-b">
                  <TabsTrigger
                    value="details"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.details')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="tags"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.tags')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="notes"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.notes')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="custom"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.custom')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="deals"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.deals')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="content"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.content')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="traffic"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    {t('tabs.traffic')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="timeline"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    <History /> Timeline
                  </TabsTrigger>
                  <TabsTrigger
                    value="reminders"
                    className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                  >
                    <Clock3 /> Lembretes
                  </TabsTrigger>
                </TabsList>

                {/* Details Tab */}
                <TabsContent
                  value="details"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('name')}
                      </Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('phone')} <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('email')}
                      </Label>
                      <Input
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-muted-foreground text-xs">
                        {t('company')}
                      </Label>
                      <Input
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <Button
                      onClick={saveDetails}
                      disabled={savingDetails}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingDetails ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t('saveChangesBtn')}
                    </Button>

                    <div className="border-border space-y-3 border-t pt-4">
                      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                        Perfil comercial
                      </p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <DetailValue
                          label="Nome preferido"
                          value={contact.preferred_name}
                        />
                        <DetailValue label="Cargo" value={contact.job_title} />
                        <DetailValue
                          label="Tipo"
                          value={contact.relationship_type}
                        />
                        <DetailValue
                          label="Status"
                          value={contact.relationship_status}
                        />
                        <DetailValue label="Origem" value={contact.source} />
                        <DetailValue
                          label="WhatsApp"
                          value={contact.whatsapp}
                        />
                        <DetailValue
                          label="Aniversário"
                          value={
                            contact.birth_day && contact.birth_month
                              ? `${String(contact.birth_day).padStart(2, '0')}/${String(contact.birth_month).padStart(2, '0')}${contact.birth_year ? `/${contact.birth_year}` : ''}`
                              : null
                          }
                        />
                        <DetailValue
                          label="CPF"
                          value={
                            contact.cpf
                              ? canSendMessages
                                ? contact.cpf
                                : `***.***.***-${contact.cpf.replace(/\D/g, '').slice(-2)}`
                              : null
                          }
                        />
                      </div>
                    </div>

                    <div className="border-border space-y-2 border-t pt-4 text-xs">
                      <p className="text-muted-foreground font-semibold tracking-wide uppercase">
                        Relacionamento
                      </p>
                      <DetailValue
                        label="Primeiro contato"
                        value={formatDateTime(contact.first_contact_at)}
                      />
                      <DetailValue
                        label="Último contato"
                        value={formatDateTime(contact.last_contact_at)}
                      />
                      <DetailValue
                        label="Próximo follow-up"
                        value={formatDateTime(contact.next_follow_up_at)}
                      />
                    </div>

                    {(contact.address_street || contact.address_city) && (
                      <div className="border-border space-y-2 border-t pt-4 text-xs">
                        <p className="text-muted-foreground font-semibold tracking-wide uppercase">
                          Endereço
                        </p>
                        <p className="text-foreground">
                          {[
                            contact.address_street,
                            contact.address_number,
                            contact.address_complement,
                            contact.address_neighborhood,
                            contact.address_city,
                            contact.address_state,
                            contact.address_zip,
                            contact.address_country,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      </div>
                    )}

                    {contact.notes && (
                      <div className="border-border space-y-2 border-t pt-4 text-xs">
                        <p className="text-muted-foreground font-semibold tracking-wide uppercase">
                          Observações
                        </p>
                        <p className="text-foreground whitespace-pre-wrap">
                          {contact.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Tags Tab */}
                <TabsContent
                  value="tags"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {t('tagsTab.clickTagDesc')}
                    </p>
                    {allTags.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('tagsTab.noTagsAvailable')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => {
                          const selected = contactTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleTag(tag.id)}
                              disabled={savingTags}
                              className={`inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                                selected
                                  ? 'ring-primary ring-offset-border ring-2 ring-offset-1'
                                  : 'opacity-50 hover:opacity-80'
                              }`}
                              style={{
                                backgroundColor: tag.color + '20',
                                color: tag.color,
                              }}
                            >
                              {selected && <Check className="mr-1 size-3" />}
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Notes Tab */}
                <TabsContent
                  value="notes"
                  className="flex min-h-0 flex-1 flex-col px-4 py-3"
                >
                  <div className="mb-3 space-y-2">
                    <Textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder={t('notesTab.placeholder')}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] resize-none text-sm"
                    />
                    <Button
                      onClick={addNote}
                      disabled={!newNote.trim() || savingNote}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      size="sm"
                    >
                      {savingNote ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      {t('notesTab.save')}
                    </Button>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="text-muted-foreground size-5 animate-spin" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="text-muted-foreground py-8 text-center text-sm">
                        {t('notesTab.noNotes')}
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="bg-muted/50 border-border/50 group rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-muted-foreground flex-1 text-sm whitespace-pre-wrap">
                              {note.note_text}
                            </p>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="text-muted-foreground shrink-0 cursor-pointer opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-xs">
                            {new Date(note.created_at).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                {/* Custom Fields Tab */}
                <TabsContent
                  value="custom"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingCustom ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
                    </div>
                  ) : customFields.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      {t('noCustomFields')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {customFields.map((field) => (
                        <div key={field.id} className="space-y-1.5">
                          <Label className="text-muted-foreground text-xs capitalize">
                            {field.field_name}
                          </Label>
                          <Input
                            value={customValues[field.id] ?? ''}
                            onChange={(e) =>
                              setCustomValues((prev) => ({
                                ...prev,
                                [field.id]: e.target.value,
                              }))
                            }
                            placeholder={t('enterCustomField', {
                              name: field.field_name,
                            })}
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
                          />
                        </div>
                      ))}
                      <Button
                        onClick={saveCustomFields}
                        disabled={savingCustom}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                        size="sm"
                      >
                        {savingCustom ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        {t('saveCustomFieldsBtn')}
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* Deals Tab */}
                <TabsContent
                  value="deals"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingDeals ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : deals.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('dealsTab.noDeals')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {deals.map((deal) => (
                        <div
                          key={deal.id}
                          className="border-border bg-muted/50 rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-foreground text-sm font-medium">
                              {deal.title}
                            </p>
                            {deal.stage && (
                              <span
                                className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${deal.stage.color}20`,
                                  color: deal.stage.color,
                                }}
                              >
                                {deal.stage.name}
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1">
                              <DollarSign className="size-3" />
                              {formatCurrency(
                                deal.value ?? 0,
                                deal.currency || defaultCurrency
                              )}
                            </span>
                            {deal.status && deal.status !== 'open' && (
                              <span
                                className={
                                  deal.status === 'won'
                                    ? 'text-primary'
                                    : 'text-red-400'
                                }
                              >
                                {deal.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Content Tab — social profiles + post history (item 8:
                  per-client history of content/social activity). */}
                <TabsContent
                  value="content"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingContent ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                          {t('contentTab.socialProfiles')}
                        </p>
                        {socialProfiles.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            {t('contentTab.noProfiles')}
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {socialProfiles.map((p) => (
                              <Badge key={p.id} variant="outline">
                                {p.platform} — {p.handle}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                          {t('contentTab.recentPosts')}
                        </p>
                        {contentPosts.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            {t('contentTab.noPosts')}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {contentPosts.map((post) => (
                              <Link
                                key={post.id}
                                href={`/content/${post.id}/edit`}
                                className="border-border bg-muted/50 hover:bg-muted block rounded-lg border p-3"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-foreground line-clamp-2 text-sm">
                                    {post.caption || t('contentTab.noCaption')}
                                  </p>
                                  <span
                                    className={
                                      CONTENT_STATUS_CLASS[post.status] ??
                                      'text-muted-foreground'
                                    }
                                  >
                                    {t(`contentTab.status.${post.status}`)}
                                  </span>
                                </div>
                                {post.error_message && (
                                  <p className="text-destructive mt-1 text-xs">
                                    {post.error_message}
                                  </p>
                                )}
                                <p className="text-muted-foreground mt-1 text-[10px]">
                                  {new Date(post.updated_at).toLocaleString()}
                                </p>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Traffic Tab — ad accounts, recent AI recommendations,
                  and optimization history for this client (Tráfego &
                  Performance module — see docs on "Clientes" using
                  the contacts list + this tab instead of a separate
                  client page). */}
                <TabsContent
                  value="traffic"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingTraffic ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                          {t('trafficTab.adAccounts')}
                        </p>
                        {trafficAdAccounts.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            {t('trafficTab.noAdAccounts')}
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {trafficAdAccounts.map((a) => (
                              <Link
                                key={a.id}
                                href={`/traffic/accounts/${a.id}`}
                              >
                                <Badge variant="outline">
                                  {a.platform} — {a.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                          {t('trafficTab.recentRecommendations')}
                        </p>
                        {trafficRecommendations.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            {t('trafficTab.noRecommendations')}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {trafficRecommendations.map((rec) => (
                              <Link
                                key={rec.id}
                                href={`/traffic/recommendations?contact_id=${rec.contact_id}`}
                                className="border-border bg-muted/50 hover:bg-muted block rounded-lg border p-3"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-foreground line-clamp-2 text-sm">
                                    {rec.problem}
                                  </p>
                                  <span
                                    className={
                                      RECOMMENDATION_PRIORITY_CLASS[
                                        rec.priority
                                      ] ?? 'text-muted-foreground'
                                    }
                                  >
                                    {
                                      RECOMMENDATION_PRIORITY_EMOJI[
                                        rec.priority
                                      ]
                                    }
                                  </span>
                                </div>
                                <p className="text-muted-foreground mt-1 text-[10px]">
                                  {new Date(rec.created_at).toLocaleString()}
                                </p>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                          {t('trafficTab.history')}
                        </p>
                        {trafficLog.length === 0 ? (
                          <p className="text-muted-foreground text-xs">
                            {t('trafficTab.noHistory')}
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {trafficLog.map((entry) => (
                              <li
                                key={entry.id}
                                className="text-muted-foreground text-xs"
                              >
                                <span className="text-foreground">
                                  {new Date(
                                    entry.created_at
                                  ).toLocaleDateString()}
                                </span>{' '}
                                — {entry.detail ?? entry.event}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="timeline"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  {loadingEvents ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : events.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      Nenhum evento registrado ainda.
                    </p>
                  ) : (
                    <ol className="border-border relative ml-2 border-l pl-5">
                      {events.map((event) => (
                        <li key={event.id} className="relative pb-5 last:pb-0">
                          <span className="bg-primary ring-popover absolute top-1.5 -left-[25px] size-2 rounded-full ring-4" />
                          <p className="text-foreground text-sm font-medium">
                            {eventLabel(event.event_type)}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {new Date(event.occurred_at).toLocaleString(
                              'pt-BR'
                            )}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </TabsContent>

                <TabsContent
                  value="reminders"
                  className="flex-1 overflow-y-auto px-4 py-3"
                >
                  <div className="space-y-4">
                    <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-3">
                      <Label className="text-xs">Novo lembrete</Label>
                      <Input
                        value={reminderTitle}
                        onChange={(event) =>
                          setReminderTitle(event.target.value)
                        }
                        placeholder="Ex.: Mandar parabéns para João"
                      />
                      <Input
                        type="datetime-local"
                        value={reminderAt}
                        onChange={(event) => setReminderAt(event.target.value)}
                      />
                      <Button
                        size="sm"
                        onClick={createReminder}
                        disabled={
                          !reminderTitle.trim() || !reminderAt || savingReminder
                        }
                      >
                        {savingReminder ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CalendarDays className="size-4" />
                        )}
                        Criar lembrete
                      </Button>
                    </div>
                    {reminders.length === 0 ? (
                      <p className="text-muted-foreground py-6 text-center text-sm">
                        Nenhum lembrete para este contato.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {reminders.map((reminder) => (
                          <div
                            key={reminder.id}
                            className="border-border flex items-start justify-between gap-3 rounded-lg border p-3"
                          >
                            <div>
                              <p
                                className={
                                  reminder.completed_at
                                    ? 'text-muted-foreground text-sm line-through'
                                    : 'text-foreground text-sm font-medium'
                                }
                              >
                                {reminder.title}
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {new Date(reminder.remind_at).toLocaleString(
                                  'pt-BR'
                                )}
                              </p>
                            </div>
                            {!reminder.completed_at && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => completeReminder(reminder.id)}
                              >
                                Concluir
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onSelect={handleSendTemplate}
      />
    </>
  );
}

function DetailValue({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

function formatDateTime(value?: string | null): string | null {
  return value ? new Date(value).toLocaleString('pt-BR') : null;
}

function eventLabel(type: ContactEvent['event_type']): string {
  return {
    CONTACT_CREATED: 'Contato criado',
    CONTACT_UPDATED: 'Dados do contato atualizados',
    CONTACT_DELETED: 'Contato movido para a lixeira',
    CONTACT_RESTORED: 'Contato restaurado',
    CONTACT_ARCHIVED: 'Contato arquivado',
    CONTACT_TAG_ADDED: 'Tag adicionada',
    CONTACT_TAG_REMOVED: 'Tag removida',
    CONTACT_OWNER_CHANGED: 'Responsável alterado',
    FOLLOWUP_CREATED: 'Lembrete de follow-up criado',
    MESSAGE_SENT: 'Mensagem enviada',
    MESSAGE_RECEIVED: 'Mensagem recebida',
  }[type];
}
