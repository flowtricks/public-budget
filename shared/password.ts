export interface PasswordConfig {
  algorithm: "PBKDF2-SHA256";
  iterations: 600000;
  salt: string;
}
/** Password stretching runs on the phone; only a verifier of this proof is stored on the Worker. */
export async function passwordProof(password: string, config: PasswordConfig) {
  if (
    config.algorithm !== "PBKDF2-SHA256" ||
    config.iterations !== 600000 ||
    !/^[0-9a-f]{64}$/.test(config.salt)
  )
    throw new Error("The server password configuration is invalid.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(config.salt),
      iterations: 600000,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
