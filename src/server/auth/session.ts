import { createHash, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "appwrite_export_toolkit_session";

export type LoginConfig = {
  ready: boolean;
  user: string;
  password: string;
};

export function getLoginConfig(): LoginConfig {
  const user = process.env.APP_LOGIN_USER ?? "";
  const password = process.env.APP_LOGIN_PASSWORD ?? "";

  return {
    ready: user.length > 0 && password.length > 0,
    user,
    password,
  };
}

export function createSessionToken(user: string, password: string): string {
  return createHash("sha256").update(`${user}:${password}`).digest("hex");
}

export function isValidSessionToken(token: string | undefined, config = getLoginConfig()): boolean {
  return config.ready && token === createSessionToken(config.user, config.password);
}

export function safeEqual(input: string, expected: string): boolean {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(inputHash, expectedHash);
}
