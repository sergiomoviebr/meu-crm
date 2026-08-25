import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';

function authorized(request: Request): boolean {
  const expected = process.env.CONTACTS_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!process.env.CONTACTS_CRON_SECRET) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: members, error } = await admin
    .from('profiles')
    .select('user_id, account_id')
    .not('account_id', 'is', null);
  if (error)
    return NextResponse.json(
      { error: 'Failed to load members' },
      { status: 500 }
    );

  let birthdays = 0;
  for (const member of members ?? []) {
    const result = await admin.rpc('create_contact_birthday_notifications', {
      p_account_id: member.account_id,
      p_user_id: member.user_id,
    });
    if (!result.error) birthdays += Number(result.data ?? 0);
  }
  const reminders = await admin.rpc(
    'create_due_contact_reminder_notifications'
  );
  if (reminders.error) {
    return NextResponse.json(
      { error: 'Failed to process reminders' },
      { status: 500 }
    );
  }
  const overdue = await admin.rpc('create_overdue_conversation_notifications');
  if (overdue.error) {
    return NextResponse.json(
      { error: 'Failed to process overdue conversations' },
      { status: 500 }
    );
  }
  return NextResponse.json({
    birthdayNotifications: birthdays,
    reminders: Number(reminders.data ?? 0),
    overdueConversations: Number(overdue.data ?? 0),
  });
}
