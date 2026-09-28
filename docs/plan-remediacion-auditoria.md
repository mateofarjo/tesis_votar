# Plan de remediación de hallazgos de seguridad

Fecha de revisión: 2026-09-25.

Este documento contrasta el informe recibido con el árbol de trabajo actual. No
incluye la ejecución de cambios ni la inspección de secretos/despliegues de
producción. Las modificaciones no confirmadas que ya existen en este árbol
(`app/api/voto`, `app/api/generar-token` y el flujo de firma ciega) se trataron
como código vigente para esta revisión.

## Resultado de la verificación

| Nº | Estado | Evidencia resumida |
| --- | --- | --- |
| 1 | Confirmado, crítico | `verificarToken` acepta cualquier token no vacío de hasta el tamaño del módulo y aplica RSA crudo, sin padding ni codificación de dominio. |
| 2 | No reproducido en el flujo actual | `/api/voto` ya no usa sesión ni consulta `VoteToken`; el servidor guarda valores **cegados** al emitir la credencial, no el token final ni el candidato. |
| 3 | No reproducido en el flujo actual | Tras `tx.wait()` no se actualiza al votante. Además, la emisión ya bloquea una segunda credencial `EMITIDO` o `CONSUMIDO` para el mismo votante. |
| 4 | Confirmado | El flujo activo compara hashes de payloads biométricos de sesiones distintas como alternativa. Esos payloads incluyen datos variables de la sesión. `matchedVendorData` solo vincula el webhook con el `vendorData` asignado, no demuestra por sí mismo igualdad facial con el registro. |
| 5 | Confirmado, limitación de diseño | El evento `VotoEmitido(bytes32 indexed tokenHash, uint8 candidatoId)` publica ambos valores y el votante puede conservar la transacción. |
| 6 | Confirmado | `GET /api/resultados` devuelve conteos para cualquier estado y `/resultados` los actualiza cada 8 segundos. |
| 7 | Confirmado | `test/VotacionContract.ts` usa RSA de 12 bits (`n = 3233`). |
| 8 | Confirmado | El login de votante autentica solamente con DNI. |
| 9 | Parcialmente vigente | No se persiste el instante del voto en el endpoint actual, pero quedan trazas temporales de login, liveness y emisión de credencial que pueden correlacionarse con una transacción en elecciones pequeñas. |
| 10 | Confirmado, limitación arquitectónica | Hay una única autoridad/clave RSA. |
| 11 | Confirmado | `lib/rateLimit.ts` usa un `Map` en `globalThis`, no un almacén compartido. |
| 12 | Parcialmente confirmado | Reintentos secuenciales son idempotentes porque un intento no pendiente se devuelve como ya procesado. Dos webhooks simultáneos aún pueden leer `PENDIENTE` antes de que alguno lo actualice: no hay una toma atómica del intento. |
| 13 | Pendiente de comprobar en despliegue | El diseño lee claves desde variables de entorno. La presencia, rotación y gestor de secretos de producción no puede verificarse desde el repositorio. |
| 14 | Confirmado | NextAuth usa JWT de 8 horas sin lista de revocación. |
| 15 | Confirmado | La ventana biométrica es configurable pero su valor por defecto de 15 minutos no tiene justificación documentada. |
| 16 | Confirmado como limitación del entorno | Hay despliegue/configuración de Sepolia; no ofrece garantías de disponibilidad o permanencia equivalentes a una red de producción. |

## Fase 0 — Contención antes de una elección

1. **No abrir la urna con el contrato actual.** El hallazgo 1 permite aceptar
   mensajes RSA que no corresponden a un token aleatorio de tamaño fijo.
2. Desplegar un contrato nuevo después de la corrección; no es posible reparar
   la verificación de un contrato ya desplegado sin una función de actualización.
3. Mantener los resultados no públicos mientras se complete la Fase 2.
4. Documentar públicamente las limitaciones 5, 10 y 16 si el proyecto se usa
   como prototipo académico. No presentarlo como sistema apto para una elección
   vinculante hasta cerrar las fases críticas.

## Fase 1 — Integridad criptográfica y pruebas (crítica)

### 1. Reemplazar RSA crudo en `VotacionContract`

- Definir un formato de credencial versionado y de longitud estricta. Como
  contención mínima, exigir `token.length == 32` y
  `signature.length == modulus.length` antes de llamar al precompilado.
- No considerar esa contención la solución criptográfica definitiva. Migrar la
  firma ciega a una construcción de dominio completo: codificar el token con
  hash-to-integer/FDH antes del cegado y verificar en el contrato que
  `s^e mod n` equivale a esa codificación. Evaluar RSA-PSS ciego solo si la
  biblioteca y el protocolo elegido soportan cegado de manera segura.
- Rechazar valores cero, valores mayores o iguales al módulo y codificaciones
  no canónicas tanto en cliente/servidor como en Solidity.
- Versionar la clave y la codificación en los artefactos de despliegue para que
  un relayer no mezcle credenciales viejas y nuevas.

**Pruebas de aceptación**

- Generar una clave RSA fija de 2048 bits para fixtures (nunca una clave de
  producción) y ejecutar la ruta real de 256 bytes.
- Añadir casos con firma multiplicada/potenciada, token de 31, 33 y 256 bytes,
  firma demasiado corta/larga, cero y valores fuera de rango; todos deben
  revertir salvo la credencial canónica válida.
- Medir gas de verificación de 2048 bits y fijar un umbral razonable en pruebas.
- Ejecutar `npm run test:contracts` y una prueba de integración de cegado,
  descegado y voto.

## Fase 2 — Secreto del voto y publicación de resultados (alta)

### 2. Evitar resultados parciales

- En `app/api/resultados/route.ts`, consultar primero el estado de la urna.
  Si no es `FINALIZADA`, devolver únicamente estado y fechas, sin candidatos,
  total ni porcentajes.
- Cambiar `/resultados` para mostrar un aviso de urna abierta/cerrada y no
  iniciar el sondeo de resultados hasta la finalización.
- Probar respuestas para `CERRADA`, `ABIERTA` y `FINALIZADA`.

### 3. Tratar el recibo verificable como limitación de protocolo

- Registrar en la tesis y en la UI que el evento actual permite al votante
  demostrar su selección. No afirmar resistencia a coacción o compra de voto.
- Para una futura versión, elegir explícitamente una propiedad objetivo:
  revoto que invalida votos anteriores, o sufragio cifrado con mezcla/apertura
  diferida (o cifrado homomórfico). Esto exige rediseño del contrato, conteo y
  auditoría; no es un cambio aislado del evento.

### 4. Reducir correlación temporal residual

- Mantener la separación actual: jamás registrar `voterId`, `voteTokenId`,
  candidato o token final en `/api/voto` ni en sus logs.
- Definir una política de retención y granularidad: redondear tiempos de
  auditoría visibles, restringir su acceso y eliminar trazas operativas cuando
  expire la necesidad de auditoría.
- Evaluar un relayer con cola y envío por lotes/demora acotada si el modelo de
  amenaza incluye observadores que correlacionan tiempos.
- Añadir una prueba/regla de revisión que falle si el endpoint de voto importa
  sesión, Prisma o acepta un identificador de votante.

## Fase 3 — Identidad, sesión y webhooks (alta)

### 5. Sustituir el falso comparador biométrico

- Eliminar `compareSha256Hashes(voter.biometricHash, biometricHash)` como
  decisión de identidad entre sesiones en `identityVerificationWorkflow.ts`
  (y el flujo Veriff heredado si permanece habilitado).
- Configurar al proveedor para enlazar la sesión de liveness con la identidad o
  retrato de la sesión de registro y consumir su veredicto de coincidencia y
  score. Validar que ese dato corresponde a la sesión/identidad esperada, no
  solo que `vendorData` coincide.
- Guardar `sessionId`, identificador del proveedor, veredicto, score,
  versión/reglas del workflow y un hash de integridad del payload; no usar el
  hash de un payload variable como plantilla facial.
- Antes de activar producción, hacer pruebas reales de: misma persona, persona
  distinta, liveness aprobado sin match, reintentos y payload incompleto.

### 6. Endurecer login y sesión

- Sustituir el login por DNI por un segundo factor verificable (OTP enviado a
  un canal previamente validado, clave/credencial del padrón o passkey). El DNI
  debe ser identificador, no secreto.
- Limitar intentos con un backend compartido y respuestas que no revelen si el
  DNI existe.
- Añadir revocación de sesión: `sessionVersion` por votante o tabla de sesiones
  con `jti`, revocación al completar el voto y al reportar incidente. Conservar
  el vencimiento de 8 h solo si la evaluación de riesgo lo justifica.

### 7. Hacer la toma de webhook atómica

- Reemplazar el patrón leer-`PENDIENTE`-actualizar por un `updateMany`/SQL
  condicional `WHERE id = ? AND status = 'PENDIENTE'`, o por una transacción
  con bloqueo de fila. Solo quien cambie una fila procesa y audita el resultado.
- Tratar el resultado de cero filas como éxito idempotente (HTTP 200), no como
  error.
- Añadir pruebas concurrentes con dos entregas del mismo webhook y verificar
  una sola transición y un solo log de decisión.

## Fase 4 — Operación y gobierno (media)

### 8. Rate limit distribuido

- Reemplazar el `Map` de `globalThis` por Redis/Upstash o una tabla PostgreSQL
  con operación atómica, TTL y claves por IP hasheada + cuenta cuando aplique.
- Definir límites separados para login, inicio de liveness, consulta de estado,
  emisión de credencial y webhooks. Probarlos con dos procesos/instancias.

### 9. Gestión de claves y autoridad

- Mover claves RSA y del relayer a un gestor de secretos con control de acceso,
  auditoría y rotación; no registrarlas ni exponerlas en respuestas o errores.
- Separar claves por elección, publicar la clave pública y un identificador de
  elección, y documentar revocación/rotación antes de abrir urna.
- Para reducir autoridad única, diseñar firma de umbral entre autoridades
  independientes. Declararlo trabajo futuro si queda fuera del alcance de la
  tesis.

### 10. Parámetros y entorno

- Justificar con evidencia o pruebas de usabilidad/fraude la ventana de
  liveness y TTL de credencial; documentar sus valores y quién puede cambiarlos.
- Etiquetar Sepolia como validación. Para una demostración con persistencia
  operacional, elegir una red de producción/L2 y documentar costes, plan de
  contingencia y archivado de eventos.

## Preservar las correcciones ya presentes

Antes de integrar cambios, conservar y cubrir con pruebas el flujo de firma
ciega actual: el navegador genera y descega el secreto; `/api/generar-token`
solo conoce el valor cegado y registra una credencial por votante; `/api/voto`
no requiere sesión ni enlaza el voto con `VoteToken`. Eliminar `voterId` de
`VoteToken` sin un mecanismo alternativo de cuota rompería esa última garantía;
la base puede conservar el vínculo con la **credencial cegada** para impedir una
segunda emisión, siempre que nunca almacene el token final ni el candidato.

## Orden de salida

1. Fase 1 completa, revisión criptográfica externa y redeploy.
2. Fases 2 y 3 completas con pruebas de integración/concurrencia.
3. Fase 4, ensayo de despliegue y revisión de secretos.
4. Simulación integral con la configuración de producción, luego apertura de
   una urna de prueba antes de cualquier demostración pública.
