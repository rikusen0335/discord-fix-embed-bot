// Discord Interactions (スラッシュコマンド) のHTTP受信
import type { Env } from "./types";

let verifyKey: CryptoKey | null = null;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** アプリの公開鍵をDiscord APIから取得してインポート(メモリキャッシュ) */
async function getVerifyKey(env: Env): Promise<CryptoKey> {
  if (verifyKey) return verifyKey;
  const res = await fetch("https://discord.com/api/v10/applications/@me", {
    headers: { authorization: `Bot ${env.BOT_TOKEN}` },
  });
  const app = (await res.json()) as { verify_key: string };
  verifyKey = await crypto.subtle.importKey(
    "raw",
    hexToBytes(app.verify_key),
    "Ed25519",
    false,
    ["verify"],
  );
  return verifyKey;
}

export async function verifyInteraction(
  env: Env,
  req: Request,
  body: string,
): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  try {
    const key = await getVerifyKey(env);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(sig),
      new TextEncoder().encode(ts + body),
    );
  } catch {
    return false;
  }
}
