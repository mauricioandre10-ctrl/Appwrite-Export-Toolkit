"use client";

/** Campo hidden para enviar el token CSRF en formularios. */
export function CsrfTokenInput({ token }: { token?: string | null | undefined }) {
  if (!token) {
    return null;
  }

  return <input type="hidden" name="csrf_token" value={token} />;
}
