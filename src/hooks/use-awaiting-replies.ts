'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { Conversation } from '@/types';

export function useAwaitingReplies(): {
  count: number;
  oldestMinutes: number | null;
} {
  const [waiting, setWaiting] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const channelId = useId();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void supabase
      .from('conversations')
      .select('id, awaiting_reply, waiting_since')
      .eq('awaiting_reply', true)
      .then(({ data }) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const row of data ?? []) {
          if (row.waiting_since) next.set(row.id, row.waiting_since);
        }
        setWaiting(next);
      });

    const channel = supabase
      .channel(`awaiting-replies-realtime-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          setWaiting((current) => {
            const next = new Map(current);
            if (payload.eventType === 'DELETE') {
              const old = payload.old as Partial<Conversation>;
              if (old.id) next.delete(old.id);
            } else {
              const row = payload.new as Conversation;
              if (row.awaiting_reply && row.waiting_since) {
                next.set(row.id, row.waiting_since);
              } else {
                next.delete(row.id);
              }
            }
            return next;
          });
        }
      )
      .subscribe();
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  return useMemo(() => {
    let oldestMinutes: number | null = null;
    for (const since of waiting.values()) {
      const minutes = Math.max(
        0,
        Math.floor((now - new Date(since).getTime()) / 60_000)
      );
      oldestMinutes =
        oldestMinutes === null ? minutes : Math.max(oldestMinutes, minutes);
    }
    return { count: waiting.size, oldestMinutes };
  }, [now, waiting]);
}
