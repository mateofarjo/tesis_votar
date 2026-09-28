# Vot.Ar: votación verificable con privacidad por diseño

## Resumen

Vot.Ar es un prototipo de votación electrónica que combina verificación de
identidad fuera de la cadena, credenciales anónimas firmadas a ciegas y una urna
auditables en blockchain. Su propósito es demostrar que una persona habilitada
puede emitir un voto verificable sin publicar su DNI, datos biométricos, cuenta
de usuario o sesión en la urna.

No es todavía un reemplazo de una elección pública vinculante. Es una base
académica y técnica que debe completar las medidas operativas y criptográficas
pendientes antes de aspirar a ese uso. La transparencia sobre esos límites es
parte de la seguridad del sistema.

## Qué problema resuelve

Los sistemas de votación digital deben satisfacer propiedades que suelen entrar
en tensión:

- **Elegibilidad:** solo votan personas incluidas en el padrón.
- **Unicidad:** una persona no obtiene más de una credencial de voto.
- **Secreto:** no debe existir un vínculo práctico entre identidad y elección.
- **Integridad:** el voto no se modifica ni desaparece después de emitirse.
- **Auditabilidad:** terceros pueden verificar el estado de la urna y el
  escrutinio publicado.

Vot.Ar separa deliberadamente la identidad del sufragio. El padrón y la
verificación se manejan fuera de la blockchain; la urna solo recibe una
credencial anónima válida y la opción elegida.

## Cómo funciona

```text
Registro y padrón             Emisión anónima                Urna pública
─────────────────             ───────────────                ────────────
Persona → identidad/liveness → token aleatorio → cegado → firma RSA
                                          │                       │
                                          └── descegado local ────┤
                                                                  ▼
                                                     token + firma + candidato
                                                                  │
                                                                  ▼
                                                   Contrato: valida y cuenta
```

### 1. Registro y autenticación

La persona completa una verificación documental y biométrica con un proveedor
de identidad. El sistema conserva identificadores técnicos, veredictos y hashes
de integridad; no usa el hash de dos capturas biométricas como si fuera un
comparador facial.

Tras un registro aprobado, la persona registra una **passkey**. En futuros
accesos, el DNI funciona como identificador y la passkey WebAuthn confirma la
posesión de una credencial criptográfica vinculada al dominio de Vot.Ar. Antes
de emitir una credencial de voto se exige además un liveness reciente vinculado
por el proveedor a la identidad de registro.

### 2. Credencial anónima mediante firma ciega

El navegador genera localmente un secreto aleatorio de 32 bytes. Antes de
firmarlo, calcula:

```text
SHA-256("VOT.AR/VOTE-CREDENTIAL/v1" || token)
```

El navegador ciega ese valor con la clave pública RSA de la autoridad. El
servidor comprueba que la persona está habilitada y firma únicamente el valor
cegado; por diseño, no conoce el token final que aparecerá en la cadena.

Luego el navegador descega la firma localmente. El resultado es una credencial
anónima: demuestra que la autoridad habilitó un voto, pero no revela qué
persona obtuvo esa credencial.

El sistema registra que un votante recibió una credencial, para impedir una
segunda emisión, pero no guarda el token final, el candidato ni el hash de la
transacción junto al votante.

### 3. Emisión y conteo

El endpoint de voto recibe solamente la credencial anónima y el candidato. No
requiere la sesión del votante ni consulta su identidad. Un relayer compartido
envía la transacción y paga el gas, evitando que la cuenta emisora identifique a
la persona.

El contrato exige:

- token canónico de 32 bytes;
- firma RSA del tamaño exacto de un módulo de 2048 bits;
- codificación del token separada por dominio antes de la verificación RSA;
- token no utilizado previamente;
- urna abierta y candidato válido.

Al aprobarse, la urna marca `keccak256(token)` como usado e incrementa el
contador del candidato. El código y los eventos on-chain permiten comprobar el
resultado publicado.

## Por qué el voto es intrazable en el flujo de aplicación

La propiedad buscada es evitar esta relación:

```text
voterId → token final → candidato
```

En la emisión de la credencial, el servidor observa `voterId → valor cegado`.
En la emisión del voto, observa `credencial anónima → candidato`. La operación
de cegado impide derivar el token final a partir del valor que el servidor
firmó. Además, los logs anónimos de voto no almacenan votante, candidato, IP ni
user-agent.

Esto no significa anonimato absoluto frente a todo adversario imaginable. Las
trazas temporales y los eventos de una blockchain pública deben considerarse en
el modelo de amenaza. Vot.Ar reserva los totales en su API hasta el cierre de la
urna, pero terceros aún pueden observar directamente la red pública.

## Controles de seguridad actuales

| Control | Propósito |
| --- | --- |
| Passkeys WebAuthn | Evitar que el DNI por sí solo permita iniciar sesión. |
| Liveness vinculado | Exigir una decisión reciente del proveedor contra la identidad registrada. |
| Firmas ciegas RSA | Separar la habilitación de la identidad y de la elección. |
| Dominio criptográfico del token | Evitar falsificaciones multiplicativas de RSA crudo. |
| Token de un uso | Impedir reutilizar una credencial en la urna. |
| Contrato on-chain | Mantener un conteo inmutable y verificable. |
| Resultados diferidos | No publicar conteos ni porcentajes antes de finalizar la urna. |
| Webhooks atómicos | Evitar procesar dos veces una misma decisión del proveedor. |
| Sesiones revocables | Invalidar JWT de votante aumentando su versión de sesión. |
| Rate limiting | Limitar abuso básico de endpoints; debe migrarse a backend compartido. |

## Qué puede verificarse públicamente

- La dirección del contrato y su código desplegado.
- El estado de la urna: cerrada, abierta o finalizada.
- Los candidatos y, tras el cierre, los totales y el resultado.
- Que un token no se haya utilizado dos veces.
- Que cada transacción aceptada cumplió la validación definida por el contrato.

## Limitaciones importantes

### No resistencia a coacción ni compra de votos

El evento on-chain vincula el hash de token con el candidato. Una persona que
conserve el hash de su transacción puede demostrar su selección. Por ello este
prototipo no afirma resistencia a coacción, compra de votos ni voto secreto
frente a un tercero que exige evidencias.

Resolverlo requiere un cambio de protocolo, no solo un cambio de interfaz:
revoto que invalide opciones anteriores, o sufragio cifrado con mezcla y apertura
diferida/cifrado homomórfico.

### Autoridad única

Una única autoridad controla la clave RSA que habilita credenciales. Aunque no
puede descifrar votos ajenos con esa clave, una autoridad maliciosa podría emitir
credenciales no solicitadas. La evolución adecuada es una firma de umbral entre
autoridades independientes.

### Blockchain pública y Sepolia

Sepolia es una red de pruebas. Sirve para validar el sistema, no para ofrecer
las garantías operativas de una red de producción. Una elección real necesitaría
una red de producción o L2 seleccionada por coste, disponibilidad, gobernanza y
capacidad de archivo.

## Pendientes antes de una demostración de producción

### Cierre de Fase 3

1. Aplicar las migraciones Prisma de webhook, sesión revocable y passkeys.
2. Configurar `NEXTAUTH_URL`, `WEBAUTHN_RP_ID` y `WEBAUTHN_RP_NAME` con el
   dominio HTTPS definitivo.
3. Ejecutar ceremonias WebAuthn reales de registro, login y revocación.
4. Validar con el proveedor de identidad el campo de match entre liveness y
   registro; probar misma persona, persona distinta y respuestas incompletas.

### Fase 4: operación y gobierno

1. Reemplazar el rate limit en memoria por Redis o PostgreSQL con operaciones
   atómicas y TTL.
2. Guardar la clave RSA y la del relayer en un gestor de secretos con rotación,
   auditoría y claves separadas por elección.
3. Diseñar firma de umbral para distribuir la autoridad electoral.
4. Justificar y probar los tiempos de liveness y de credenciales.
5. Definir retención, acceso y borrado de logs de auditoría.
6. Elegir infraestructura de producción, monitoreo, respaldo y plan de
   contingencia.
7. Realizar una auditoría criptográfica y de aplicación independiente.

## Cuándo podría complementar o reemplazar un sistema tradicional

Vot.Ar puede aportar auditabilidad y eficiencia a procesos internos,
universitarios, asociaciones, organizaciones y elecciones piloto cuando el
marco normativo lo permita. Para reemplazar una elección pública tradicional
necesitaría, además de las fases pendientes, validación legal, accesibilidad,
inclusión de personas sin dispositivos compatibles, auditorías independientes,
procedimientos de contingencia y garantías de secreto/coacción adecuadas a la
normativa electoral aplicable.

El valor del proyecto no está en prometer que blockchain soluciona por sí sola
la votación, sino en mostrar una arquitectura verificable que separa identidad,
autorización y elección, y que hace explícitas las garantías y los riesgos.
