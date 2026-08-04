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
