# Flujo De Voto Intrazable

Este proyecto no necesita crear una wallet descartable para cada voto. El votante
no envia la transaccion desde una wallet personal. La blockchain solo ve una
credencial anonima firmada y el candidato elegido.

## Objetivo

El objetivo de privacidad es evitar un vinculo como este:

```text
voterId -> tokenHash -> candidato
```

El contrato ya permite este modelo porque `emitirVoto` es una funcion publica y
autoriza el voto mediante una firma RSA, no mediante `msg.sender`.

## Flujo Actual

1. El votante inicia sesion y completa la verificacion biometrica fuera de la blockchain.
2. El navegador genera un secreto aleatorio canónico de 32 bytes.
3. El navegador calcula `SHA-256("VOT.AR/VOTE-CREDENTIAL/v1" || token)` y ciega
   ese digest separado por dominio con la clave publica RSA de la autoridad.
4. `/api/generar-token` verifica que el votante autenticado este habilitado.
5. El servidor firma solamente el valor cegado.
6. El servidor guarda que se emitio una credencial para ese votante. Por compatibilidad con la base de datos puede guardar hashes de los valores cegados, pero no guarda el `tokenHash` final on-chain, el token firmado final, el candidato ni el hash de la transaccion.
7. El navegador descega la firma localmente y construye `tokenFirmado` con el
   token de 32 bytes y la firma de 256 bytes.
8. `/api/voto` recibe solamente `tokenFirmado` y `candidatoId`.
9. La wallet relayer/de autoridad envia la transaccion al contrato.
10. El contrato reconstruye el digest separado por dominio, verifica la firma
    RSA, marca el hash del token como usado e incrementa el conteo del candidato.

## Que Ve La Blockchain

El contrato guarda y emite:

```text
tokenHash -> candidatoId
```

No guarda la cuenta del votante, DNI, datos biometricos, session ID ni ID de
usuario de la app. El remitente de la transaccion es la wallet relayer/de
autoridad, compartida por el sistema, por lo que no identifica al votante.

## Que Ve El Backend

Durante la emision de credencial, el backend ve:

```text
voterId -> blindedToken
```

Como el token esta cegado, el backend no puede derivar el `tokenHash` final que
aparecera en la blockchain.

Durante la emision del voto, el backend ve:

```text
tokenFirmado + candidatoId
```

El endpoint de voto no busca al votante autenticado y no une el voto con
`voterId` ni con `voteTokenId` en los logs de auditoria.

## Por Que No Hace Falta Una Burner Wallet

Una burner wallet solo cambia el remitente de la transaccion. No resuelve el
problema real de privacidad si el backend todavia puede vincular al votante con
el token o el candidato. Tambien puede agregar nuevas trazas, como transacciones
de fondeo para pagar gas.

Este proyecto usa una wallet relayer para pagar gas y firmas ciegas para la
privacidad. La wallet relayer paga la transaccion, mientras que la credencial
anonima demuestra que el voto es valido.

## Limitacion Importante

El evento on-chain vincula el hash del token con el candidato. Por tanto, el
hash de la transacción puede permitir que un votante demuestre su selección a
un tercero. Este prototipo **no** declara resistencia a coacción ni a compra de
votos; esa propiedad requeriría un rediseño con revoto o sufragio cifrado y
apertura diferida.

Los conteos y porcentajes se reservan en la API pública hasta que la urna esté
en estado `FINALIZADA`. Los eventos de una cadena pública siguen siendo
observables directamente: esta medida evita que la aplicación los amplifique,
no sustituye un protocolo de privacidad de resultados.

Despues de que el servidor firma una credencial cegada, no puede revocar esa
credencial sin conocer el token final. Por eso la implementacion emite solo una
credencial anonima por votante. Si el votante pierde la sesion del navegador
antes de emitir el voto, un flujo de recuperacion requeriria un protocolo mas
avanzado.

El valor `expiresAt` pertenece al registro off-chain de emision y al estado de
la UI. En este flujo de privacidad no es una expiracion criptografica on-chain,
porque validar la expiracion en el servidor durante la emision del voto exigiria
vincular el token final con el registro de base de datos emitido al votante.
