import z from "zod"
import { loadOpenAIUsage } from "./openai-usage"

export const ProviderUsageDataSchema = z.object({
  limits: z.array(
    z.object({
      label: z.string().optional(),
      usedPercent: z.number(),
      resetAfterSeconds: z.number(),
    }),
  ),
})

const ProviderUsageMissingSchema = z.object({
  status: z.literal("missing"),
})

const ProviderUsageUnsupportedSchema = z.object({
  status: z.literal("unsupported"),
})

const ProviderUsageErrorSchema = z.object({
  status: z.literal("error"),
  error: z.string(),
})

const ProviderUsageSuccessSchema = z.object({
  status: z.literal("success"),
  data: ProviderUsageDataSchema,
})

export const ProviderUsageResultSchema = z.discriminatedUnion("status", [
  ProviderUsageMissingSchema,
  ProviderUsageUnsupportedSchema,
  ProviderUsageErrorSchema,
  ProviderUsageSuccessSchema,
])
export type ProviderUsageResult = z.infer<typeof ProviderUsageResultSchema>

export async function loadProviderUsage(providerID: string): Promise<ProviderUsageResult> {
  if (providerID !== "openai") {
    return {
      status: "unsupported",
    }
  }

  const usage = await loadOpenAIUsage()
  const parsed = ProviderUsageResultSchema.safeParse(usage)
  if (!parsed.success) {
    return {
      status: "error",
      error: "OpenAI usage response invalid.",
    }
  }
  return parsed.data
}
