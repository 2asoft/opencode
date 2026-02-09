import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { loadProviderUsage } from "../../src/provider/usage"
import * as OpenAIUsage from "../../src/provider/openai-usage"

describe("provider usage", () => {
  let usageSpy: any

  afterEach(() => {
    usageSpy?.mockRestore()
  })

  test("returns unsupported for providers without usage implementation", async () => {
    const result = await loadProviderUsage("anthropic")
    expect(result).toEqual({ status: "unsupported" })
  })

  test("delegates openai provider usage to openai implementation", async () => {
    usageSpy = spyOn(OpenAIUsage, "loadOpenAIUsage").mockResolvedValueOnce({
      status: "success",
      data: {
        limits: [
          {
            usedPercent: 25,
            resetAfterSeconds: 1800,
            label: "3-hour limit",
          },
        ],
      },
    })

    const result = await loadProviderUsage("openai")
    expect(result.status).toBe("success")
    expect(usageSpy).toHaveBeenCalledTimes(1)
  })
})
