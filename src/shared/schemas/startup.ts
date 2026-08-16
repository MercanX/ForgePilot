import { z } from "zod";

export const startupScopeConfidenceSchema = z.enum(["high", "medium", "low"]);

export const startupScopeProposalEntrySchema = z
  .object({
    confidence: startupScopeConfidenceSchema,
    path: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

export const startupScopeProposalSchema = z
  .object({
    exclude: z.array(startupScopeProposalEntrySchema),
    include: z.array(startupScopeProposalEntrySchema),
    needs_user_decision: z.array(startupScopeProposalEntrySchema),
    summary: z.string().min(1)
  })
  .strict();

export const startupApprovedScopeSchema = z
  .object({
    exclude: z.array(z.string()),
    explicit_files: z.array(z.string()),
    include: z.array(z.string())
  })
  .strict();

export const startupScopeDocumentSchema = z
  .object({
    approved: startupApprovedScopeSchema.nullable(),
    approved_at: z.string().datetime().nullable(),
    project_root_id: z.string().min(1),
    proposal: startupScopeProposalSchema,
    proposal_created_at: z.string().datetime(),
    schema_version: z.literal("1.0"),
    scope_hash: z.string().min(1).nullable(),
    status: z.enum(["pending_approval", "approved"])
  })
  .strict();

export const startupManifestFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative()
  })
  .strict();

export const startupWorkspaceManifestSchema = z
  .object({
    created_at: z.string().datetime(),
    file_count: z.number().int().nonnegative(),
    files: z.array(startupManifestFileSchema),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    schema_version: z.literal("1.0"),
    scope_hash: z.string().min(1),
    workspace_hash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export const startupSealSchema = z
  .object({
    file_count: z.number().int().nonnegative(),
    manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    schema_version: z.literal("1.0"),
    scope_hash: z.string().min(1),
    sealed_at: z.string().datetime(),
    status: z.literal("READY_FOR_DISCOVERY"),
    workspace_hash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export const startupStateSchema = z
  .object({
    manifest: startupWorkspaceManifestSchema.nullable(),
    scope: startupScopeDocumentSchema.nullable(),
    seal: startupSealSchema.nullable()
  })
  .strict();

export type StartupApprovedScope = z.infer<typeof startupApprovedScopeSchema>;
export type StartupScopeDocument = z.infer<typeof startupScopeDocumentSchema>;
export type StartupScopeProposal = z.infer<typeof startupScopeProposalSchema>;
export type StartupScopeProposalEntry = z.infer<typeof startupScopeProposalEntrySchema>;
export type StartupSeal = z.infer<typeof startupSealSchema>;
export type StartupState = z.infer<typeof startupStateSchema>;
export type StartupWorkspaceManifest = z.infer<typeof startupWorkspaceManifestSchema>;
