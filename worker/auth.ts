import type { Env } from "./store";
export const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
export const random = () => crypto.randomUUID() + crypto.randomUUID();
export function constantEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export function passwordConfig(encoded: string) {
  const [algorithm, rounds, salt, verifier] = encoded.split(":");
  if (
    algorithm !== "pbkdf2-client" ||
    rounds !== "600000" ||
    !/^[0-9a-f]{64}$/.test(salt || "") ||
    !/^[0-9a-f]{64}$/.test(verifier || "")
  )
    throw new Error("Configure the shared password with npm run setup.");
  return {
    algorithm: "PBKDF2-SHA256" as const,
    iterations: 600000 as const,
    salt,
  };
}
export async function verify(proof: string, encoded: string) {
  passwordConfig(encoded);
  if (!/^[0-9a-f]{64}$/.test(proof)) return false;
  return constantEqual(await hash(proof), encoded.split(":")[3]);
}
export type Session = {
  hash: string;
  csrf: string;
  device: string;
  expires: number;
  created: number;
  password_version: string;
};
export async function session(request: Request, env: Env) {
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)budget_session=([^;]+)/)?.[1];
  if (!token || !env.PASSWORD_HASH) return null;
  const s = await env.DB.prepare(
    "SELECT * FROM sessions WHERE hash=? AND expires>?",
  )
    .bind(await hash(token), Date.now())
    .first<Session>();
  if (!s || s.password_version !== (await hash(env.PASSWORD_HASH))) return null;
  return s;
}
export async function encrypt(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret.match(/.{2}/g)!.map((v) => parseInt(v, 16))),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(value),
    ),
  );
  return (
    btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...body))
  );
}
export async function decrypt(value: string, secret: string) {
  const [a, b] = value.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret.match(/.{2}/g)!.map((v) => parseInt(v, 16))),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const decode = (v: string) =>
    Uint8Array.from(atob(v), (x) => x.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(a) },
      key,
      decode(b),
    ),
  );
}
export function originOkay(req: Request) {
  const origin = req.headers.get("Origin");
  return !!origin && origin === new URL(req.url).origin;
}
