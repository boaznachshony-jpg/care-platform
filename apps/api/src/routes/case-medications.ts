import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthorizationError } from '@caredesk/application';
import type { Medication } from '@caredesk/domain';
import {
  createMedicationRequestSchema,
  updateMedicationRequestSchema,
  importMedicationRequestSchema,
  type MedicationResponse,
} from '@caredesk/schemas';
import type { Container } from '../container.js';
import { makeAuthenticate } from '../plugins/authenticate.js';
import { sendError, sendValidationError } from './http-errors.js';

interface CaseParams {
  caseId: string;
}

interface MedicationParams extends CaseParams {
  medicationId: string;
}

const medicationParamsSchema = z.object({
  caseId: z.string().uuid(),
  medicationId: z.string().uuid(),
});

function toResponse(medication: Medication): MedicationResponse {
  return {
    id: medication.id,
    name: medication.name,
    dosage: medication.dosage,
    timesOfDay: medication.timesOfDay,
    daily: medication.daily,
    daysOfWeek: medication.daysOfWeek,
    prescribingDoctor: medication.prescribingDoctor,
    notes: medication.notes,
    status: medication.status,
    legacyLocalId: medication.legacyLocalId,
  };
}

/**
 * The one genuinely new server-side domain in this round: medications had no
 * canonical table before migration 0046 and existed only in
 * `caredesk.mvp.medications.v1`. Every route here is authenticated,
 * tenant-scoped through `withTenant`, and goes through the deny-by-default
 * `medication:*` permission check in each use case — never a client-side gate.
 */
export function registerCaseMedicationRoutes(app: FastifyInstance, container: Container): void {
  const authenticate = makeAuthenticate(container.auth, container.actorResolver);
  const options = { preHandler: authenticate };

  app.get<{ Params: CaseParams }>('/cases/:caseId/medications', options, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return;
    try {
      const medications = await container.listMedications.execute(actor, request.params.caseId);
      reply.send(medications.map(toResponse));
    } catch (error) {
      if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
      throw error;
    }
  });

  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/medications',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = createMedicationRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      try {
        const created = await container.createMedication.execute(actor, request.params.caseId, {
          ...parsed.data,
          daysOfWeek: parsed.data.daysOfWeek ?? null,
        });
        reply.status(201).send(toResponse(created));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  /** Idempotent import for the UI cutover — see ImportMedication. */
  app.post<{ Params: CaseParams }>(
    '/cases/:caseId/medications/import',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const parsed = importMedicationRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(request, reply, parsed.error);
      try {
        const imported = await container.importMedication.execute(actor, request.params.caseId, {
          ...parsed.data,
          daysOfWeek: parsed.data.daysOfWeek ?? null,
        });
        reply.status(200).send(toResponse(imported));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  app.patch<{ Params: MedicationParams }>(
    '/cases/:caseId/medications/:medicationId',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = medicationParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      const body = updateMedicationRequestSchema.safeParse(request.body);
      if (!body.success) return sendValidationError(request, reply, body.error);
      try {
        const updated = await container.updateMedication.execute(
          actor,
          params.data.caseId,
          params.data.medicationId,
          body.data,
        );
        if (!updated) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(toResponse(updated));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );

  /** Soft-close (status -> 'archived'). There is no delete route — see database/migrations/0046. */
  app.post<{ Params: MedicationParams }>(
    '/cases/:caseId/medications/:medicationId/archive',
    options,
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) return;
      const params = medicationParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(request, reply, params.error);
      try {
        const archived = await container.archiveMedication.execute(
          actor,
          params.data.caseId,
          params.data.medicationId,
        );
        if (!archived) return sendError(request, reply, 404, 'NOT_FOUND');
        reply.send(toResponse(archived));
      } catch (error) {
        if (error instanceof AuthorizationError) return sendError(request, reply, 403, 'FORBIDDEN');
        throw error;
      }
    },
  );
}
