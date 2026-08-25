import { z } from 'zod';

const optionalUuid = z.union([z.string().uuid(), z.null()]).optional();

export const salesTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000).nullable().optional(),
  task_type: z.enum(['task', 'call', 'meeting', 'follow_up']),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  contact_id: optionalUuid,
  deal_id: optionalUuid,
  assigned_to: z.string().uuid(),
});

export const salesTaskPatchSchema = salesTaskInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required.'
);
