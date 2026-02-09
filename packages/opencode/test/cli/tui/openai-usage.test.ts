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
    expect(result?.limits).toHaveLength(1)
    expect(result?.limits[0]?.label).toBe("3-hour limit")
    expect(result?.limits[0]?.usedPercent).toBe(15)
    expect(result?.limits[0]?.resetAfterSeconds).toBe(9000)
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
    expect(result?.limits).toHaveLength(2)
    expect(result?.limits[0]?.label).toBe("1-day limit")
    expect(result?.limits[1]?.label).toBe("3-hour limit")
  })

  test("detects openai provider", () => {
    expect(isOpenAIProvider("openai")).toBe(true)
    expect(isOpenAIProvider("anthropic")).toBe(false)
    expect(isOpenAIProvider(undefined)).toBe(false)
  })
})
