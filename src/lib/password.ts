import { z } from 'zod';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export const passwordSchema = z.string().min(PASSWORD_MIN, 'tooShort').max(PASSWORD_MAX, 'tooLong');

export const claimSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'mismatch' });

export type ClaimForm = z.infer<typeof claimSchema>;
