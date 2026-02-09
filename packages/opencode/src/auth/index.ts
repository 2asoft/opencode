import { Effect } from "effect"
import z from "zod"
import { runtime } from "@/effect/runtime"
import * as S from "./effect"

export { OAUTH_DUMMY_KEY } from "./effect"

function runPromise<A>(f: (service: S.AuthEffect.Interface) => Effect.Effect<A, S.AuthError>) {
  return runtime.runPromise(S.AuthEffect.Service.use(f))
}

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      accountKey: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  export const OpenAIOauth = Oauth.extend({
    accountId: z.string(),
    accountKey: z.string(),
    updatedAt: z.number(),
  }).meta({ ref: "OpenAIOAuth" })
  export type OpenAIOauth = z.infer<typeof OpenAIOauth>

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }

  export async function rotateOpenAIFromQuota(tried = new Set<string>()) {
    return runPromise((service) => service.rotateOpenAIFromQuota(tried))
  }
}
