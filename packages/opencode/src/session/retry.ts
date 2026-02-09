import type { NamedError } from "@opencode-ai/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { Auth } from "@/auth"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      if (!error.data.isRetryable) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits https://opencode.ai/zen`
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    const json = iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          const parsed = JSON.parse(error.data.message)
          return parsed
        }

        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
    try {
      if (!json || typeof json !== "object") return undefined
      const code = typeof json.code === "string" ? json.code : ""

      if (json.type === "error" && json.error?.type === "too_many_requests") {
        return "Too Many Requests"
      }
      if (code.includes("exhausted") || code.includes("unavailable")) {
        return "Provider is overloaded"
      }
      if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
        return "Rate Limited"
      }
      return JSON.stringify(json)
    } catch {
      return undefined
    }
  }

  export function isOpenAIQuotaError(error: ReturnType<NamedError["toObject"]>) {
    if (!MessageV2.APIError.isInstance(error)) return false
    const code = iife(() => {
      if (!error.data.responseBody) return ""
      try {
        const body = JSON.parse(error.data.responseBody)
        if (typeof body?.code === "string") return body.code.toLowerCase()
        if (typeof body?.error?.code === "string") return body.error.code.toLowerCase()
      } catch {}
      return ""
    })
    if (code === "insufficient_quota") return true

    const text = [error.data.message, error.data.responseBody]
      .filter((x) => typeof x === "string")
      .join(" ")
      .toLowerCase()
    return ["insufficient_quota", "exceeded your current quota", "out of quota", "quota exceeded"].some((x) =>
      text.includes(x),
    )
  }

  export async function handleQuota(input: {
    providerID: string
    error: ReturnType<NamedError["toObject"]>
    quotaTried?: Set<string>
  }) {
    if (input.providerID !== "openai") return "ignored" as const
    const statusCode = MessageV2.APIError.isInstance(input.error) ? input.error.data.statusCode : undefined
    const shouldRotate = isOpenAIQuotaError(input.error) || statusCode === 429 || statusCode === 403
    if (!shouldRotate) return "ignored" as const

    const next = await Auth.rotateOpenAIFromQuota(input.quotaTried)
    if (next === "rotated") return "rotated" as const
    return "exhausted" as const
  }
}
