import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const staleContacts = new Date(now.getTime() - 10 * 86400000).toISOString();
    const staleDeals = new Date(now.getTime() - 7 * 86400000).toISOString();
    const [awaiting, overdueTasks, todayTasks, failedMessages, newLeads, staleContactRows, staleDealRows, birthdays] = await Promise.all([
      ctx.supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).eq('awaiting_reply', true),
      ctx.supabase.from('sales_tasks').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).eq('assigned_to', ctx.userId).in('status', ['todo', 'in_progress']).lt('due_at', now.toISOString()),
      ctx.supabase.from('sales_tasks').select('id,title,task_type,status,priority,due_at,contact_id').eq('account_id', ctx.accountId).eq('assigned_to', ctx.userId).in('status', ['todo', 'in_progress']).gte('due_at', dayStart.toISOString()).lte('due_at', dayEnd.toISOString()).order('due_at'),
      ctx.supabase.from('messages').select('id, conversations!inner(account_id)', { count: 'exact', head: true }).eq('conversations.account_id', ctx.accountId).eq('status', 'failed').gte('created_at', new Date(now.getTime() - 7 * 86400000).toISOString()),
      ctx.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).is('deleted_at', null).gte('created_at', dayStart.toISOString()),
      ctx.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).is('deleted_at', null).lt('last_contact_at', staleContacts),
      ctx.supabase.from('deals').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).eq('status', 'open').lt('updated_at', staleDeals),
      ctx.supabase.rpc('get_upcoming_contact_birthdays', { p_account_id: ctx.accountId, p_days: 0, p_from: dayStart.toISOString().slice(0, 10) }),
    ]);
    return NextResponse.json({
      counts: { awaiting: awaiting.count ?? 0, overdueTasks: overdueTasks.count ?? 0, failedMessages: failedMessages.count ?? 0, newLeads: newLeads.count ?? 0, staleContacts: staleContactRows.count ?? 0, staleDeals: staleDealRows.count ?? 0, birthdays: birthdays.data?.length ?? 0, todayTasks: todayTasks.data?.length ?? 0 },
      today: todayTasks.data ?? [],
    });
  } catch (error) { return toErrorResponse(error); }
}
