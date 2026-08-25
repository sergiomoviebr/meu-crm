'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cake, ChevronRight, Loader2, MessageCircle } from 'lucide-react';

import type { UpcomingContactBirthday } from '@/types';
import { Button } from '@/components/ui/button';

export function UpcomingBirthdays() {
  const router = useRouter();
  const [birthdays, setBirthdays] = useState<UpcomingContactBirthday[] | null>(
    null
  );

  const load = useCallback(async () => {
    const [, response] = await Promise.all([
      fetch('/api/contacts/birthdays', { method: 'POST' }),
      fetch('/api/contacts/birthdays?days=30'),
    ]);
    const body = await response.json().catch(() => ({}));
    setBirthdays(response.ok ? (body.birthdays ?? []) : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <section className="border-border bg-card rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 flex size-9 items-center justify-center rounded-lg">
            <Cake className="text-primary size-4" />
          </div>
          <div>
            <h2 className="text-foreground text-sm font-semibold">
              Próximos aniversários
            </h2>
            <p className="text-muted-foreground text-xs">
              Oportunidades de cuidar do relacionamento.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/contacts?birthday=30')}
        >
          Ver todos <ChevronRight className="size-4" />
        </Button>
      </div>

      {birthdays === null ? (
        <div className="flex h-28 items-center justify-center">
          <Loader2 className="text-primary size-5 animate-spin" />
        </div>
      ) : birthdays.length === 0 ? (
        <div className="border-border text-muted-foreground mt-4 rounded-lg border border-dashed px-4 py-7 text-center text-sm">
          Nenhum aniversário nos próximos 30 dias.
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {birthdays.slice(0, 6).map((birthday) => (
            <div
              key={birthday.id}
              className="border-border bg-muted/20 flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {String(birthday.birth_day).padStart(2, '0')}/
                {String(birthday.birth_month).padStart(2, '0')}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/contacts?contact=${birthday.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-foreground truncate text-sm font-medium">
                  {birthday.preferred_name || birthday.name || birthday.phone}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {birthday.days_until === 0
                    ? 'Hoje'
                    : birthday.days_until === 1
                      ? 'Amanhã'
                      : `Em ${birthday.days_until} dias`}
                  {birthday.company ? ` · ${birthday.company}` : ''}
                </p>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Abrir contato para enviar mensagem"
                onClick={() => router.push(`/contacts?contact=${birthday.id}`)}
              >
                <MessageCircle className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
