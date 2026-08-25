'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCheck,
  Loader2,
  MessageCircle,
  Phone,
  UserRound,
} from 'lucide-react';

import type { Deal, Message } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface ConversationPreviewProps {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConversationPreview({
  deal,
  open,
  onOpenChange,
}: ConversationPreviewProps) {
  const router = useRouter();
  const conversationId = deal?.conversation?.id;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    const activeConversationId = conversationId;
    let cancelled = false;
    const supabase = createClient();

    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: false })
        .limit(12);
      if (!cancelled) {
        setMessages(((data ?? []) as Message[]).reverse());
        setLoadedConversationId(activeConversationId);
      }
    }

    void load();
    const channel = supabase
      .channel(`pipeline-preview-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          setMessages((current) => {
            if (!current) return [row];
            if (current.some((message) => message.id === row.id))
              return current;
            return [...current, row].slice(-12);
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, open]);

  const contactName =
    deal?.contact?.preferred_name ||
    deal?.contact?.name ||
    deal?.contact?.phone ||
    'Contato';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader className="border-border border-b pr-12">
          <SheetTitle>{contactName}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {deal?.contact?.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" /> {deal.contact.phone}
              </span>
            )}
            <span>
              {deal?.conversation?.channel === 'whatsapp_personal'
                ? 'WhatsApp pessoal'
                : 'WhatsApp oficial'}
            </span>
            <span className="capitalize">{deal?.conversation?.status}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {messages === null || loadedConversationId !== conversationId ? (
            <div className="flex h-full min-h-48 items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center text-sm">
              <MessageCircle className="mb-2 size-8" />
              Nenhuma mensagem nesta conversa.
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((message) => {
                const incoming = message.sender_type === 'customer';
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'flex',
                      incoming ? 'justify-start' : 'justify-end'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[88%] rounded-xl px-3 py-2',
                        incoming
                          ? 'bg-muted text-foreground rounded-bl-sm'
                          : 'bg-primary text-primary-foreground rounded-br-sm'
                      )}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content_text || `[${message.content_type}]`}
                      </p>
                      <div
                        className={cn(
                          'mt-1 flex items-center justify-end gap-1 text-[10px]',
                          incoming
                            ? 'text-muted-foreground'
                            : 'text-primary-foreground/75'
                        )}
                      >
                        {!incoming && <CheckCheck className="size-3" />}
                        {formatDistanceToNow(new Date(message.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <SheetFooter className="border-border border-t">
          <Button
            disabled={!conversationId}
            onClick={() =>
              conversationId && router.push(`/inbox?c=${conversationId}`)
            }
          >
            <MessageCircle className="size-4" /> Responder
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={!deal?.contact_id}
              onClick={() =>
                deal?.contact_id &&
                router.push(`/contacts?contact=${deal.contact_id}`)
              }
            >
              <UserRound className="size-4" /> Abrir contato
            </Button>
            <Button
              variant="outline"
              disabled={!conversationId}
              onClick={() =>
                conversationId && router.push(`/inbox?c=${conversationId}`)
              }
            >
              Ver conversa completa
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
