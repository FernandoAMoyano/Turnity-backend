# SKILL: Auditoría de Arquitectura — Turnity Backend

> Leer este archivo COMPLETO antes de revisar cualquier módulo del proyecto.
> Esta skill define qué es correcto, qué es una inconsistencia y cómo reportarla.

---

## 1. Contexto del Proyecto

**Turnity Backend** es un sistema de gestión de turnos para salones de belleza.

- **Stack:** TypeScript, Node.js, Express, Prisma ORM, PostgreSQL, Docker, Jest
- **Arquitectura:** Clean Architecture + DDD táctico + Hexagonal (Ports & Adapters)
- **Ruta raíz:** `C:\Users\Fernando\Desktop\PORTFOLIO2\Turnity-backend`
- **Módulos implementados:** `auth`, `services`, `appointments`, `holidays`, `notifications`, `payments`

---

## 2. Estructura de Carpetas Esperada

Cada módulo dentro de `src/modules/<modulo>/` debe seguir esta estructura:

```
<modulo>/
├── <Modulo>Container.ts
├── domain/
│   ├── entities/
│   │   └── <Entidad>.ts
│   └── repositories/
│       └── I<Entidad>Repository.ts   ← prefijo I para interfaces
├── application/
│   ├── dto/
│   │   ├── request/                  ← minúscula
│   │   │   └── <Accion>Dto.ts
│   │   └── response/                 ← minúscula
│   │       └── <Entidad>ResponseDto.ts
│   ├── services/                     ← interfaces de servicios de aplicación
│   │   └── <Servicio>Service.ts
│   └── use-cases/                    ← kebab-case con guión
│       └── <AccionEntidad>.ts
├── infrastructure/
│   ├── persistence/
│   │   └── Prisma<Entidad>Repository.ts
│   └── services/                     ← implementaciones concretas
│       └── <Implementacion>Service.ts
└── presentation/
    ├── controllers/
    │   └── <Modulo>Controller.ts
    ├── routes/
    │   └── <Modulo>Routes.ts
    ├── middleware/                    ← solo si el módulo tiene middleware propio
    │   └── <Nombre>Middleware.ts
    └── validations/
        └── <Modulo>Validations.ts
```

### Inconsistencias conocidas a corregir
- El módulo `auth` usa `uses-cases/` (con s) en lugar de `use-cases/`. Es un error de nomenclatura.
- El módulo `auth` usa `dto/Request/` y `dto/Response/` con mayúscula. Debe ser minúscula como el resto.

---

## 3. Convenciones de Nomenclatura

### Archivos
| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Entidades de dominio | PascalCase | `User.ts`, `Holiday.ts` |
| Interfaces de repositorio | `I` + PascalCase | `IHolidayRepository.ts`, `UserRepository.ts`* |
| Implementaciones Prisma | `Prisma` + PascalCase | `PrismaUserRepository.ts` |
| Use cases | PascalCase verbo+sustantivo | `CreateHoliday.ts`, `GetUserProfile.ts` |
| DTOs request | PascalCase + `Dto` | `CreateHolidayDto.ts` |
| DTOs response | PascalCase + `ResponseDto` | `HolidayResponseDto.ts` |
| Controllers | PascalCase + `Controller` | `HolidayController.ts` |
| Routes | PascalCase + `Routes` | `HolidayRoutes.ts` |
| Containers | PascalCase + `Container` | `HolidayContainer.ts` |

> *El módulo `auth` no usa prefijo `I` en sus repositorios. Normalizar a `I<Nombre>Repository.ts` es una mejora futura.

### Clases y métodos
- Clases: `PascalCase`
- Métodos públicos: `camelCase`
- Propiedades privadas de entidades con getters: prefijo `_` (patrón Holiday)
- Propiedades públicas directas sin getters: sin prefijo (patrón User)
- **Propiedades privadas inyectadas en controllers:** prefijo `_` cuando el nombre del use case colisiona con el nombre del método público del controller (ej: `private _createCategory: CreateCategory` + método `createCategory = async(...)`). Esto sigue el Google TypeScript Style Guide y la convención de Angular.

### Comentarios JSDoc
- Escritos en **español**
- Obligatorios en: clases, métodos públicos, interfaces, constructores
- Formato: `@param`, `@returns`, `@throws`, `@description`

### Mensajes de error
- Escritos en **inglés** — son contratos de la API, no UI
- El frontend es responsable de traducirlos al usuario final
- Aplica a: excepciones tipadas, mensajes de use cases, mensajes de express-validator
- Los tests de integración validan mensajes en inglés — nunca cambiar el idioma de un mensaje sin actualizar el test correspondiente

---

## 4. Capa Domain — Reglas

### Entidades
Las entidades son el núcleo del dominio. Deben:

✅ Encapsular lógica de negocio (validaciones, comportamientos)
✅ Tener factory method `static create(...)` para nueva creación
✅ Tener método `toPersistence()` o `toObject()` para serialización
✅ Lanzar errores tipados (`ValidationError`, `Error`) ante datos inválidos
✅ Manejar `updatedAt` internamente al mutar estado

❌ NO conocer Prisma, Express ni ninguna dependencia externa
❌ NO hacer llamadas async ni acceder a repositorios
❌ NO tener lógica de presentación (formateos HTTP, etc.)

**Dos patrones válidos de entidad en el proyecto:**

**Patrón A — Propiedades públicas directas** (usado en `auth`):
```typescript
export class User {
  public name: string;
  public readonly id: string;
  // ...
  updateProfile(name?: string): void { ... }
}
```

**Patrón B — Propiedades privadas con getters** (usado en `holidays`):
```typescript
export class Holiday {
  private _name: string;
  get name(): string { return this._name; }
  // ...
}
```

Ambos son válidos, pero **no mezclar patrones dentro del mismo módulo**.

### Interfaces de Repositorio
- Viven en `domain/repositories/`
- Son **interfaces TypeScript puras**, sin implementación
- Definen el contrato que la capa de aplicación usa
- Nunca importan nada de Prisma ni de infraestructura

```typescript
export interface IHolidayRepository {
  findById(id: string): Promise<Holiday | null>;
  save(holiday: Holiday): Promise<Holiday>;
  // ...
}
```

---

## 5. Capa Application — Reglas

### Use Cases
Cada use case es una clase con un único método público `execute(...)`. Deben:

✅ Recibir dependencias por constructor (repositorios, servicios)
✅ Tener un único método `execute()` que orquesta la operación
✅ Lanzar excepciones tipadas del shared: `ValidationError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`
✅ Retornar DTOs, nunca entidades de dominio directamente
✅ Las validaciones de negocio van aquí o en la entidad, nunca en el controller

❌ NO importar nada de Express (Request, Response)
❌ NO importar implementaciones de infraestructura directamente
❌ NO lanzar `Error` genérico — siempre usar excepciones tipadas del shared

**Excepción conocida a corregir:** `CreateHoliday.ts` lanza `new Error(...)` en lugar de `ConflictError`. Todos los use cases deben usar excepciones tipadas.

### Excepciones Tipadas Disponibles (en `src/shared/exceptions/`)
| Clase | HTTP | Cuándo usarla |
|-------|------|---------------|
| `ValidationError` | 400 | Datos de entrada inválidos |
| `UnauthorizedError` | 401 | Credenciales incorrectas, token inválido |
| `NotFoundError` | 404 | Recurso no encontrado |
| `ConflictError` | 409 | Duplicado, estado incompatible |
| `BusinessRuleError` | 422 | Violación de reglas de negocio (cancelar cita pasada, transición de estado inválida, etc.) |
| `ForbiddenError` | 403 | Acceso denegado por permisos |
| `AppError` | 500 | Base — no instanciar directamente |

### DTOs
- **Request DTOs:** interfaces TypeScript simples, sin lógica
- **Response DTOs:** interfaces TypeScript simples + opcionalmente un `Mapper` estático
- Nunca exponer la contraseña ni campos sensibles en response DTOs

### Servicios de Aplicación (interfaces)
- `HashService` — contrato para hashing de contraseñas
- `JwtService` — contrato para generación/verificación de tokens
- Sus implementaciones concretas viven en `infrastructure/services/`

---

## 6. Capa Infrastructure — Reglas

### Repositorios Prisma
Deben:

✅ Implementar la interfaz de repositorio del dominio
✅ Mapear datos de Prisma a entidades de dominio en cada método
✅ Usar el constructor de la entidad o su factory `fromPersistence` cuando exista
✅ Normalizar datos antes de persistir (ej: `email.toLowerCase()`)

❌ NO retornar objetos Prisma crudos como tipo de retorno (excepto métodos `WithRole` que usan `any` por necesidad de join)
❌ NO contener lógica de negocio

**Patrón de mapeo estándar:**
```typescript
async findById(id: string): Promise<Holiday | null> {
  const data = await this.prisma.holiday.findUnique({ where: { id } });
  if (!data) return null;
  return new Holiday({ ...data }); // o Entity.fromPersistence(...)
}
```

### Servicios de Infraestructura
- `BcryptHashService` implementa `HashService` con 12 rondas de salt
- `JwtTokenService` implementa `JwtService` con configuración desde env vars

---

## 7. Capa Presentation — Reglas

### Controllers
El patrón correcto en Turnity tiene **dos variantes**:

**Variante A — Métodos async que retornan `Promise<Response | void>`** (módulo `auth`):
```typescript
async login(req, res): Promise<Response | void> {
  const result = await this.loginUser.execute(req.body);
  return res.status(200).json({ success: true, data: result });
  // Los errores burbujean solos hacia el errorHandler via .catch(next) en Routes
}
```

**Variante B — Arrow functions con `next` explícito** (módulos `holidays`, `appointments`, etc.):
```typescript
create = async (req, res, next): Promise<void> => {
  try {
    const result = await this.createHoliday.execute(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error); // delega explícitamente al errorHandler
  }
};
```

Ambas variantes son correctas porque en ambos casos el `errorHandler` global resuelve el error. La diferencia es estilística. **No mezclar variantes dentro del mismo controller.**

**Reglas adicionales del controller:**

❌ NO usar `try/catch` que solo hace `throw error` — es código inútil, el error burbujea igual
❌ NO construir respuestas de error con `res.status(4xx).json(...)` directamente — rompe la uniformidad del `errorHandler`
❌ NO leer `req.params.userId` como fallback de `req.user.userId` — si `req.user` no existe es un problema de autenticación
✅ Las guardas de autenticación (`if (!req.user?.userId)`) deben lanzar `UnauthorizedError`, no construir respuestas directamente
✅ El tipo de retorno debe ser `Promise<Response>`, no `Promise<Response | void>` — todos los métodos siempre retornan
✅ Las validaciones de formato (campos requeridos, longitud, etc.) van en `AuthValidations` con express-validator — no duplicar en el controller

**Formato de respuesta exitosa estándar:**
```typescript
res.status(200).json({
  success: true,
  message: 'Descripción de la operación',
  data: result,          // omitir si no hay datos (ej: delete)
});
```

**Códigos de status por operación:**
| Operación | Código |
|-----------|--------|
| GET (lectura) | 200 |
| POST (creación) | 201 |
| PUT (actualización) | 200 |
| DELETE (eliminación) | 200 |

### Routes
✅ Registrar rutas en orden: específicas primero, dinámicas al final (evitar conflictos)
✅ Aplicar `authMiddleware.authenticate` antes de `authorize` en rutas protegidas
✅ Las validaciones de `express-validator` se aplican en la ruta, antes del controller
✅ Usar `handleValidationErrors` para convertir errores de express-validator a `ValidationError`

**Patrón de ruta protegida:**
```typescript
this.router.post(
  '/',
  this.authMiddleware.authenticate.bind(this.authMiddleware),
  this.authMiddleware.authorize(['ADMIN']),
  Validations.create,
  this.handleValidationErrors,
  (req, res, next) => this.controller.create(req, res, next),
);
```

### Middleware
- `AuthMiddleware.authenticate` — valida JWT y popula `req.user`
- `AuthMiddleware.authorize(roles[])` — verifica rol contra BD dinámicamente
- No hardcodear IDs de roles — siempre verificar por nombre desde BD

---

## 8. Container — Reglas

Cada módulo tiene un `<Modulo>Container.ts` en la raíz del módulo que:

✅ Implementa patrón Singleton con `static getInstance(...)`
✅ Inyecta dependencias en orden: repositories → services → use cases → controller → routes
✅ Expone getters para todos los elementos (para testing y uso externo)
✅ El constructor es `private` (o sin modificador) para forzar uso del Singleton
✅ Recibe `PrismaClient` y opcionalmente `AuthMiddleware` como parámetros

**Orden de wiring en `setupDependencies()`:**
```
1. Repositories (instanciar PrismaXxxRepository)
2. Services (HashService, JwtService si aplica)
3. Use Cases (inyectar repositories y services)
4. Controller (inyectar use cases)
5. Routes (inyectar controller + authMiddleware)
```

---

## 9. Manejo de Errores — Flujo Completo

```
Use Case lanza excepción tipada (ValidationError, NotFoundError, etc.)
    ↓
Controller: el error burbujea (throw) o se pasa via next(error)
    ↓
Routes: .catch(next) o next(error) captura y envía al middleware
    ↓
ErrorHandler global (app.ts): res.status(error.statusCode).json(...)
```

**El `errorHandler` en `src/shared/middleware/ErrorHandler.ts`:**
- Si es `instanceof AppError`: usa `error.statusCode` y `error.code`
- Si no: responde 500 con mensaje genérico

**Regla:** Nunca construir respuestas de error directamente en el controller con `res.status(4xx).json(...)` salvo para guardas de presentación pura (verificar que `req.user` existe antes de llamar al use case).

---

## 10. Checklist de Auditoría por Módulo

Al revisar un módulo, verificar **en este orden**:

### 10.1 Domain
- [ ] Las entidades tienen factory method `static create(...)`
- [ ] Las entidades lanzan errores descriptivos ante datos inválidos
- [ ] Las entidades no importan nada de fuera del dominio
- [ ] Los métodos de mutación actualizan `updatedAt`
- [ ] Las interfaces de repositorio definen todos los métodos necesarios
- [ ] Los errores lanzados en entidades son `Error` o `ValidationError` (no strings)

### 10.2 Application
- [ ] Cada use case tiene exactamente un método `execute()`
- [ ] Los use cases usan **solo** excepciones tipadas del shared (no `new Error(...)`)
- [ ] Los use cases retornan DTOs, no entidades de dominio
- [ ] Los DTOs request son interfaces simples sin lógica
- [ ] Los DTOs response no exponen campos sensibles (password, etc.)
- [ ] No hay imports de Express en esta capa

### 10.3 Infrastructure
- [ ] Cada método del repositorio Prisma mapea a entidad de dominio al retornar
- [ ] No hay lógica de negocio en los repositorios
- [ ] Los datos se normalizan antes de persistir (email lowercase, trim, etc.)
- [ ] Las implementaciones de servicios leen config desde env vars con fallback

### 10.4 Presentation — Controller
- [ ] El patrón de manejo de errores es uniforme dentro del controller (no mezclar variantes)
- [ ] El formato de respuesta es `{ success, message, data }` en todos los métodos
- [ ] Los códigos HTTP son correctos (201 para creación, 200 para el resto)
- [ ] No hay lógica de negocio en el controller
- [ ] No hay `try/catch` que solo hace `throw error` (código inútil)
- [ ] No hay `res.status(4xx).json(...)` directamente — todo pasa por el `errorHandler`
- [ ] Las guardas de autenticación lanzan `UnauthorizedError`, no construyen respuestas inline
- [ ] El tipo de retorno es `Promise<Response>`, no `Promise<Response | void>`
- [ ] No hay lectura de `req.params` como fallback de `req.user`

### 10.5 Presentation — Routes
- [ ] Las rutas específicas están antes que las dinámicas (`:id`)
- [ ] Las rutas protegidas tienen `authenticate` antes de `authorize`
- [ ] Existe archivo `<Modulo>Validations.ts` con validaciones express-validator para cada endpoint
- [ ] Los errores de express-validator se convierten a `ValidationError` via `handleValidationErrors`
- [ ] Cada ruta usa el método HTTP correcto (GET para lectura, POST para creación, etc.)

### 10.6 Container
- [ ] El orden de wiring es repositories → services → use cases → controller → routes
- [ ] Existe `static getInstance(...)` para Singleton
- [ ] Hay getters para todos los elementos
- [ ] No instancia ni importa nada de otras capas fuera del orden correcto

### 10.7 Consistencia entre módulos
- [ ] Nomenclatura de carpetas en kebab-case (`use-cases/`, `dto/request/`)
- [ ] Nomenclatura de archivos consistente con el resto de módulos
- [ ] Los JSDoc están en español
- [ ] No hay `AuthService` u otras clases huérfanas sin uso real

---

## 11. Inconsistencias Globales Conocidas

Estas inconsistencias ya fueron identificadas y deben corregirse módulo por módulo:

| # | Módulo | Archivo/Carpeta | Problema | Corrección |
|---|--------|-----------------|----------|------------|
| 1 | `auth` | `application/uses-cases/` | ~~Carpeta con `uses-cases` (con s)~~ | ✅ Resuelto |
| 2 | `auth` | `application/dto/Request/` y `dto/Response/` | ~~Carpetas con mayúscula~~ | ✅ Resuelto |
| 3 | `auth` | `domain/repositories/Rol.ts` | ~~Nombre inconsistente~~ | ✅ Resuelto |
| 4 | `auth` | `application/services/AuthService.ts` | Clase huérfana, no usada por el Container | Eliminar |
| 5 | `holidays` | `application/use-cases/CreateHoliday.ts` | ~~Lanza `new Error(...)` en lugar de `ConflictError`~~ | ✅ Resuelto |
| 6 | `holidays` | `application/use-cases/CreateHoliday.ts` | ~~Usa `uuidv4` directamente en lugar de `generateUuid()` del shared~~ | ✅ Resuelto |
| 7 | Global | Todos los módulos | Revisar que `req.query` params se conviertan a su tipo correcto (son siempre `string`) | Verificar conversiones con `Number()`, etc. |
| 8 | `notifications` | `domain/repositories/` | Interfaces sin prefijo `I` (`NotificationRepository`, `NotificationStatusRepository`) | Mejora futura: renombrar a `INotificationRepository` e `INotificationStatusRepository` |

---

## 12. Cómo Reportar Inconsistencias

Al finalizar la revisión de un módulo, presentar el reporte en este formato:

```
## Revisión: módulo `<nombre>`

### 🔴 Críticas (afectan comportamiento o seguridad)
1. [Archivo] — [Descripción del problema] — [Corrección propuesta]

### 🟡 Menores (inconsistencias de patrón o nomenclatura)
1. [Archivo] — [Descripción del problema] — [Corrección propuesta]

### ✅ Correcto
- Lista de aspectos que cumplen correctamente con los estándares
```

No hacer cambios sin listar primero las inconsistencias y esperar confirmación.

---

## 13. Orden de Revisión Recomendado

1. `auth` — módulo base, otros dependen de él
2. `services` — gestión de categorías y servicios
3. `appointments` — lógica más compleja
4. `holidays` — módulo más reciente, más limpio
5. `notifications` — módulo de soporte
6. `payments` — módulo de soporte

---

*Skill creada el 2026-05-30 | Versión 1.2 | Proyecto: Turnity Backend*
