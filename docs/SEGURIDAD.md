# Modelo de Seguridad

## Gestion de sesiones

La autenticacion usa un token HMAC simple pero efectivo. No hay base de datos de sesiones - el token se deriva de las credenciales.

```typescript
// src/server/auth/session.ts
export function createSessionToken(user: string, password: string): string {
  return createHash("sha256").update(`${user}:${password}`).digest("hex");
}
```

El token se guarda en una cookie `httpOnly` + `secure` + `sameSite: lax`:

```typescript
cookieStore.set(sessionCookieName, createSessionToken(user, password), {
  httpOnly: true,
  sameSite: "lax",
  secure: isSecure,
  path: "/",
  maxAge: 60 * 60 * 8,  // 8 horas
});
```

**Verificacion**: se compara con `timingSafeEqual` para prevenir timing attacks:

```typescript
export function isValidSessionToken(token: string | undefined): boolean {
  const expectedToken = createSessionToken(config.user, config.password);
  const tokenBuffer = Buffer.from(token, "utf8");
  const expectedBuffer = Buffer.from(expectedToken, "utf8");

  if (tokenBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(tokenBuffer, expectedBuffer);
}
```

**Comparaciones seguras**: la funcion `safeEqual()` hashea ambos inputs antes de comparar, asi no importa si los strings tienen longitudes diferentes:

```typescript
export function safeEqual(input: string, expected: string): boolean {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputHash, expectedHash);
}
```

Se usa en login para comparar usuario y password sin filtrar timing.

## Proteccion CSRF

El CSRF usa un enfoque **stateless** - no hay token guardado en servidor. El token se genera a partir del HMAC del session ID + timestamp:

```typescript
// src/server/auth/csrf.ts
export function generateCsrfToken(sessionToken: string): string {
  const timestamp = Date.now().toString();
  const payload = `${sessionToken}:${timestamp}`;
  const signature = createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");
  return `${timestamp}:${signature}`;
}
```

**Validacion**:
1. Separar timestamp y firma del token
2. Verificar que el timestamp no expiro (1 hora maxima)
3. Re-computar el HMAC con el session actual
4. Comparar con `timingSafeEqual`

**Transporte**: el token se envia por 3 canales simultaneamente:
- `<meta name="csrf-token">` para JavaScript
- `<input type="hidden" name="csrf_token">` para formularios
- Header `x-csrf-token` para AJAX/fetch

```typescript
// Extraccion del token del request
export async function getCsrfTokenFromRequest(request: Request): Promise<string | null> {
  // 1. Buscar en form data
  // 2. Buscar en JSON body
  // 3. Buscar en header
  // Retornar el primero que encuentre
}
```

## Proteccion contra path traversal

Todos los paths que aceptan IDs de backup validan contra traversal:

```typescript
// src/server/backup/paths.ts
const SAFE_BACKUP_ID_REGEX = /^[A-Za-z0-9._-]+$/;

export function isSafeBackupId(value: string): boolean {
  return SAFE_BACKUP_ID_REGEX.test(value);
}

export function resolveBackupRoot(outputDir: string, backupId: string): string {
  if (!isSafeBackupId(backupId)) {
    throw new Error(`Invalid backup ID: ${backupId}`);
  }
  const resolved = path.resolve(outputDir, backupId);
  if (!resolved.startsWith(path.resolve(outputDir))) {
    throw new Error(`Path traversal attempt blocked: ${backupId}`);
  }
  return resolved;
}
```

El `BackupWriter` tambien valida internamente:

```typescript
resolvePath(relativePath: string): string {
  const resolved = path.resolve(this.rootDir, relativePath);
  if (!resolved.startsWith(this.rootDir)) {
    throw new Error(`Path traversal attempt blocked: ${relativePath}`);
  }
  return resolved;
}
```

## Headers de seguridad

Configurados en `next.config.ts` y aplicados a todas las rutas:

```typescript
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];
```

- `X-Frame-Options: DENY` - previene clickjacking
- `CSP` - restringe scripts, estilos, conexiones solo al mismo origin
- `HSTS` - fuerza HTTPS por 2 anos
- `Permissions-Policy` - deshabilita camara, microfono, geolocalizacion

## Sanitizacion de errores

Los errores nunca revelan paths del sistema:

```typescript
// src/app/page.tsx
function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const msg = error.message;
  if (msg.includes("/") || msg.includes("\\") || msg.includes("ENOENT") || msg.includes("EACCES")) {
    return fallback;
  }
  return msg.slice(0, 80).replaceAll(" ", "_");
}
```

Si un error contiene `/`, `\`, `ENOENT` o `EACCES`, se reemplaza por un mensaje generico. Esto previene que un atacante obtenga informacion sobre la estructura de directorios.

## Redaccion de datos sensibles en logs

El logger Pino esta configurado para redactar automaticamente API keys:

```typescript
// src/server/utils/logger.ts
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "APPWRITE_API_KEY",
      "APPWRITE_TARGET_API_KEY",
      "*.APPWRITE_API_KEY",
      "*.APPWRITE_TARGET_API_KEY",
    ],
    remove: true,
  },
});
```

`remove: true` elimina el campo del log completamente (no lo reemplaza con `[REDACTED]`).

## Timing-safe comparisons en todo el proyecto

Toda comparacion de secrets usa `timingSafeEqual`:

| Uso | Archivo | Metodo |
|-----|---------|--------|
| Login | `page.tsx` | `safeEqual(user, expected)` |
| Session token | `session.ts` | `timingSafeEqual(tokenBuffer, expectedBuffer)` |
| CSRF token | `csrf.ts` | `timingSafeEqual(tokenBuffer, expectedBuffer)` |

Nunca se usa `===` o `==` para comparar credenciales.

## Variables sensibles

Las siguientes variables **nunca** deben commitearse al repo:

- `APPWRITE_API_KEY`
- `APPWRITE_TARGET_API_KEY`
- `APP_LOGIN_PASSWORD`
- `APP_CSRF_SECRET`

El `.env` esta en `.gitignore`. Usa `.env.example` como template.

## Import seguro: no al mismo proyecto

`loadTargetConfig()` verifica que las credenciales target sean diferentes a las source:

```typescript
if (!config.APPWRITE_TARGET_ENDPOINT || !config.APPWRITE_TARGET_PROJECT_ID || !config.APPWRITE_TARGET_API_KEY) {
  throw new Error(
    "Variables APPWRITE_TARGET_ENDPOINT, APPWRITE_TARGET_PROJECT_ID y APPWRITE_TARGET_API_KEY son obligatorias para importar. " +
    "No se permite importar al proyecto origen por seguridad."
  );
}
```

Esto previene que accidentalmente se sobreescriba el proyecto origen con sus propios datos.
