import { z } from 'zod';

const MVP_KEY_PREFIX = 'caredesk.mvp.';
const MAX_ENTRY_LENGTH = 1_000_000;

export const workspaceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(z.string().startsWith(MVP_KEY_PREFIX), z.string().max(MAX_ENTRY_LENGTH)),
});

export const saveWorkspaceRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  snapshot: workspaceSnapshotSchema,
  /**
   * Opt-in permission to replace a populated workspace with a near-empty one.
   * Absent by default, so a save that lost its content by accident is rejected
   * by the server rather than committed. Only an explicit, confirmed deletion
   * in the UI sets it.
   */
  allowShrink: z.boolean().optional(),
});

export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type SaveWorkspaceRequest = z.infer<typeof saveWorkspaceRequestSchema>;

export interface WorkspaceResponse {
  version: number;
  snapshot: WorkspaceSnapshot;
  updatedAt: string;
}

export const MAX_WORKSPACE_FILE_BYTES = 10_000_000;
const MAX_WORKSPACE_FILE_BASE64 = Math.ceil(MAX_WORKSPACE_FILE_BYTES / 3) * 4;
export const uploadWorkspaceFileRequestSchema = z.object({
  mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  content: z.string().min(1).max(MAX_WORKSPACE_FILE_BASE64),
});

export type UploadWorkspaceFileRequest = z.infer<typeof uploadWorkspaceFileRequestSchema>;

export interface WorkspaceFileUrlResponse {
  url: string;
  expiresInSeconds: number;
}

/**
 * Per-tenant restore (DR-02). The version is named twice on purpose: once in
 * the path and once in the body. A restore is the only write in the product
 * that deliberately replaces current data with older data, and a client that
 * built the request from a stale version list cannot satisfy both.
 */
export const restoreWorkspaceVersionRequestSchema = z.object({
  confirmVersion: z.number().int().positive(),
});

export type RestoreWorkspaceVersionRequest = z.infer<typeof restoreWorkspaceVersionRequestSchema>;

/**
 * Metadata only. The list is rendered in a browser by somebody who thinks data
 * is missing; shipping twenty versions of their workspace to draw it would
 * widen the exposure of the recovery screen well beyond the recovery itself.
 * `populatedEntries` is null when the archived version does not decrypt under
 * the current key.
 */
export interface WorkspaceVersionSummaryResponse {
  version: number;
  schemaVersion: number;
  updatedAt: string;
  archivedAt: string;
  populatedEntries: number | null;
  payloadBytes: number;
}

export interface WorkspaceVersionListResponse {
  versions: WorkspaceVersionSummaryResponse[];
}
