import { z } from "zod";

import {
  failJobRequestSchema,
  getTaskResponseSchema,
  heartbeatRequestSchema,
  requestJobRequestSchema,
  requestJobResponseSchema,
  submitResultRequestSchema,
  submitResultResponseSchema,
  syncFindingsRequestSchema,
  workflowResponseSchema
} from "./cloud-api";
import { languagePackManifestSchema, localeIdSchema } from "./language-pack";
import {
  projectAddRequestSchema,
  projectAddResponseSchema,
  projectListResponseSchema,
  projectOpenRequestSchema,
  projectRemoveRequestSchema,
  projectSchema
} from "./project";
import { providerDetectionResultSchema, providerIdSchema } from "./provider";

export const appPingRequestSchema = z.object({}).strict();

export const appPingResponseSchema = z
  .object({
    ok: z.literal(true),
    appName: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    timestamp: z.string().datetime()
  })
  .strict();

export type AppPingRequest = z.infer<typeof appPingRequestSchema>;
export type AppPingResponse = z.infer<typeof appPingResponseSchema>;

export const ipcSchemaMap = {
  app: {
    ping: {
      request: appPingRequestSchema,
      response: appPingResponseSchema
    }
  },
  projects: {
    list: {
      request: z.object({}).strict(),
      response: projectListResponseSchema
    },
    add: {
      request: projectAddRequestSchema,
      response: projectAddResponseSchema
    },
    remove: {
      request: projectRemoveRequestSchema,
      response: z.object({ removed: z.boolean() }).strict()
    },
    open: {
      request: projectOpenRequestSchema,
      response: projectSchema
    }
  },
  providers: {
    list: {
      request: z.object({}).strict(),
      response: z.array(providerDetectionResultSchema)
    },
    detect: {
      request: z.object({ providerId: providerIdSchema }).strict(),
      response: providerDetectionResultSchema
    },
    refresh: {
      request: z.object({}).strict(),
      response: z.array(providerDetectionResultSchema)
    }
  },
  jobs: {
    request: {
      request: requestJobRequestSchema,
      response: requestJobResponseSchema
    },
    get: {
      request: z.object({ jobId: z.string().uuid() }).strict(),
      response: getTaskResponseSchema
    },
    workflow: {
      request: z.object({ projectId: z.string().uuid() }).strict(),
      response: workflowResponseSchema
    },
    heartbeat: {
      request: heartbeatRequestSchema,
      response: z.object({ accepted: z.literal(true) }).strict()
    },
    submitResult: {
      request: submitResultRequestSchema,
      response: submitResultResponseSchema
    },
    fail: {
      request: failJobRequestSchema,
      response: z.object({ accepted: z.literal(true) }).strict()
    },
    syncFindings: {
      request: syncFindingsRequestSchema,
      response: z.object({ accepted: z.literal(true) }).strict()
    }
  },
  localization: {
    getActiveLocale: {
      request: z.object({}).strict(),
      response: z.object({ locale: localeIdSchema }).strict()
    },
    listLanguagePacks: {
      request: z.object({}).strict(),
      response: z.array(languagePackManifestSchema)
    },
    installLanguagePack: {
      request: z.object({ packagePath: z.string().min(1) }).strict(),
      response: languagePackManifestSchema
    },
    setActiveLocale: {
      request: z.object({ locale: localeIdSchema }).strict(),
      response: z.object({ locale: localeIdSchema }).strict()
    }
  },
  logs: {
    list: {
      request: z.object({ limit: z.number().int().positive().max(1000).default(200) }).strict(),
      response: z.array(
        z.object({ timestamp: z.string().datetime(), message: z.string() }).strict()
      )
    }
  }
} as const;
