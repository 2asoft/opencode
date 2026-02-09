import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

const authPath = path.join(Global.Path.data, "auth.json")

const readRaw = async () => JSON.parse(await Bun.file(authPath).text())

let backup = ""
let hadFile = false

beforeAll(async () => {
  const file = Bun.file(authPath)
  hadFile = await file.exists()
  if (hadFile) {
    backup = await file.text()
  }
})

beforeEach(async () => {
  await Bun.write(
    authPath,
    JSON.stringify(
      {
        providers: {},
        openai_oauth_accounts: {},
      },
      null,
      2,
    ),
  )
})

afterAll(async () => {
  if (hadFile) {
    await Bun.write(authPath, backup)
    return
  }
  await unlink(authPath).catch(() => {})
})

describe("auth openai oauth accounts", () => {
  test("Auth.all treats missing root containers as empty values", async () => {
    await Bun.write(
      authPath,
      JSON.stringify({
        openai: {
          type: "api",
          key: "legacy",
        },
      }),
    )

    await expect(Auth.all()).resolves.toEqual({})
  })

  test("Auth.all works when providers key is missing", async () => {
    await Bun.write(
      authPath,
      JSON.stringify({
        openai_oauth_accounts: {},
      }),
    )

    await expect(Auth.all()).resolves.toEqual({})
  })

  test("Auth.all works when openai_oauth_accounts key is missing", async () => {
    await Bun.write(
      authPath,
      JSON.stringify({
        providers: {
          anthropic: {
            type: "api",
            key: "k1",
          },
        },
      }),
    )

    await expect(Auth.all()).resolves.toEqual({
      anthropic: {
        type: "api",
        key: "k1",
      },
    })
  })

  test("Auth.set writes api auth into providers map", async () => {
    await Auth.set("anthropic", {
      type: "api",
      key: "k1",
    })

    const raw = await readRaw()
    expect(raw.providers.anthropic).toEqual({
      type: "api",
      key: "k1",
    })
    expect(raw.openai_oauth_accounts).toEqual({})
  })

  test("Auth.set appends openai oauth account keyed by accountKey", async () => {
    await Auth.set("openai", {
      type: "oauth",
      access: "a1",
      refresh: "r1",
      expires: Date.now() + 1_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "a2",
      refresh: "r2",
      expires: Date.now() + 2_000,
      accountId: "acc-1",
      accountKey: "user-2__acc-1",
    })

    const raw = await readRaw()
    expect(Object.keys(raw.openai_oauth_accounts).sort()).toEqual(["user-1__acc-1", "user-2__acc-1"])
    expect(raw.openai_oauth_accounts["user-1__acc-1"].accountId).toBe("acc-1")
    expect(raw.openai_oauth_accounts["user-2__acc-1"].accountId).toBe("acc-1")
  })

  test("Auth.set upserts openai oauth account when accountKey already exists", async () => {
    await Auth.set("openai", {
      type: "oauth",
      access: "a1",
      refresh: "r1",
      expires: Date.now() + 1_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "a1-next",
      refresh: "r1-next",
      expires: Date.now() + 2_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })

    const raw = await readRaw()
    expect(Object.keys(raw.openai_oauth_accounts)).toHaveLength(1)
    expect(raw.openai_oauth_accounts["user-1__acc-1"].access).toBe("a1-next")
    expect(raw.openai_oauth_accounts["user-1__acc-1"].refresh).toBe("r1-next")
  })

  test("Auth.set throws for openai oauth without accountKey", async () => {
    await expect(
      Auth.set("openai", {
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: Date.now() + 1_000,
        accountId: "acc-1",
      }),
    ).rejects.toThrow()
  })

  test("Auth.get prefers openai oauth account over providers.openai api key", async () => {
    await Auth.set("openai", {
      type: "api",
      key: "api-key",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: Date.now() + 10_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })

    const openai = await Auth.get("openai")
    expect(openai?.type).toBe("oauth")
    expect(openai && "accountId" in openai ? openai.accountId : undefined).toBe("acc-1")
  })

  test("Auth.rotateOpenAIFromQuota switches to next openai oauth account", async () => {
    await Auth.set("openai", {
      type: "oauth",
      access: "a1",
      refresh: "r1",
      expires: Date.now() + 1_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "a2",
      refresh: "r2",
      expires: Date.now() + 2_000,
      accountId: "acc-1",
      accountKey: "user-2__acc-1",
    })

    const first = await Auth.get("openai")
    expect(first?.type).toBe("oauth")
    const result = await Auth.rotateOpenAIFromQuota()
    expect(result).toBe("rotated")
    const second = await Auth.get("openai")
    expect(second?.type).toBe("oauth")
    expect(second && "accountKey" in second ? second.accountKey : undefined).not.toBe(
      first && "accountKey" in first ? first.accountKey : undefined,
    )
  })

  test("Auth.rotateOpenAIFromQuota does not bounce back when caller reuses tried set", async () => {
    await Auth.set("openai", {
      type: "oauth",
      access: "a1",
      refresh: "r1",
      expires: Date.now() + 1_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "a2",
      refresh: "r2",
      expires: Date.now() + 2_000,
      accountId: "acc-1",
      accountKey: "user-2__acc-1",
    })

    const tried = new Set<string>()
    expect(await Auth.rotateOpenAIFromQuota(tried)).toBe("rotated")
    expect(await Auth.rotateOpenAIFromQuota(tried)).toBe("exhausted")
  })

  test("Auth.rotateOpenAIFromQuota returns exhausted when no account can be selected", async () => {
    await Auth.set("openai", {
      type: "oauth",
      access: "a1",
      refresh: "r1",
      expires: Date.now() + 1_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })

    expect(await Auth.rotateOpenAIFromQuota()).toBe("exhausted")
  })

  test("Auth.remove('openai') clears providers.openai and openai oauth account list", async () => {
    await Auth.set("openai", {
      type: "api",
      key: "api-key",
    })
    await Auth.set("openai", {
      type: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: Date.now() + 10_000,
      accountId: "acc-1",
      accountKey: "user-1__acc-1",
    })

    await Auth.remove("openai")
    const raw = await readRaw()
    expect(raw.providers.openai).toBeUndefined()
    expect(raw.openai_oauth_accounts).toEqual({})
  })
})
