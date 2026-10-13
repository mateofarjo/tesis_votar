# votar-relay — servicio de sufragio

Servicio que recibe las credenciales anonimas y las retransmite al contrato.
**Se despliega por separado del servicio de identidad**, y esa separacion es el
control de seguridad, no una convencion de organizacion del codigo.

## Por que esta separado

El protocolo de firma ciega impide que la autoridad vincule una credencial con la
sesion en que la firmo. Esa garantia se pierde si un mismo operador observa las
dos puntas: quien pidio una credencial y cuando se confirmo un voto. Mientras
ambos endpoints compartian proceso, base de datos y registros de acceso, el
operador las tenia a la vista y podia emparejarlas por proximidad temporal.

Separados, el mismo ataque exige el concurso de dos operadores con accesos
distintos sobre dos bases distintas.

## Lo que este servicio conoce

- La clave **publica** de la autoridad, leida del propio contrato.
- La clave de la billetera que paga el gas.
- Su propia traza de auditoria, sin identificadores de ninguna clase.

## Lo que no conoce, y no puede averiguar

- El padron: no tiene cadena de conexion a esa base.
- La sesion del votante: no acepta cookies ni cabeceras de autenticacion.
- La clave privada RSA: no puede emitir credenciales, solo verificarlas.

Estas fronteras estan cubiertas por `lib/separacionDeServicios.test.ts` en el
proyecto principal, que falla si algun modulo de este servicio importa el cliente
de base de datos del padron, usa su cadena de conexion, menciona la clave privada
o nombra un identificador de votante.

## El navegador lo alcanza directamente

La aplicacion de identidad **no** hace de intermediaria. Si enrutara el voto, su
servidor volveria a ver las dos puntas y la separacion no significaria nada. El
cliente lee `NEXT_PUBLIC_RELAY_URL` y envia la peticion a este servicio con
`credentials: "omit"`, de modo que el navegador no adjunte la sesion ni por
omision.

## Controles

1. Verificacion de la firma RSA fuera de la cadena antes de retransmitir.
2. Simulacion de la transaccion con una llamada estatica, que no consume gas.
3. Cola con demora aleatoria y barajado del lote, para que el orden on-chain no
   reproduzca el orden de llegada. Solo aporta con concurrencia.
4. Traza de auditoria con marca temporal cubeteada y escritura en lote barajado.

## Puesta en marcha local

    cp .env.example .env     # completar
    npm install
    npm start

El esquema de auditoria se crea solo al arrancar: la migracion es idempotente
(`CREATE TABLE IF NOT EXISTS`), de modo que no hay un paso manual que recordar.

## Despliegue

El servicio necesita un **proceso persistente**, no funciones sin servidor: la
cola de retransmision y el buffer de auditoria viven en memoria entre peticiones.
Cualquier proveedor que corra un contenedor sirve.

### Render (hay blueprint)

`render.yaml` define el servicio y su base de datos. En Render: **New >
Blueprint**, apuntar a este repositorio. Render toma `rootDir: relay` e ignora el
resto.

Quedan cuatro variables por completar en el panel, porque dependen del despliegue
y una es secreta:

| Variable | Que es |
|---|---|
| `RELAY_RPC_URL` | Nodo de la red donde vive el contrato |
| `RELAY_CONTRACT_ADDRESS` | Direccion del contrato desplegado |
| `RELAY_PRIVATE_KEY` | Clave de la billetera que paga el gas. **No** es la clave RSA de la autoridad: este servicio no puede emitir credenciales |
| `RELAY_ALLOWED_ORIGINS` | Origen de la aplicacion de identidad, para CORS |

`RELAY_DATABASE_URL` la completa Render desde la base del blueprint.

### Cualquier otro proveedor

Hay `Dockerfile`. Construye una imagen que corre como usuario sin privilegios y
expone el puerto 3100.

    docker build -t votar-relay .
    docker run --env-file .env -p 3100:3100 votar-relay

### Despues de desplegar

En el proyecto de la aplicacion de identidad, definir `NEXT_PUBLIC_RELAY_URL` con
la URL publica de este servicio y volver a desplegar. Sin esa variable, la cabina
muestra un aviso y no permite votar: es deliberado, porque un respaldo que
enrutara el voto por la aplicacion reintroduciria la correlacion que esta
separacion elimina.

La billetera de `RELAY_PRIVATE_KEY` debe tener fondos suficientes para el gas de
todos los sufragios previstos.

## Pendiente

El servicio corre en una infraestructura distinta, pero el votante todavia lo
alcanza por un canal que revela su direccion de red. Un canal que no la revele
—una red de anonimato o un intermediario que no registre— es lo que cerraria la
correlacion tambien frente a un adversario que observe el trafico.
