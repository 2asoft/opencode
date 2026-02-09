import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  requireAccountId,
  extractAccountKeyFromClaims,
  extractAccountKey,
  requireAccountKey,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountKeyFromClaims", () => {
    test("extracts chatgpt_account_user_id from nested auth claims", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": {
          chatgpt_account_user_id: "user-a__acc-1",
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-a",
        },
      }
      expect(extractAccountKeyFromClaims(claims)).toBe("user-a__acc-1")
    })

    test("falls back to chatgpt_user_id + account id", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-a",
        },
      }
      expect(extractAccountKeyFromClaims(claims)).toBe("user-a__acc-1")
    })

    test("falls back to sub + account id", () => {
      const claims: IdTokenClaims = {
        sub: "auth0|abc",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc-1",
        },
      }
      expect(extractAccountKeyFromClaims(claims)).toBe("auth0|abc__acc-1")
    })

    test("returns undefined when key cannot be built", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": {
          chatgpt_user_id: "user-a",
        },
      }
      expect(extractAccountKeyFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("extractAccountKey", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_user_id: "user-id__acc-1",
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-id",
        },
      })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_user_id: "user-access__acc-1",
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-access",
        },
      })
      expect(
        extractAccountKey({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("user-id__acc-1")
    })

    test("falls back to access_token", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_user_id: "user-access__acc-1",
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-access",
        },
      })
      expect(
        extractAccountKey({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("user-access__acc-1")
    })

    test("returns undefined when account key cannot be built", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountKey({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })
  })

  describe("requireAccountId", () => {
    test("returns account id when available", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "acc-id-token" })
      const accessToken = createTestJwt({ email: "test@example.com" })
      expect(
        requireAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-id-token")
    })

    test("throws when account id is missing", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(() =>
        requireAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toThrow()
    })
  })

  describe("requireAccountKey", () => {
    test("returns account key when available", () => {
      const idToken = createTestJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_user_id: "user-a__acc-1",
          chatgpt_account_id: "acc-1",
          chatgpt_user_id: "user-a",
        },
      })
      expect(
        requireAccountKey({
          id_token: idToken,
          access_token: idToken,
          refresh_token: "rt",
        }),
      ).toBe("user-a__acc-1")
    })

    test("throws when account key is missing", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(() =>
        requireAccountKey({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toThrow()
    })
  })
})
