'use client';

import Link from 'next/link';
import { BellRing, CheckCircle2, Clock3, MoveRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAwaitingReplies } from '@/hooks/use-awaiting-replies';
import { compactElapsed } from '@/lib/pipelines/conversation-status';

export function AwaitingReplies() {
  const { count, oldestMinutes } = useAwaitingReplies();

  return (
    <section
      className={
        count > 0
          ? 'rounded-xl border border-red-500/25 bg-red-500/5 p-4'
          : 'border-border bg-card rounded-xl border p-4'
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={
              count > 0
                ? 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600'
                : 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600'
            }
          >
            {count > 0 ? (
              <BellRing className="size-5" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
          </div>
          <div>
            <h2 className="text-foreground text-sm font-semibold">
              Clientes aguardando resposta
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {count > 0
                ? `${count} contato${count > 1 ? 's' : ''} precisa${count > 1 ? 'm' : ''} de retorno`
                : 'Todas as conversas estão respondidas.'}
            </p>
            {oldestMinutes !== null && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-300">
                <Clock3 className="size-3.5" /> Mais antigo:{' '}
                {compactElapsed(oldestMinutes)}
              </p>
            )}
          </div>
        </div>
        {count > 0 && (
          <Button render={<Link href="/pipelines?view=awaiting" />}>
            Ver no Pipeline <MoveRight className="size-4" />
          </Button>
        )}
      </div>
    </section>
  );
}
