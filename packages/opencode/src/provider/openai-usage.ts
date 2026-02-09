import z from "zod"
import { Auth } from "@/auth"

const usageWindowSchema = z.object({
  used_percent: z.number(),
  limit_window_seconds: z.number(),
  reset_after_seconds: z.number(),
})

const usageSchema = z.object({
  plan_type: z.string(),
  rate_limit: z.object({
    limit_reached: z.boolean(),
    primary_window: usageWindowSchema,
    secondary_window: usageWindowSchema.nullable(),
  }),
})

type UsageWindow = z.infer<typeof usageWindowSchema>

export const OpenAIUsageViewSchema = z.object({
  limits: z.array(
    z.object({
      label: z.string().optional(),
      usedPercent: z.number(),
      resetAfterSeconds: z.number(),
    }),
  ),
})
export type OpenAIUsageView = z.infer<typeof OpenAIUsageViewSchema>

const OpenAIUsageMissingSchema = z.object({
  status: z.literal("missing"),
})

const OpenAIUsageErrorSchema = z.object({
  status: z.literal("error"),
  error: z.string(),
})

const OpenAIUsageSuccessSchema = z.object({
  status: z.literal("success"),
  data: OpenAIUsageViewSchema,
})

export const OpenAIUsageResultSchema = z.discriminatedUnion("status", [
  OpenAIUsageMissingSchema,
  OpenAIUsageErrorSchema,
  OpenAIUsageSuccessSchema,
])
export type OpenAIUsageResult = z.infer<typeof OpenAIUsageResultSchema>

const usageUrl = "https://chatgpt.com/backend-api/wham/usage"
const requestTimeoutMs = 10000

const formatWindowName = (seconds: number) => {
  const days = Math.round(seconds / 86400)
  if (days >= 1) return `${days}-day limit`
  return `${Math.round(seconds / 3600)}-hour limit`
}

const createWindowView = (window: UsageWindow) => {
  return {
    label: formatWindowName(window.limit_window_seconds),
    usedPercent: Math.round(window.used_percent),
    resetAfterSeconds: Math.max(0, Math.round(window.reset_after_seconds)),
  }
}

export const createOpenAIUsageView = (input: unknown): OpenAIUsageView | null => {
  const parsed = usageSchema.safeParse(input)
  if (!parsed.success) return null
  const data = parsed.data
  const limits = [createWindowView(data.rate_limit.primary_window)]
  if (data.rate_limit.secondary_window) {
    limits.push(createWindowView(data.rate_limit.secondary_window))
  }
  return {
    limits,
  }
}

const requestUsage = async (token: string) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  const response = await fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "OpenCode",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))

  if (!response.ok) {
    const text = await response.text()
    return { ok: false as const, error: `OpenAI usage request failed (${response.status}): ${text}` }
  }

  const data = await response.json()
  return { ok: true as const, data }
}

export const loadOpenAIUsage = async (): Promise<OpenAIUsageResult> => {
  const info = await Auth.get("openai")
  const parsed = Auth.Oauth.safeParse(info)
  if (!parsed.success) return { status: "missing" }
  if (parsed.data.expires < Date.now()) {
    return {
      status: "error",
      error: "OpenAI authorization expired. Use an OpenAI model to refresh it.",
    }
  }
  const result = await requestUsage(parsed.data.access).catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false as const, error: message }
  })
  if (!result.ok) return { status: "error", error: result.error }
  const view = createOpenAIUsageView(result.data)
  if (!view) return { status: "error", error: "OpenAI usage response invalid." }
  return { status: "success", data: view }
}
