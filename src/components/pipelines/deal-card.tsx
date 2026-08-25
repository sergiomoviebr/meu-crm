'use client';

import { useRouter } from 'next/navigation';
import {
  BellRing,
  Building2,
  Check,
  CheckCheck,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  UserRound,
  X,
} from 'lucide-react';

import type { Deal, PipelineReplySettings, PipelineStage } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  compactElapsed,
  conversationState,
  minutesSince,
  replyPriority,
  waitingMinutes,
} from '@/lib/pipelines/conversation-status';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  settings: PipelineReplySettings;
  now: number;
  onEdit: (deal: Deal) => void;
  onPreview: (deal: Deal) => void;
  onRemind: (deal: Deal) => void;
  isOverlay?: boolean;
}

const FALLBACK_REPLY_SETTINGS: PipelineReplySettings = {
  newMinutes: 30,
  attentionMinutes: 120,
  overdueMinutes: 360,
  messageNotifications: true,
};

function initials(name?: string | null, fallback?: string | null) {
  const source = (name || fallback || '?').trim();
  return source ? source.charAt(0).toUpperCase() : '?';
}

function sourceLabel(deal: Deal): string {
  if (deal.contact?.source) return deal.contact.source;
  if (deal.conversation?.channel === 'whatsapp_personal') {
    return 'WhatsApp pessoal';
  }
  if (deal.conversation) return 'WhatsApp';
  return 'Manual';
}

export function DealCard({
  deal,
  stage,
  settings = FALLBACK_REPLY_SETTINGS,
  now,
  onEdit,
  onPreview,
  onRemind,
  isOverlay,
}: DealCardProps) {
  const router = useRouter();
  const contactName =
    deal.contact?.preferred_name ||
    deal.contact?.name ||
    deal.contact?.phone ||
    deal.title ||
    'Contato';
  const phone = deal.contact?.phone;
  const conversation = deal.conversation;
  const state = conversationState(deal);
  const waiting = waitingMinutes(deal, now);
  const lastInteraction = minutesSince(conversation?.last_message_at, now);
  const priority = waiting === null ? null : replyPriority(waiting, settings);
  const assigneeLabel = deal.assignee?.full_name || null;

  const status = (() => {
    if (state === 'no_messages') {
      return {
        label: 'Sem mensagens',
        className: 'bg-muted text-muted-foreground',
        icon: MessageCircle,
      };
    }
    if (state === 'responded') {
      return {
        label: `Respondido${lastInteraction === null ? '' : ` · ${compactElapsed(lastInteraction)}`}`,
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        icon: CheckCheck,
      };
    }
    const unread = conversation?.unread_count ?? 0;
    const labelPrefix =
      state === 'new_message'
        ? `${unread} nova${unread > 1 ? 's' : ''}`
        : priority === 'overdue'
          ? 'Resposta atrasada'
          : priority === 'attention'
            ? 'Atenção'
            : priority === 'new'
              ? 'Novo'
              : 'Aguardando resposta';
    const className =
      priority === 'overdue'
        ? 'bg-red-500/12 text-red-700 dark:text-red-300'
        : priority === 'attention'
          ? 'bg-orange-500/12 text-orange-700 dark:text-orange-300'
          : priority === 'waiting'
            ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    return {
      label: `${labelPrefix}${waiting === null ? '' : ` · ${compactElapsed(waiting)}`}`,
      className,
      icon: BellRing,
    };
  })();
  const StatusIcon = status.icon;

  function stopPointer(event: React.PointerEvent) {
    event.stopPropagation();
  }

  function openConversation() {
    if (conversation?.id) router.push(`/inbox?c=${conversation.id}`);
  }

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={() => !isOverlay && onEdit(deal)}
      onKeyDown={(event) => {
        if (!isOverlay && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onEdit(deal);
        }
      }}
      className={cn(
        'group border-border/60 bg-card relative w-full cursor-pointer rounded-xl border p-3 pl-4 text-left shadow-sm transition-all',
        'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-border hover:-translate-y-0.5 hover:shadow-md',
        conversation?.awaiting_reply && priority === 'overdue'
          ? 'border-red-500/35'
          : conversation?.awaiting_reply
            ? 'border-amber-500/25'
            : ''
      )}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="flex items-start gap-2">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
          {initials(contactName, phone)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-foreground truncate text-sm font-semibold">
                {contactName}
              </h4>
              {deal.contact?.company && (
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[11px]">
                  <Building2 className="size-3 shrink-0" />
                  {deal.contact.company}
                </p>
              )}
            </div>
            {!isOverlay && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground -mt-1 -mr-1 shrink-0"
                      onPointerDown={stopPointer}
                      onClick={(event) => event.stopPropagation()}
                      aria-label="Ações do card"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {conversation?.id && (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        openConversation();
                      }}
                    >
                      <MessageCircle className="size-4" /> Abrir conversa
                    </DropdownMenuItem>
                  )}
                  {deal.contact_id && (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/contacts?contact=${deal.contact_id}`);
                      }}
                    >
                      <UserRound className="size-4" /> Abrir contato
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemind(deal);
                    }}
                  >
                    <Clock3 className="size-4" /> Lembrar depois
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(deal);
                    }}
                  >
                    <Pencil className="size-4" /> Editar oportunidade
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              {sourceLabel(deal)}
            </span>
            {deal.status === 'won' && (
              <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                <Check className="size-3" /> Ganho
              </span>
            )}
            {deal.status === 'lost' && (
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
                <X className="mr-1 inline size-3" /> Perdido
              </span>
            )}
          </div>
        </div>
      </div>

      {phone && (
        <p className="text-muted-foreground mt-2 flex items-center gap-1 text-[11px]">
          <Phone className="size-3" /> {phone}
        </p>
      )}

      {conversation?.last_message_text ? (
        <button
          type="button"
          className="border-border/70 bg-muted/45 hover:bg-muted mt-2 w-full rounded-lg border px-2.5 py-2 text-left transition-colors"
          onPointerDown={stopPointer}
          onClick={(event) => {
            event.stopPropagation();
            onPreview(deal);
          }}
        >
          <span className="text-muted-foreground mb-0.5 block text-[10px] font-semibold">
            {conversation.last_message_direction === 'customer'
              ? 'Cliente'
              : conversation.last_message_direction === 'bot'
                ? 'Automação'
                : 'Você'}
          </span>
          <span className="text-foreground/85 line-clamp-2 text-xs leading-relaxed">
            “{conversation.last_message_text}”
          </span>
        </button>
      ) : (
        <div className="border-border/60 text-muted-foreground mt-2 rounded-lg border border-dashed px-2.5 py-2 text-xs">
          Nenhuma mensagem nesta conversa.
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold',
            status.className
          )}
        >
          <span className="relative flex size-3 items-center justify-center">
            {conversation?.awaiting_reply && (
              <span className="absolute size-2 animate-ping rounded-full bg-current opacity-25" />
            )}
            <StatusIcon className="relative size-3" />
          </span>
          <span className="truncate">{status.label}</span>
        </span>

        {conversation?.id && !isOverlay && (
          <Button
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs"
            onPointerDown={stopPointer}
            onClick={(event) => {
              event.stopPropagation();
              openConversation();
            }}
          >
            <MessageCircle className="size-3.5" /> Responder
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 truncate text-[10px]">
          {deal.title !== contactName ? deal.title : 'Oportunidade'}
        </p>
        {assigneeLabel && (
          <span
            title={`Responsável: ${assigneeLabel}`}
            className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[10px]"
          >
            <UserRound className="size-3" />
            <span className="max-w-20 truncate">{assigneeLabel}</span>
          </span>
        )}
      </div>

      {deal.tags && deal.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deal.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {deal.tags.length > 2 && (
            <span className="text-muted-foreground text-[9px]">
              +{deal.tags.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
