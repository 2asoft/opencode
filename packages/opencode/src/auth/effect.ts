import path from "path"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.optional(Schema.String),
  accountKey: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class OpenAIOauth extends Schema.Class<OpenAIOauth>("OpenAIOAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.String,
  accountKey: Schema.String,
  enterpriseUrl: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown])
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

type File = {
  providers: Record<string, Info>
  openai_oauth_accounts: Record<string, OpenAIOauth>
}

type Rotate = "rotated" | "exhausted" | "unavailable"

const file = path.join(Global.Path.data, "auth.json")
let current: string | undefined
let gate = Promise.resolve()

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

const decodeInfo = Schema.decodeUnknownOption(Info)
const decodeOauth = Schema.decodeUnknownOption(OpenAIOauth)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const empty = (): File => ({
  providers: {},
  openai_oauth_accounts: {},
})

const readMap = <A>(value: unknown, decode: (value: unknown) => Option.Option<A>) => {
  if (!isRecord(value)) return {}
  return Object.entries(value).reduce<Record<string, A>>((acc, [key, item]) => {
    const parsed = decode(item)
    if (Option.isSome(parsed)) acc[key] = parsed.value
    return acc
  }, {})
}

const read = async (): Promise<File> => {
  const data = await Filesystem.readJson<unknown>(file).catch(() => undefined)
  if (!isRecord(data)) return empty()
  return {
    providers: readMap(data.providers, decodeInfo),
    openai_oauth_accounts: readMap(data.openai_oauth_accounts, decodeOauth),
  }
}

const write = (data: File) => Filesystem.writeJson(file, data, 0o600)

const order = (data: Record<string, OpenAIOauth>) => {
  return Object.entries(data)
    .sort((a, b) => {
      if (b[1].updatedAt !== a[1].updatedAt) return b[1].updatedAt - a[1].updatedAt
      return a[0].localeCompare(b[0])
    })
    .map(([key]) => key)
}

const pick = (data: Record<string, OpenAIOauth>) => {
  if (current && data[current]) return current
  const [next] = order(data)
  if (!next) return
  current = next
  return next
}

const toInfo = (info: OpenAIOauth) => {
  return new Oauth({
    type: "oauth",
    refresh: info.refresh,
    access: info.access,
    expires: info.expires,
    accountId: info.accountId,
    accountKey: info.accountKey,
    enterpriseUrl: info.enterpriseUrl,
  })
}

const lock = <A>(fn: () => Promise<A>) => {
  const run = gate.then(fn, fn)
  gate = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export namespace AuthEffect {
  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
    readonly rotateOpenAIFromQuota: (tried?: Set<string>) => Effect.Effect<Rotate, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const get = Effect.fn("Auth.get")((providerID: string) =>
        Effect.tryPromise({
          try: async () => {
            const data = await read()
            if (providerID !== "openai") {
              return data.providers[providerID]
            }
            if (Object.keys(data.openai_oauth_accounts).length === 0) {
              return data.providers.openai
            }
            const key = pick(data.openai_oauth_accounts)
            if (!key) return data.providers.openai
            return toInfo(data.openai_oauth_accounts[key])
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const all = Effect.fn("Auth.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await read()
            const out = { ...data.providers }
            if (Object.keys(data.openai_oauth_accounts).length === 0) {
              return out
            }
            const key = pick(data.openai_oauth_accounts)
            if (!key) return out
            out.openai = toInfo(data.openai_oauth_accounts[key])
            return out
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const set = Effect.fn("Auth.set")((key: string, info: Info) =>
        Effect.tryPromise({
          try: () =>
            lock(async () => {
              const norm = key.replace(/\/+$/, "")
              const data = await read()
              if (norm === "openai" && info.type === "oauth") {
                if (!info.accountId) {
                  throw new Error("OpenAI OAuth accountId is required.")
                }
                if (!info.accountKey) {
                  throw new Error("OpenAI OAuth accountKey is required.")
                }
                data.openai_oauth_accounts[info.accountKey] = new OpenAIOauth({
                  type: "oauth",
                  refresh: info.refresh,
                  access: info.access,
                  expires: info.expires,
                  accountId: info.accountId,
                  accountKey: info.accountKey,
                  enterpriseUrl: info.enterpriseUrl,
                  updatedAt: Date.now(),
                })
                current = info.accountKey
                await write(data)
                return
              }
              if (norm !== key) delete data.providers[key]
              delete data.providers[norm + "/"]
              data.providers[norm] = info
              await write(data)
            }),
          catch: fail("Failed to write auth data"),
        }),
      )

      const remove = Effect.fn("Auth.remove")((key: string) =>
        Effect.tryPromise({
          try: () =>
            lock(async () => {
              const norm = key.replace(/\/+$/, "")
              const data = await read()
              if (norm === "openai") {
                delete data.providers.openai
                delete data.providers["openai/"]
                data.openai_oauth_accounts = {}
                current = undefined
                await write(data)
                return
              }
              delete data.providers[key]
              delete data.providers[norm]
              delete data.providers[norm + "/"]
              await write(data)
            }),
          catch: fail("Failed to write auth data"),
        }),
      )

      const rotateOpenAIFromQuota = Effect.fn("Auth.rotateOpenAIFromQuota")((tried = new Set<string>()) =>
        Effect.tryPromise({
          try: () =>
            lock(async (): Promise<Rotate> => {
              const data = await read()
              const ids = order(data.openai_oauth_accounts)
              if (ids.length === 0) return "unavailable"
              const key = pick(data.openai_oauth_accounts) ?? ids[0]
              current = key
              tried.add(key)
              const next = ids.find((item) => !tried.has(item))
              if (!next) {
                return "exhausted"
              }
              current = next
              return "rotated"
            }),
          catch: fail("Failed to rotate OpenAI auth data"),
        }),
      )

      return Service.of({
        get,
        all,
        set,
        remove,
        rotateOpenAIFromQuota,
      })
    }),
  )
}
