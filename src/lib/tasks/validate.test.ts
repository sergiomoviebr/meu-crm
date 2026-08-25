import { describe, expect, it } from 'vitest';
import { salesTaskInputSchema, salesTaskPatchSchema } from './validate';

const valid = {
  title: 'Ligar para o cliente', task_type: 'call' as const,
  status: 'todo' as const, priority: 'high' as const,
  assigned_to: '11111111-1111-4111-8111-111111111111',
};

describe('salesTaskInputSchema', () => {
  it('accepts a valid task', () => expect(salesTaskInputSchema.safeParse(valid).success).toBe(true));
  it('rejects blank titles', () => expect(salesTaskInputSchema.safeParse({ ...valid, title: ' ' }).success).toBe(false));
  it('rejects invalid references', () => expect(salesTaskInputSchema.safeParse({ ...valid, contact_id: 'nope' }).success).toBe(false));
  it('requires a field in patches', () => expect(salesTaskPatchSchema.safeParse({}).success).toBe(false));
});
