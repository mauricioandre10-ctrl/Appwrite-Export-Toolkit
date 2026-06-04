<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reglas para Agentes IA

## Convenciones de Código

- **TypeScript estricto**: No usar `any`. Usar tipos explícitos o inferencia.
- **UI en español**: Todos los textos visibles para el usuario en español.
- **Comentarios en inglés**: Solo si son necesarios. Evitar comentarios obvios.
- **Validación con Zod**: Usar esquemas Zod para validar entrada de datos en API routes y CLI.
- **Logging con pino**: Usar `import { logger } from '@/lib/logger'` para logging estructurado.
- **Imports**: Usar alias `@/` para imports relativos a `src/`.

## Quality Gates

Antes de cualquier commit o PR, ejecutar:

```bash
npm run check   # lint + typecheck + test
```

Los tres deben pasar sin errores. No hacer commits si `npm run check` falla.

## Estructura del Proyecto

```
src/
├── app/              # Next.js App Router (pages + API routes)
│   └── api/          # API endpoints (export, import, backups, schedules, health, jobs)
├── components/       # Componentes React client-side
├── cli/              # CLI con Commander (tsx src/cli/index.ts)
└── server/           # Lógica del servidor
    ├── exporters/    # Módulos de exportación (Auth, Databases, Storage)
    ├── import/       # Módulos de importación
    ├── backup/       # Escritura y checksums
    ├── schedules/    # Programación de backups con croner
    └── validators/   # Validación de integridad de backups
```

## Patrones de Seguridad

- **Comparación segura de tokens**: Usar `timingSafeEqual` de `crypto` para comparar tokens CSRF y passwords. Nunca usar `===`.
- **CSRF**: Proteger endpoints que modifican estado con tokens CSRF.
- **Validación de paths**: Usar `path.resolve` + verificación de prefijo para prevenir path traversal en operaciones de archivo.
- **Redacción**: Nunca loguear ni exponer API keys, passwords o hashes. El módulo de export redacta automáticamente campos sensibles.
- **Rate limiting**: Aplicar rate limiting en endpoints públicos (`/api/health` excluido).
