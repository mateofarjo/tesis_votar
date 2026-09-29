# Instrumentación de la validación

Scripts que producen las mediciones reportadas en el capítulo de pruebas de la
tesis. No forman parte de la aplicación: existen para que los resultados
publicados puedan reproducirse.

## `correlacion-temporal.js`

Ataque de correlación temporal sobre la traza de auditoría (§18.6 de la tesis).
Se coloca en la posición de un operador con acceso de solo lectura a la base:
lee las emisiones de credencial (`TOKEN_GENERADO`, que conserva el id del
votante) y las confirmaciones de sufragio (`VOTO_CONFIRMADO`, que conserva el
hash de la transacción), y empareja cada emisión con la confirmación posterior
más próxima. Contrasta el resultado contra la verdad de referencia que deja la
prueba de integración en `/tmp/eleccion.json`.

Requiere la base con los datos de una ejecución del ciclo electoral completo.

    node scripts/qa/correlacion-temporal.js

Resultado obtenido sobre un padrón de 9 votantes: **9 de 9 vinculaciones
correctas**. Los intervalos medidos explican por qué: entre la emisión y el voto
del mismo votante median 8,8–9,8 s, mientras que entre votantes consecutivos
median 47,7–49,7 s, de modo que cada emisión tiene una única confirmación
plausible.

## `medir-gas.js` y `contracts/qa/GasProbe.sol`

Desglose del consumo de gas de `emitirVoto` (§18.8). `GasProbe` mide con
`gasleft()` el costo aislado de la llamada al precompilado `modexp` con los
mismos parámetros que usa el contrato (RSA-2048, `e` = 65537) y el de un
`SSTORE` sobre una posición nueva.

    npx hardhat compile
    node scripts/qa/medir-gas.js

Requiere un nodo local en `127.0.0.1:8545` y `.env.local` con
`PRIVATE_KEY_AUTORIDAD` y `RSA_PRIVATE_KEY_PEM`.

Resultado sobre la bifurcación Paris (EIP-2565 vigente):

| Componente | Gas | Participación |
|---|---|---|
| `modexp` (0x05) | 34.746 | 18,6 % |
| `SSTORE` de posición nueva | 22.113 | 11,8 % |
| Resto (storage, calldata, evento, costo base) | 130.288 | 69,6 % |
| **`emitirVoto` completo** | **187.147** | 100 % |

La verificación RSA no es, por tanto, la operación dominante.

## `linea-base-azar.js`

Estima por simulacion cuantos aciertos obtendria un adversario emparejando **al
azar** dentro de cada cubeta temporal. Sirve para decidir si el resultado del
ataque es o no distinguible del azar, en lugar de interpretar a ojo un
porcentaje.

    node scripts/qa/linea-base-azar.js <aciertos_medidos>

## Resultado antes y despues de las mitigaciones

Misma eleccion (9 votantes, distribucion declarada 4/3/2), mismo script de
ataque, ejecucion secuencial en ambos casos.

| | Aciertos | Δt emision → voto | Interpretacion |
|---|---|---|---|
| Sin mitigaciones | **9 de 9 (100 %)** | 8,8–9,8 s, frente a 47,7–49,7 s entre votantes | el padron se reconstruye por completo |
| Solo cubeteado de marcas | 6 de 9 (66,7 %) | 0,0 s | el orden fisico de las filas seguia filtrando la secuencia |
| Cubeteado + escritura diferida y barajada | **3 de 9 (33,3 %)** | 0,0 s | no distinguible del azar (p = 0,26) |

La linea base de azar para esta particion de cubetas es de 2,0 aciertos
esperados; obtener 3 o mas ocurre por azar el 26 % de las veces.

**Limite que conviene no ocultar:** una de las dos cubetas contenia un unico
votante, y esa persona queda identificada con certeza. El cubeteado no crea
anonimato donde no hay concurrencia; reparte la incertidumbre entre quienes
comparten ventana. En una eleccion real con votantes espaciados, la ventana debe
dimensionarse para que cada cubeta contenga varias personas, y aun asi los
extremos de la jornada quedan expuestos.
