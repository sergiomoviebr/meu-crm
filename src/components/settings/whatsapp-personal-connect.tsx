'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  QrCode,
  Smartphone,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import type {
  WhatsAppPersonalHistorySyncStatus,
  WhatsAppPersonalStatus,
} from '@/types';

interface PersonalConnection {
  id: string;
  label: string | null;
  isDefault: boolean;
  clientContactId: string | null;
  status: WhatsAppPersonalStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  historySyncStatus: WhatsAppPersonalHistorySyncStatus;
  historySyncProgress: number;
  historySyncChats: number;
  historySyncMessages: number;
  historySyncError: string | null;
}

interface TrafficClient {
  id: string;
  name: string | null;
  phone: string | null;
}

// Radix Select can't use an empty-string item value, so "no client
// linked" gets a sentinel that maps to null in the payload.
const NO_CLIENT = '__none__';

const POLL_MS = 2500;
const POLLING_STATUSES: WhatsAppPersonalStatus[] = ['connecting', 'qr_pending'];

export function WhatsAppPersonalConnect() {
  const t = useTranslations('Settings.whatsappPersonal');
  const canManage = useCan('manage-whatsapp-personal');
  const [connections, setConnections] = useState<PersonalConnection[]>([]);
  const [clients, setClients] = useState<TrafficClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/whatsapp-personal/status');
    if (!res.ok) return;
    const data = (await res.json()) as {
      connections?: PersonalConnection[];
      clients?: TrafficClient[];
    };
    setConnections(data.connections ?? []);
    setClients(data.clients ?? []);
    setLoading(false);
    return data.connections ?? [];
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const shouldPoll = connections.some(
      (item) =>
        POLLING_STATUSES.includes(item.status) ||
        item.historySyncStatus === 'pending' ||
        item.historySyncStatus === 'syncing'
    );
    if (!shouldPoll) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void fetchStatus(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [connections, fetchStatus]);

  async function handleConnect(connectionId?: string, forceNewQr = false) {
    setBusyId(connectionId ?? 'new');
    try {
      const res = await fetch('/api/whatsapp-personal/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionId ? { connectionId, forceNewQr } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t('toasts.connectFailed'));
        return;
      }
      await fetchStatus();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(connectionId: string) {
    setBusyId(connectionId);
    try {
      const res = await fetch('/api/whatsapp-personal/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t('toasts.disconnectFailed'));
        return;
      }
      toast.success(t('toasts.disconnected'));
      await fetchStatus();
    } finally {
      setBusyId(null);
    }
  }

  async function handleLinkClient(connectionId: string, contactId: string | null) {
    setBusyId(connectionId);
    try {
      const res = await fetch('/api/whatsapp-personal/link-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, contactId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t('toasts.clientLinkFailed'));
        return;
      }
      toast.success(t('toasts.clientLinked'));
      await fetchStatus();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(connectionId: string) {
    setBusyId(connectionId);
    try {
      const res = await fetch('/api/whatsapp-personal/disconnect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t('toasts.removeFailed'));
        return;
      }
      toast.success(t('toasts.removed'));
      await fetchStatus();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('multiDescription')}
      />

      <Alert variant="destructive" className="mb-5">
        <AlertTriangle />
        <AlertTitle>{t('riskTitle')}</AlertTitle>
        <AlertDescription>{t('riskDescription')}</AlertDescription>
      </Alert>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t('connectionsTitle')}</h3>
          <p className="text-muted-foreground text-sm">
            {t('connectionsDescription')}
          </p>
        </div>
        <GatedButton
          canAct={canManage}
          gateReason={t('gateReason')}
          onClick={() => void handleConnect()}
          disabled={busyId !== null}
        >
          {busyId === 'new' ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('addConnection')}
        </GatedButton>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex justify-center py-12">
            <Loader2 className="text-muted-foreground animate-spin" />
          </CardContent>
        </Card>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <Smartphone className="text-muted-foreground h-10 w-10" />
            <div>
              <p className="font-medium">{t('emptyTitle')}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('emptyDescription')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              clients={clients}
              busy={busyId === connection.id}
              canManage={canManage}
              gateReason={t('gateReason')}
              onConnect={() => void handleConnect(connection.id)}
              onReset={() => void handleConnect(connection.id, true)}
              onDisconnect={() => void handleDisconnect(connection.id)}
              onRemove={() => void handleRemove(connection.id)}
              onLinkClient={(contactId) => void handleLinkClient(connection.id, contactId)}
              labels={{
                clientLabel: t('clientLabel'),
                clientPlaceholder: t('clientPlaceholder'),
                clientHint: t('clientHint'),
                default: t('defaultBadge'),
                connected: t('connectedTitle'),
                disconnected: t('disconnectedTitle'),
                connecting: t('connecting'),
                connect: t('connect'),
                disconnect: t('disconnect'),
                remove: t('remove'),
                newQr: t('newQr'),
                scanHint: t('scanHint'),
                qrAlt: t('qrAlt'),
                importHistory: t('importHistory'),
                historyNeedsReconnect: t('historyNeedsReconnect'),
                historyPending: t('historyPending'),
                historySyncing: t('historySyncing'),
                historyCompleted: t('historyCompleted', {
                  chats: connection.historySyncChats,
                  messages: connection.historySyncMessages,
                }),
                historyPaused: t('historyPaused'),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({
  connection,
  clients,
  busy,
  canManage,
  gateReason,
  onConnect,
  onReset,
  onDisconnect,
  onRemove,
  onLinkClient,
  labels,
}: {
  connection: PersonalConnection;
  clients: TrafficClient[];
  busy: boolean;
  canManage: boolean;
  gateReason: string;
  onConnect: () => void;
  onReset: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onLinkClient: (contactId: string | null) => void;
  labels: Record<
    | 'default'
    | 'connected'
    | 'disconnected'
    | 'connecting'
    | 'connect'
    | 'disconnect'
    | 'remove'
    | 'newQr'
    | 'scanHint'
    | 'qrAlt'
    | 'importHistory'
    | 'historyNeedsReconnect'
    | 'historyPending'
    | 'historySyncing'
    | 'historyCompleted'
    | 'historyPaused'
    | 'clientLabel'
    | 'clientPlaceholder'
    | 'clientHint',
    string
  >;
}) {
  const status = connection.status;
  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`rounded-xl p-2.5 ${status === 'connected' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}
            >
              {status === 'connected' ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Smartphone className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold">
                  {connection.label || 'WhatsApp'}
                </p>
                {connection.isDefault ? (
                  <Badge variant="secondary">{labels.default}</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {connection.phoneNumber ||
                  (status === 'connected'
                    ? labels.connected
                    : labels.disconnected)}
              </p>
            </div>
          </div>
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground/40'}`}
          />
        </div>

        {clients.length > 0 ? (
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs font-medium">
              {labels.clientLabel}
            </label>
            <Select
              value={connection.clientContactId ?? NO_CLIENT}
              onValueChange={(value) =>
                onLinkClient(value === NO_CLIENT ? null : value)
              }
              disabled={!canManage || busy}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={labels.clientPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>
                  {labels.clientPlaceholder}
                </SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name || client.phone || client.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{labels.clientHint}</p>
          </div>
        ) : null}

        {status === 'qr_pending' && connection.qrDataUrl ? (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img
              src={connection.qrDataUrl}
              alt={labels.qrAlt}
              width={220}
              height={220}
            />
            <p className="max-w-[40ch] text-xs text-slate-600">
              {labels.scanHint}
            </p>
          </div>
        ) : null}

        {status === 'connecting' ? (
          <div className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {labels.connecting}
          </div>
        ) : null}

        {status === 'error' && connection.lastError ? (
          <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
            {connection.lastError}
          </p>
        ) : null}

        {status === 'connected' ? (
          <div className="bg-muted/40 space-y-2 rounded-lg border px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              {connection.historySyncStatus === 'completed'
                ? labels.historyCompleted
                : connection.historySyncStatus === 'syncing'
                  ? labels.historySyncing
                  : connection.historySyncStatus === 'pending'
                    ? labels.historyPending
                    : connection.historySyncStatus === 'paused'
                      ? labels.historyPaused
                      : labels.historyNeedsReconnect}
            </div>
            {connection.historySyncStatus === 'syncing' ||
            connection.historySyncStatus === 'pending' ? (
              <div
                className="bg-muted h-2 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={connection.historySyncProgress}
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width]"
                  style={{
                    width: `${Math.max(4, connection.historySyncProgress)}%`,
                  }}
                />
              </div>
            ) : null}
            {connection.historySyncError ? (
              <p className="text-destructive text-xs">
                {connection.historySyncError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {status === 'connected' ||
          status === 'connecting' ||
          status === 'qr_pending' ? (
            <GatedButton
              canAct={canManage}
              gateReason={gateReason}
              variant="outline"
              onClick={onDisconnect}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Unplug />}
              {labels.disconnect}
            </GatedButton>
          ) : (
            <GatedButton
              canAct={canManage}
              gateReason={gateReason}
              onClick={onConnect}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
              {labels.connect}
            </GatedButton>
          )}
          {status === 'error' || status === 'disconnected' ? (
            <GatedButton
              canAct={canManage}
              gateReason={gateReason}
              variant="outline"
              onClick={onReset}
              disabled={busy}
            >
              <QrCode />
              {labels.newQr}
            </GatedButton>
          ) : null}
          {status === 'connected' &&
          ['idle', 'paused', 'error'].includes(connection.historySyncStatus) ? (
            <GatedButton
              canAct={canManage}
              gateReason={gateReason}
              variant="outline"
              onClick={onReset}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <History />}
              {labels.importHistory}
            </GatedButton>
          ) : null}
          {status === 'disconnected' && !connection.isDefault ? (
            <GatedButton
              canAct={canManage}
              gateReason={gateReason}
              variant="ghost"
              onClick={onRemove}
              disabled={busy}
            >
              <Trash2 />
              {labels.remove}
            </GatedButton>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
