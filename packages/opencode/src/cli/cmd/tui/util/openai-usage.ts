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

export type UsageWindowView = {
  name: string
  usedPercent: number
  remainingPercent: number
  resetIn: string
}

export type OpenAIUsageView = {
  plan: string
  usedPercent: number
  limitReached: boolean
  windows: UsageWindowView[]
}

type UsageResult =
  | { status: "missing" }
  | { status: "error"; error: string }
  | { status: "success"; data: OpenAIUsageView }

const usageUrl = "https://chatgpt.com/backend-api/wham/usage"
const requestTimeoutMs = 10000

export const isOpenAIProvider = (providerID: string | undefined) => providerID === "openai"

const formatWindowName = (seconds: number) => {
  const days = Math.round(seconds / 86400)
  if (days >= 1) return `${days}-day limit`
  return `${Math.round(seconds / 3600)}-hour limit`
}

const formatDuration = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  return parts.join(" ")
}

const createWindowView = (window: UsageWindow): UsageWindowView => {
  const usedPercent = Math.round(window.used_percent)
  const remainingPercent = Math.max(0, Math.min(100, Math.round(100 - window.used_percent)))
  return {
    name: formatWindowName(window.limit_window_seconds),
    usedPercent,
    remainingPercent,
    resetIn: formatDuration(window.reset_after_seconds),
  }
}

export const createOpenAIUsageView = (input: unknown): OpenAIUsageView | null => {
  const parsed = usageSchema.safeParse(input)
  if (!parsed.success) return null
  const data = parsed.data
  const windows = [createWindowView(data.rate_limit.primary_window)]
  if (data.rate_limit.secondary_window) {
    windows.push(createWindowView(data.rate_limit.secondary_window))
  }
  const usedPercent = windows[0]?.usedPercent ?? 0
  return {
    plan: data.plan_type,
    usedPercent,
    limitReached: data.rate_limit.limit_reached,
    windows,
  }
}

const requestUsage = async (token: string) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  const response = await fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "OpenCode-TUI",
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

export const loadOpenAIUsage = async (): Promise<UsageResult> => {
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
