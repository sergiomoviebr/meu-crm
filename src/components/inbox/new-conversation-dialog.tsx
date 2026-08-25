'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Loader2,
  MessageCirclePlus,
  Plus,
  Search,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import type { Contact, Conversation, WhatsAppChannel } from '@/types';
import { GatedButton } from '@/components/ui/gated-button';
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

interface StartChannel {
  id: string;
  channel: WhatsAppChannel;
  personalSessionId: string | null;
  label: string;
  phoneNumber: string | null;
  isDefault: boolean;
}

interface NewConversationDialogProps {
  onOpened: (conversation: Conversation) => void;
}

function contactLabel(contact: Contact): string {
  return (
    contact.preferred_name?.trim() ||
    contact.name?.trim() ||
    contact.phone ||
    'Contato'
  );
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function NewConversationDialog({
  onOpened,
}: NewConversationDialogProps) {
  const t = useTranslations('Inbox.newConversation');
  const canStart = useCan('send-messages');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [manualPhone, setManualPhone] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [channels, setChannels] = useState<StartChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null
  );
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingChannels(true);
    void fetch('/api/conversations/start')
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || t('loadFailed'));
        if (cancelled) return;
        const available = (data?.channels ?? []) as StartChannel[];
        setChannels(available);
        const preferred =
          available.find(
            (item) => item.channel === 'whatsapp_personal' && item.isDefault
          ) ?? available[0];
        setSelectedChannelId(preferred?.id ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : t('loadFailed')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingChannels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingContacts(true);
      const params = new URLSearchParams({ page_size: '20' });
      if (search.trim()) params.set('search', search.trim());
      void fetch(`/api/contacts?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error || t('loadFailed'));
          setContacts((data?.contacts ?? []) as Contact[]);
        })
        .catch((loadError) => {
          if (
            loadError instanceof DOMException &&
            loadError.name === 'AbortError'
          )
            return;
          setError(
            loadError instanceof Error ? loadError.message : t('loadFailed')
          );
        })
        .finally(() => setLoadingContacts(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, t]);

  const typedPhone = useMemo(() => normalizedPhone(search), [search]);
  const canUseTypedPhone = /^[1-9]\d{6,14}$/.test(typedPhone);
  const selectedChannel = channels.find(
    (item) => item.id === selectedChannelId
  );
  const hasRecipient = Boolean(selectedContact || manualPhone);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSearch('');
      setContacts([]);
      setSelectedContact(null);
      setManualPhone(null);
      setManualName('');
      setError(null);
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    setSelectedContact(null);
    setManualPhone(null);
    setError(null);
  }

  async function handleSubmit() {
    if (!hasRecipient || !selectedChannel) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: selectedContact?.id,
          phone: manualPhone,
          name: manualPhone ? manualName.trim() || undefined : undefined,
          channel: selectedChannel.channel,
          personalSessionId: selectedChannel.personalSessionId ?? undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.conversation) {
        throw new Error(data?.error || t('openFailed'));
      }
      onOpened(data.conversation as Conversation);
      setOpen(false);
      toast.success(t('opened'));
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : t('openFailed')
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <GatedButton
        canAct={canStart}
        gateReason={t('gateReason')}
        size="sm"
        onClick={() => handleOpenChange(true)}
        className="h-8 gap-1.5"
      >
        <MessageCirclePlus className="h-4 w-4" />
        {t('trigger')}
      </GatedButton>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[min(90vh,760px)] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-5 py-1">
            <section className="space-y-2">
              <Label htmlFor="new-conversation-search">{t('recipient')}</Label>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  id="new-conversation-search"
                  value={search}
                  onChange={(event) => handleSearch(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="pl-9"
                  autoComplete="off"
                />
                {loadingContacts ? (
                  <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                ) : null}
              </div>

              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-1">
                {contacts.map((contact) => {
                  const selected = selectedContact?.id === contact.id;
                  return (
                    <button
                      type="button"
                      key={contact.id}
                      onClick={() => {
                        setSelectedContact(contact);
                        setManualPhone(null);
                        setSearch(contactLabel(contact));
                      }}
                      className={cn(
                        'hover:bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                        selected && 'bg-primary/10 ring-primary/30 ring-1'
                      )}
                    >
                      <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                        <UserRound className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {contactLabel(contact)}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {contact.whatsapp || contact.phone}
                          {contact.company ? ` · ${contact.company}` : ''}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="text-primary h-4 w-4" />
                      ) : null}
                    </button>
                  );
                })}

                {canUseTypedPhone && !selectedContact ? (
                  <button
                    type="button"
                    onClick={() => setManualPhone(typedPhone)}
                    className={cn(
                      'hover:bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                      manualPhone === typedPhone &&
                        'bg-primary/10 ring-primary/30 ring-1'
                    )}
                  >
                    <span className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium">
                      {t('usePhone', { phone: `+${typedPhone}` })}
                    </span>
                    {manualPhone === typedPhone ? (
                      <Check className="text-primary h-4 w-4" />
                    ) : null}
                  </button>
                ) : null}

                {!loadingContacts &&
                contacts.length === 0 &&
                !canUseTypedPhone ? (
                  <p className="text-muted-foreground px-3 py-5 text-center text-sm">
                    {search.trim() ? t('noResults') : t('noContacts')}
                  </p>
                ) : null}
              </div>

              {manualPhone ? (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="new-conversation-name">
                    {t('nameLabel')}
                  </Label>
                  <Input
                    id="new-conversation-name"
                    value={manualName}
                    onChange={(event) => setManualName(event.target.value)}
                    placeholder={t('namePlaceholder')}
                    maxLength={120}
                  />
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <Label>{t('channel')}</Label>
              {loadingChannels ? (
                <div className="text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-4 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('loadingChannels')}
                </div>
              ) : channels.length === 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm">
                  <p>{t('noChannels')}</p>
                  <Link
                    href="/settings?section=whatsapp-personal"
                    className="text-primary mt-1 inline-block font-medium hover:underline"
                  >
                    {t('openSettings')}
                  </Link>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {channels.map((channel) => {
                    const selected = channel.id === selectedChannelId;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => setSelectedChannelId(channel.id)}
                        className={cn(
                          'hover:bg-muted flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                          selected &&
                            'border-primary bg-primary/5 ring-primary/20 ring-1'
                        )}
                      >
                        <Smartphone
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            selected ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {channel.label}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {channel.phoneNumber ||
                              (channel.channel === 'meta_cloud_api'
                                ? t('official')
                                : t('personal'))}
                          </span>
                        </span>
                        {selected ? (
                          <Check className="text-primary h-4 w-4" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {error ? (
              <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="m-0 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!hasRecipient || !selectedChannel || submitting}
            >
              {submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MessageCirclePlus />
              )}
              {submitting ? t('opening') : t('open')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
