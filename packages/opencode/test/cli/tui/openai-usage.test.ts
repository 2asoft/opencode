import { describe, expect, test } from "bun:test"
import { createOpenAIUsageView, isOpenAIProvider } from "../../../src/cli/cmd/tui/util/openai-usage"

describe("openai usage view", () => {
  test("builds view from primary window", () => {
    const input = {
      plan_type: "team",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 15,
          limit_window_seconds: 10800,
          reset_after_seconds: 9000,
        },
        secondary_window: null,
      },
    }

    const result = createOpenAIUsageView(input)

    expect(result).not.toBeNull()
    expect(result?.plan).toBe("team")
    expect(result?.usedPercent).toBe(15)
    expect(result?.windows).toHaveLength(1)
    expect(result?.windows[0]?.name).toBe("3-hour limit")
    expect(result?.windows[0]?.usedPercent).toBe(15)
    expect(result?.windows[0]?.remainingPercent).toBe(85)
    expect(result?.windows[0]?.resetIn).toBe("2h 30m")
  })

  test("includes secondary window when present", () => {
    const input = {
      plan_type: "plus",
      rate_limit: {
        limit_reached: true,
        primary_window: {
          used_percent: 80,
          limit_window_seconds: 86400,
          reset_after_seconds: 3600,
        },
        secondary_window: {
          used_percent: 20,
          limit_window_seconds: 10800,
          reset_after_seconds: 1800,
        },
      },
    }

    const result = createOpenAIUsageView(input)

    expect(result).not.toBeNull()
    expect(result?.limitReached).toBe(true)
    expect(result?.windows).toHaveLength(2)
    expect(result?.windows[0]?.name).toBe("1-day limit")
    expect(result?.windows[1]?.name).toBe("3-hour limit")
  })

  test("detects openai provider", () => {
    expect(isOpenAIProvider("openai")).toBe(true)
    expect(isOpenAIProvider("anthropic")).toBe(false)
    expect(isOpenAIProvider(undefined)).toBe(false)
  })
})
