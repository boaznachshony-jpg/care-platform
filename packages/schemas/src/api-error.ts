import { z } from 'zod';

/**
 * The one error shape every apps/api response must use (Constitution §14) —
 * no bare 500s, no ad-hoc { error: string } objects.
 */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.array(z.string())).optional(),
  correlationId: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
