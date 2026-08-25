'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  MapPin,
  UserRound,
  BriefcaseBusiness,
} from 'lucide-react';

import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import {
  CONTACT_RELATIONSHIP_STATUSES,
  CONTACT_RELATIONSHIP_TYPES,
  formatCnpj,
  formatCpf,
} from '@/lib/contacts/profile';
import {
  findExistingContact,
  isExactMatch,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { AccountMember, Contact, ContactTag, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from 'next-intl';

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  contactTags?: ContactTag[];
  onSaved: () => void;
  onViewExisting?: (contactId: string) => void;
}

interface FormState {
  name: string;
  preferred_name: string;
  company: string;
  job_title: string;
  email: string;
  phone: string;
  whatsapp: string;
  secondary_phone: string;
  cpf: string;
  cnpj: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  notes: string;
  address_zip: string;
  address_street: string;
  address_number: string;
  address_complement: string;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  address_country: string;
  relationship_type: string;
  source: string;
  owner_user_id: string;
  relationship_status: string;
  first_contact_at: string;
  last_contact_at: string;
  next_follow_up_at: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  preferred_name: '',
  company: '',
  job_title: '',
  email: '',
  phone: '',
  whatsapp: '',
  secondary_phone: '',
  cpf: '',
  cnpj: '',
  birth_day: '',
  birth_month: '',
  birth_year: '',
  notes: '',
  address_zip: '',
  address_street: '',
  address_number: '',
  address_complement: '',
  address_neighborhood: '',
  address_city: '',
  address_state: '',
  address_country: 'Brasil',
  relationship_type: 'lead',
  source: '',
  owner_user_id: '',
  relationship_status: 'active',
  first_contact_at: '',
  last_contact_at: '',
  next_follow_up_at: '',
};

function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function stateFromContact(contact?: Contact | null): FormState {
  if (!contact) return { ...EMPTY_FORM };
  const state = { ...EMPTY_FORM };
  for (const key of Object.keys(state) as Array<keyof FormState>) {
    const value = contact[key as keyof Contact];
    if (value != null) state[key] = String(value);
  }
  state.birth_day = contact.birth_day ? String(contact.birth_day) : '';
  state.birth_month = contact.birth_month ? String(contact.birth_month) : '';
  state.birth_year = contact.birth_year ? String(contact.birth_year) : '';
  state.first_contact_at = localDateTime(contact.first_contact_at);
  state.last_contact_at = localDateTime(contact.last_contact_at);
  state.next_follow_up_at = localDateTime(contact.next_follow_up_at);
  state.relationship_type = contact.relationship_type ?? 'lead';
  state.relationship_status = contact.relationship_status ?? 'active';
  state.address_country = contact.address_country ?? 'Brasil';
  return state;
}

const TYPE_LABELS: Record<string, string> = {
  client: 'Cliente',
  lead: 'Lead',
  prospect: 'Prospect',
  partner: 'Parceiro',
  supplier: 'Fornecedor',
  other: 'Outro',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  nurturing: 'Em relacionamento',
  qualified: 'Qualificado',
  unqualified: 'Desqualificado',
};

export function ContactForm({
  open,
  onOpenChange,
  contact,
  contactTags = [],
  onSaved,
  onViewExisting,
}: ContactFormProps) {
  const t = useTranslations('Contacts.form');
  const { accountId } = useAuth();
  const isEdit = Boolean(contact);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState('main');
  const [dupMatch, setDupMatch] = useState<{
    contact: ExistingContact;
    exact: boolean;
  } | null>(null);
  const [checkingDup, setCheckingDup] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const initial = useMemo(() => stateFromContact(contact), [contact]);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setSelectedTagIds(contactTags.map((item) => item.tag_id));
    setDupMatch(null);
    setDirty(false);
    setActiveTab('main');
    setLoadingTags(true);
    const db = createClient();
    void Promise.all([
      db.from('tags').select('*').order('name'),
      fetch('/api/account/members').then((response) => response.json()),
    ]).then(([tagsResult, membersResult]) => {
      setTags((tagsResult.data ?? []) as Tag[]);
      setMembers((membersResult.members ?? []) as AccountMember[]);
      setLoadingTags(false);
    });
  }, [open, initial, contactTags]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function requestOpenChange(nextOpen: boolean) {
    if (
      !nextOpen &&
      dirty &&
      !saving &&
      !window.confirm('Descartar as alterações não salvas?')
    )
      return;
    onOpenChange(nextOpen);
  }

  async function checkDuplicate() {
    if (isEdit || !accountId || !form.phone.trim()) return;
    setCheckingDup(true);
    try {
      const existing = await findExistingContact(
        createClient(),
        accountId,
        form.phone.trim()
      );
      setDupMatch(
        existing
          ? { contact: existing, exact: isExactMatch(existing, form.phone) }
          : null
      );
    } finally {
      setCheckingDup(false);
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
    setDirty(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.phone.trim()) {
      toast.error(t('phoneRequired'));
      setActiveTab('main');
      return;
    }
    if (!isEdit && dupMatch?.exact) {
      toast.error(t('toastConflict'));
      return;
    }
    setSaving(true);
    try {
      const nullableNumber = (value: string) => (value ? Number(value) : null);
      const nullableDate = (value: string) =>
        value ? new Date(value).toISOString() : null;
      const payload = {
        ...form,
        owner_user_id: form.owner_user_id || null,
        birth_day: nullableNumber(form.birth_day),
        birth_month: nullableNumber(form.birth_month),
        birth_year: nullableNumber(form.birth_year),
        first_contact_at: nullableDate(form.first_contact_at),
        last_contact_at: nullableDate(form.last_contact_at),
        next_follow_up_at: nullableDate(form.next_follow_up_at),
      };
      const response = await fetch(
        isEdit ? `/api/contacts/${contact?.id}` : '/api/contacts',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t('toastError'));
      const contactId = contact?.id ?? body.contact?.id;
      if (!contactId) throw new Error(t('toastError'));

      const currentTags = new Set(contactTags.map((item) => item.tag_id));
      const wantedTags = new Set(selectedTagIds);
      await Promise.all([
        ...[...currentTags]
          .filter((id) => !wantedTags.has(id))
          .map((id) => deleteContactTag(contactId, id)),
        ...[...wantedTags]
          .filter((id) => !currentTags.has(id))
          .map((id) => addContactTag(contactId, id)),
      ]);
      setDirty(false);
      toast.success(isEdit ? t('toastSuccessEdit') : t('toastSuccessAdd'));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground max-h-[92vh] overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-border border-b px-6 py-4">
          <DialogTitle>{isEdit ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>
            Dados essenciais primeiro; informações comerciais e endereço ficam
            organizados em abas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="min-h-0 gap-0"
          >
            <TabsList
              variant="line"
              className="mx-6 mt-2 w-[calc(100%-3rem)] justify-start overflow-x-auto"
            >
              <TabsTrigger value="main">
                <UserRound /> Principal
              </TabsTrigger>
              <TabsTrigger value="relationship">
                <BriefcaseBusiness /> Relacionamento
              </TabsTrigger>
              <TabsTrigger value="address">
                <MapPin /> Endereço
              </TabsTrigger>
            </TabsList>
            <div className="max-h-[62vh] overflow-y-auto px-6 py-5">
              <TabsContent value="main" className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nome completo">
                    <Input
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                      placeholder="Nome e sobrenome"
                    />
                  </Field>
                  <Field label="Nome preferido">
                    <Input
                      value={form.preferred_name}
                      onChange={(e) => update('preferred_name', e.target.value)}
                      placeholder="Como prefere ser chamado"
                    />
                  </Field>
                  <Field label="Telefone *">
                    <Input
                      value={form.phone}
                      onChange={(e) => {
                        update('phone', e.target.value);
                        setDupMatch(null);
                      }}
                      onBlur={checkDuplicate}
                      placeholder="+55 11 99999-9999"
                    />
                    {checkingDup && (
                      <p className="text-muted-foreground text-xs">
                        Verificando duplicidade…
                      </p>
                    )}
                    {dupMatch && (
                      <div
                        className={`flex gap-2 rounded-md border p-2 text-xs ${dupMatch.exact ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-500/40 bg-amber-500/10 text-amber-600'}`}
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <div>
                          <p>
                            {dupMatch.exact ? t('dupExact') : t('dupSimilar')}
                          </p>
                          {onViewExisting && (
                            <button
                              type="button"
                              className="font-medium underline"
                              onClick={() =>
                                onViewExisting(dupMatch.contact.id)
                              }
                            >
                              {t('viewExisting', {
                                name:
                                  dupMatch.contact.name ||
                                  dupMatch.contact.phone,
                              })}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </Field>
                  <Field label="WhatsApp">
                    <Input
                      value={form.whatsapp}
                      onChange={(e) => update('whatsapp', e.target.value)}
                      placeholder="Se for diferente do telefone"
                    />
                  </Field>
                  <Field label="Segundo telefone">
                    <Input
                      value={form.secondary_phone}
                      onChange={(e) =>
                        update('secondary_phone', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                    />
                  </Field>
                  <Field label="Empresa">
                    <Input
                      value={form.company}
                      onChange={(e) => update('company', e.target.value)}
                    />
                  </Field>
                  <Field label="Cargo">
                    <Input
                      value={form.job_title}
                      onChange={(e) => update('job_title', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Tags">
                  {loadingTags ? (
                    <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  ) : tags.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('noTagsAvailable')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const selected = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${selected ? 'ring-primary ring-offset-background ring-2 ring-offset-2' : 'opacity-60 hover:opacity-100'}`}
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>
              </TabsContent>

              <TabsContent value="relationship" className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Tipo de relacionamento">
                    <Select
                      value={form.relationship_type}
                      onValueChange={(value) =>
                        update('relationship_type', value ?? 'lead')
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTACT_RELATIONSHIP_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {TYPE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Status">
                    <Select
                      value={form.relationship_status}
                      onValueChange={(value) =>
                        update('relationship_status', value ?? 'active')
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTACT_RELATIONSHIP_STATUSES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {STATUS_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Origem">
                    <Input
                      value={form.source}
                      onChange={(e) => update('source', e.target.value)}
                      placeholder="Indicação, Instagram, evento…"
                    />
                  </Field>
                  <Field label="Responsável">
                    <Select
                      value={form.owner_user_id || 'none'}
                      onValueChange={(value) =>
                        update(
                          'owner_user_id',
                          value === 'none' ? '' : (value ?? '')
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sem responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem responsável</SelectItem>
                        {members.map((member) => (
                          <SelectItem
                            key={member.user_id}
                            value={member.user_id}
                          >
                            {member.full_name || member.email || 'Membro'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="CPF">
                    <Input
                      value={form.cpf}
                      onChange={(e) => update('cpf', formatCpf(e.target.value))}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="CNPJ">
                    <Input
                      value={form.cnpj}
                      onChange={(e) =>
                        update('cnpj', formatCnpj(e.target.value))
                      }
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <div>
                  <Label className="mb-2 block text-sm">
                    Data de nascimento
                  </Label>
                  <div className="grid max-w-md grid-cols-3 gap-2">
                    <Input
                      value={form.birth_day}
                      onChange={(e) =>
                        update(
                          'birth_day',
                          e.target.value.replace(/\D/g, '').slice(0, 2)
                        )
                      }
                      placeholder="Dia"
                      inputMode="numeric"
                    />
                    <Input
                      value={form.birth_month}
                      onChange={(e) =>
                        update(
                          'birth_month',
                          e.target.value.replace(/\D/g, '').slice(0, 2)
                        )
                      }
                      placeholder="Mês"
                      inputMode="numeric"
                    />
                    <Input
                      value={form.birth_year}
                      onChange={(e) =>
                        update(
                          'birth_year',
                          e.target.value.replace(/\D/g, '').slice(0, 4)
                        )
                      }
                      placeholder="Ano (opcional)"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    O ano é opcional; dia e mês alimentam os alertas de
                    aniversário.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Primeiro contato">
                    <Input
                      type="datetime-local"
                      value={form.first_contact_at}
                      onChange={(e) =>
                        update('first_contact_at', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Último contato">
                    <Input
                      type="datetime-local"
                      value={form.last_contact_at}
                      onChange={(e) =>
                        update('last_contact_at', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Próximo follow-up">
                    <Input
                      type="datetime-local"
                      value={form.next_follow_up_at}
                      onChange={(e) =>
                        update('next_follow_up_at', e.target.value)
                      }
                    />
                  </Field>
                </div>
                <Field label="Observações importantes">
                  <Textarea
                    value={form.notes}
                    onChange={(e) => update('notes', e.target.value)}
                    rows={4}
                    placeholder="Contexto do relacionamento, preferências e informações relevantes."
                  />
                </Field>
              </TabsContent>

              <TabsContent value="address" className="space-y-5">
                <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
                  O CEP já está estruturado para receber preenchimento
                  automático futuramente, sem bloquear o cadastro manual.
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="CEP">
                    <Input
                      value={form.address_zip}
                      onChange={(e) => update('address_zip', e.target.value)}
                    />
                  </Field>
                  <Field label="Rua" className="lg:col-span-2">
                    <Input
                      value={form.address_street}
                      onChange={(e) => update('address_street', e.target.value)}
                    />
                  </Field>
                  <Field label="Número">
                    <Input
                      value={form.address_number}
                      onChange={(e) => update('address_number', e.target.value)}
                    />
                  </Field>
                  <Field label="Complemento">
                    <Input
                      value={form.address_complement}
                      onChange={(e) =>
                        update('address_complement', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Bairro">
                    <Input
                      value={form.address_neighborhood}
                      onChange={(e) =>
                        update('address_neighborhood', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={form.address_city}
                      onChange={(e) => update('address_city', e.target.value)}
                    />
                  </Field>
                  <Field label="Estado">
                    <Input
                      value={form.address_state}
                      onChange={(e) => update('address_state', e.target.value)}
                    />
                  </Field>
                  <Field label="País">
                    <Input
                      value={form.address_country}
                      onChange={(e) =>
                        update('address_country', e.target.value)
                      }
                    />
                  </Field>
                </div>
              </TabsContent>
            </div>
          </Tabs>
          <DialogFooter className="border-border bg-popover border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => requestOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                saving || checkingDup || (!isEdit && Boolean(dupMatch?.exact))
              }
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t('update') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-muted-foreground text-sm">{label}</Label>
      {children}
    </div>
  );
}
