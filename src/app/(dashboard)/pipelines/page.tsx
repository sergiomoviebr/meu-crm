'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  Pipeline,
  PipelineStage,
  Deal,
  PipelineReplySettings,
} from '@/types';
import { PipelineBoard } from '@/components/pipelines/pipeline-board';
import { PipelineSettings } from '@/components/pipelines/pipeline-settings';
import { DealForm } from '@/components/pipelines/deal-form';
import { PipelineAnalytics } from '@/components/pipelines/pipeline-analytics';
import { ConversationPreview } from '@/components/pipelines/conversation-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  GitBranch,
  Plus,
  ChevronDown,
  Settings,
  BellRing,
  Clock3,
  Filter,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';
import {
  compactElapsed,
  conversationState,
  minutesSince,
  waitingMinutes,
} from '@/lib/pipelines/conversation-status';

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 }, // blue
  { name: 'Qualified', color: '#eab308', position: 1 }, // yellow
  { name: 'Proposal Sent', color: '#f97316', position: 2 }, // orange
  { name: 'Negotiation', color: '#8b5cf6', position: 3 }, // purple
  { name: 'Won', color: '#22c55e', position: 4 }, // green
];

const DEFAULT_REPLY_SETTINGS: PipelineReplySettings = {
  newMinutes: 30,
  attentionMinutes: 120,
  overdueMinutes: 360,
  messageNotifications: true,
};

type ConversationFilter =
  'all' | 'awaiting' | 'new' | 'responded' | 'stale' | 'whatsapp';
type ConversationSort =
  'priority' | 'recent' | 'oldest' | 'interaction' | 'waiting';

export default function PipelinesPage() {
  const t = useTranslations('Pipelines.page');
  const supabase = createClient();
  const canEditSettings = useCan('edit-settings');
  const canCreateDeals = useCan('send-messages');
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [conversationFilter, setConversationFilter] =
    useState<ConversationFilter>('all');
  const [conversationSort, setConversationSort] =
    useState<ConversationSort>('priority');
  const [replySettings, setReplySettings] = useState<PipelineReplySettings>(
    DEFAULT_REPLY_SETTINGS
  );
  const [savingReplySettings, setSavingReplySettings] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>('');
  const [previewDeal, setPreviewDeal] = useState<Deal | null>(null);
  const [reminderDeal, setReminderDeal] = useState<Deal | null>(null);
  const [reminderPreset, setReminderPreset] = useState('60');
  const [customReminderAt, setCustomReminderAt] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at');
    if (error) {
      console.error('Failed to load pipelines:', error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      return data ?? [];
    },
    [supabase]
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data, error } = await supabase
        .from('pipeline_deal_cards')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('Failed to load pipeline cards:', error.message);
        toast.error('Não foi possível atualizar os cards do pipeline.');
      }
      return (data ?? []) as Deal[];
    },
    [supabase]
  );

  const seedDefaultPipeline =
    useCallback(async (): Promise<Pipeline | null> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      // pipelines.account_id is NOT NULL post-017 with no DB default.
      if (!accountId) return null;

      const { data: pipeline, error } = await supabase
        .from('pipelines')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: 'Sales Pipeline',
        })
        .select()
        .single();

      if (error || !pipeline) {
        console.error('Failed to seed pipeline:', error?.message);
        return null;
      }

      const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      }));
      await supabase.from('pipeline_stages').insert(stagesPayload);

      return pipeline as Pipeline;
    }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id
        );
      } else {
        setSelectedPipelineId('');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  useEffect(() => {
    void fetch('/api/pipelines/settings')
      .then((response) => response.json())
      .then((body) => {
        if (body.settings) setReplySettings(body.settings);
      })
      .catch(() => null);

    const requestedView = new URLSearchParams(window.location.search).get(
      'view'
    );
    if (requestedView === 'awaiting') setConversationFilter('awaiting');

    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId('');
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // Conversations are the authoritative realtime signal: every inserted
  // inbound/outbound message updates its reply state in the DB trigger.
  // Debouncing collapses message + conversation + deal events into one
  // aggregate view refresh instead of refetching once per event.
  useEffect(() => {
    if (!accountId || !selectedPipelineId) return;
    const scheduleRefresh = () => {
      if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current);
      realtimeRefreshRef.current = setTimeout(() => void refreshDeals(), 120);
    };
    const channel = supabase
      .channel(`pipeline-intelligence-${selectedPipelineId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `account_id=eq.${accountId}`,
        },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deals',
          filter: `account_id=eq.${accountId}`,
        },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contacts',
          filter: `account_id=eq.${accountId}`,
        },
        scheduleRefresh
      )
      .subscribe();
    return () => {
      if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current);
      realtimeRefreshRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [accountId, refreshDeals, selectedPipelineId, supabase]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d))
      );
      const { error } = await supabase
        .from('deals')
        .update({ stage_id: newStageId })
        .eq('id', dealId);
      if (error) {
        toast.error(t('toastFailedMoveDeal'));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t]
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? '');
      setDealFormOpen(true);
    },
    [stages]
  );

  const quickCreateHandled = useRef(false);
  useEffect(() => {
    if (quickCreateHandled.current || stages.length === 0) return;
    if (new URLSearchParams(window.location.search).get('new') !== '1') return;
    quickCreateHandled.current = true;
    handleAddDeal();
  }, [handleAddDeal, stages.length]);

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  const deepLinkedDealHandled = useRef(false);
  useEffect(() => {
    if (deepLinkedDealHandled.current || deals.length === 0) return;
    const id = new URLSearchParams(window.location.search).get('deal');
    const deal = deals.find((item) => item.id === id);
    if (!deal) return;
    deepLinkedDealHandled.current = true;
    handleEditDeal(deal);
  }, [deals, handleEditDeal]);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t('toastNotLinkedToAccount'));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t('toastFailedCreatePipeline'));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from('pipeline_stages').insert(stagesPayload);

    setNewPipelineName('');
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t('toastPipelineCreated'));
  }

  async function saveReplySettings() {
    setSavingReplySettings(true);
    try {
      const response = await fetch('/api/pipelines/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replySettings),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Falha ao salvar.');
      setReplySettings(body.settings);
      toast.success('Tempos de atendimento atualizados.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao salvar configurações.'
      );
    } finally {
      setSavingReplySettings(false);
    }
  }

  async function createReplyReminder() {
    if (!reminderDeal?.contact_id) return;
    let remindAt: Date;
    if (reminderPreset === 'custom') {
      remindAt = new Date(customReminderAt);
      if (!customReminderAt || Number.isNaN(remindAt.getTime())) {
        toast.error('Escolha uma data e hora válidas.');
        return;
      }
    } else if (reminderPreset === 'tomorrow') {
      remindAt = new Date();
      remindAt.setDate(remindAt.getDate() + 1);
      remindAt.setHours(9, 0, 0, 0);
    } else {
      remindAt = new Date(Date.now() + Number(reminderPreset) * 60_000);
    }

    setSavingReminder(true);
    const contactName =
      reminderDeal.contact?.preferred_name ||
      reminderDeal.contact?.name ||
      reminderDeal.contact?.phone ||
      'contato';
    try {
      const response = await fetch('/api/contacts/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: reminderDeal.contact_id,
          title: `Responder ${contactName}`,
          remind_at: remindAt.toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error ?? 'Falha ao criar lembrete.');
      toast.success('Lembrete criado. O contato continua aguardando resposta.');
      setReminderDeal(null);
      setReminderPreset('60');
      setCustomReminderAt('');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar lembrete.'
      );
    } finally {
      setSavingReminder(false);
    }
  }

  const visibleDeals = useMemo(() => {
    const filtered = deals.filter((deal) => {
      const state = conversationState(deal);
      if (conversationFilter === 'awaiting') {
        return deal.conversation?.awaiting_reply === true;
      }
      if (conversationFilter === 'new') return state === 'new_message';
      if (conversationFilter === 'responded') return state === 'responded';
      if (conversationFilter === 'whatsapp') return Boolean(deal.conversation);
      if (conversationFilter === 'stale') {
        const elapsed = minutesSince(deal.conversation?.last_message_at, now);
        return elapsed === null || elapsed >= 7 * 24 * 60;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aLast = new Date(
        a.conversation?.last_message_at ?? a.updated_at ?? a.created_at
      ).getTime();
      const bLast = new Date(
        b.conversation?.last_message_at ?? b.updated_at ?? b.created_at
      ).getTime();
      if (conversationSort === 'recent' || conversationSort === 'interaction') {
        return bLast - aLast;
      }
      if (conversationSort === 'oldest') return aLast - bLast;

      const aWaiting = waitingMinutes(a, now);
      const bWaiting = waitingMinutes(b, now);
      if (conversationSort === 'waiting') {
        if (aWaiting === null && bWaiting === null) return bLast - aLast;
        if (aWaiting === null) return 1;
        if (bWaiting === null) return -1;
        return bWaiting - aWaiting;
      }

      // Priority: unanswered first, longest wait first, then latest activity.
      if (aWaiting === null && bWaiting !== null) return 1;
      if (aWaiting !== null && bWaiting === null) return -1;
      if (aWaiting !== null && bWaiting !== null && aWaiting !== bWaiting) {
        return bWaiting - aWaiting;
      }
      return bLast - aLast;
    });
  }, [conversationFilter, conversationSort, deals, now]);

  const awaitingDeals = deals.filter(
    (deal) => deal.conversation?.awaiting_reply
  );
  const oldestWaitingMinutes = awaitingDeals.reduce<number | null>(
    (oldest, deal) => {
      const value = waitingMinutes(deal, now);
      if (value === null) return oldest;
      return oldest === null ? value : Math.max(oldest, value);
    },
    null
  );

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="bg-muted h-8 w-48 animate-pulse rounded" />
          <div className="bg-muted h-9 w-28 animate-pulse rounded-lg" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="bg-muted/50 h-96 w-72 animate-pulse rounded-xl"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="border-border bg-card text-foreground hover:bg-muted data-[popup-open]:bg-muted inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors">
              <GitBranch className="text-primary h-4 w-4" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t('selectPipeline')}
              </span>
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover text-popover-foreground w-64"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t('noPipelinesYet')}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t('managePipelines')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('addPipeline')}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('addDeal')}
          </GatedButton>
        </div>
      </div>

      {pipelines.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setConversationFilter('awaiting')}
            className={
              awaitingDeals.length > 0
                ? 'w-full rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-left transition-colors hover:bg-red-500/10'
                : 'border-border bg-card w-full rounded-xl border px-4 py-3 text-left'
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground flex items-center gap-2 text-sm font-semibold">
                <BellRing
                  className={
                    awaitingDeals.length > 0
                      ? 'size-4 text-red-500'
                      : 'size-4 text-emerald-500'
                  }
                />
                {awaitingDeals.length > 0
                  ? `${awaitingDeals.length} contato${awaitingDeals.length > 1 ? 's' : ''} aguardando resposta`
                  : 'Nenhum cliente aguardando resposta'}
              </span>
              {oldestWaitingMinutes !== null && (
                <span className="text-sm font-medium text-red-600 dark:text-red-300">
                  Mais antigo: {compactElapsed(oldestWaitingMinutes)}
                </span>
              )}
            </div>
          </button>

          <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-1 inline-flex items-center gap-1 text-xs font-medium">
                <Filter className="size-3.5" /> Filtrar:
              </span>
              {(
                [
                  ['all', 'Todos'],
                  ['awaiting', 'Aguardando resposta'],
                  ['new', 'Novas mensagens'],
                  ['responded', 'Respondidos'],
                  ['stale', 'Sem interação recente'],
                  ['whatsapp', 'WhatsApp'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={conversationFilter === value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setConversationFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={conversationSort}
                onValueChange={(value) =>
                  setConversationSort((value ?? 'priority') as ConversationSort)
                }
              >
                <SelectTrigger className="h-9 w-52">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="priority">Priorizar respostas</SelectItem>
                  <SelectItem value="recent">Mais recentes</SelectItem>
                  <SelectItem value="oldest">Mais antigos</SelectItem>
                  <SelectItem value="interaction">Última interação</SelectItem>
                  <SelectItem value="waiting">
                    Mais tempo sem resposta
                  </SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                  <Settings className="size-4" /> Tempos de alerta
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-4">
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      Prioridade de atendimento
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Defina quando os cards mudam de nível visual.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Novo</Label>
                      <Input
                        type="number"
                        min={5}
                        value={replySettings.newMinutes}
                        disabled={!canEditSettings}
                        onChange={(event) =>
                          setReplySettings((current) => ({
                            ...current,
                            newMinutes: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Atenção</Label>
                      <Input
                        type="number"
                        min={10}
                        value={replySettings.attentionMinutes}
                        disabled={!canEditSettings}
                        onChange={(event) =>
                          setReplySettings((current) => ({
                            ...current,
                            attentionMinutes: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Atrasada</Label>
                      <Input
                        type="number"
                        min={15}
                        value={replySettings.overdueMinutes}
                        disabled={!canEditSettings}
                        onChange={(event) =>
                          setReplySettings((current) => ({
                            ...current,
                            overdueMinutes: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Valores em minutos. Padrão: 30, 120 e 360 minutos.
                  </p>
                  <label className="border-border flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span>
                      <span className="text-foreground block text-sm font-medium">
                        Notificações internas
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        Agrupa mensagens seguidas do mesmo contato.
                      </span>
                    </span>
                    <Switch
                      checked={replySettings.messageNotifications}
                      disabled={!canEditSettings}
                      onCheckedChange={(checked) =>
                        setReplySettings((current) => ({
                          ...current,
                          messageNotifications: checked,
                        }))
                      }
                    />
                  </label>
                  <GatedButton
                    canAct={canEditSettings}
                    gateReason="edit pipeline alert settings"
                    className="w-full"
                    disabled={savingReplySettings}
                    onClick={() => void saveReplySettings()}
                  >
                    <Save className="size-4" />
                    {savingReplySettings ? 'Salvando...' : 'Salvar tempos'}
                  </GatedButton>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      )}

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-20">
          <GitBranch className="text-muted-foreground h-12 w-12" />
          <h3 className="text-foreground mt-4 text-lg font-medium">
            {t('noPipelinesYet')}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('createToStartTracking')}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('createPipeline')}
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <PipelineBoard
            stages={stages}
            deals={visibleDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            onPreviewDeal={setPreviewDeal}
            onRemindDeal={(deal) => {
              setReminderPreset('60');
              setCustomReminderAt('');
              setReminderDeal(deal);
            }}
            settings={replySettings}
            now={now}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('newPipeline')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t('pipelineName')}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t('pipelineNamePlaceholder')}
              className="bg-muted border-border text-foreground mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePipeline();
              }}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {t('defaultStagesDesc')}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t('creating') : t('createPipelineBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />

      <ConversationPreview
        deal={previewDeal}
        open={previewDeal !== null}
        onOpenChange={(open) => !open && setPreviewDeal(null)}
      />

      <Dialog
        open={reminderDeal !== null}
        onOpenChange={(open) => !open && setReminderDeal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock3 className="text-primary size-5" /> Lembrar de responder
            </DialogTitle>
            <DialogDescription>
              O alerta de aguardando resposta continuará no card. O lembrete
              será adicionado às suas notificações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Quando lembrar?</Label>
            <Select
              value={reminderPreset}
              onValueChange={(value) => setReminderPreset(value ?? '60')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Em 30 minutos</SelectItem>
                <SelectItem value="60">Em 1 hora</SelectItem>
                <SelectItem value="180">Em 3 horas</SelectItem>
                <SelectItem value="tomorrow">Amanhã às 9h</SelectItem>
                <SelectItem value="custom">Escolher data e hora</SelectItem>
              </SelectContent>
            </Select>
            {reminderPreset === 'custom' && (
              <Input
                type="datetime-local"
                value={customReminderAt}
                onChange={(event) => setCustomReminderAt(event.target.value)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderDeal(null)}>
              Cancelar
            </Button>
            <Button
              disabled={savingReminder || !reminderDeal?.contact_id}
              onClick={() => void createReplyReminder()}
            >
              <BellRing className="size-4" />
              {savingReminder ? 'Criando...' : 'Criar lembrete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
