# Conectar el perfil y las operaciones online

**15 de octubre de 2026.** El front prepara una cartera online separada del progreso de este navegador. El proveedor continúa desconectado: esta entrega no crea cuentas, endpoints ni una base de datos. Los tipos de [contracts-proposed.ts](contracts-proposed.ts) son una propuesta para acordar con backend.

`dist/online-profile.js` contiene la frontera de datos confirmados. No llama a `localStorage`, no aplica `transact` de la economía local y no calcula premios de carreras. Las pruebas usan proveedores controlados; esos proveedores no forman parte del producto.

En `dist/backend-config.js`, implementar `profileAdapter` junto con `backendAdapter`, usando la misma cuenta autenticada. **Mi progreso** permite consultar el perfil y elegir su ámbito; tienda, taller, canje y apariencia se conectan a ese almacén en `app.js`. Sin proveedor, Online queda deshabilitado. Una carrera local cambia al ámbito local; abrir una sala conectada exige cargar el perfil online y validar su identidad al iniciar. No hay interfaz de inicio/cierre de sesión todavía: un cambio de cuenta deberá cerrar la sala y reiniciar el almacén antes de cargar la nueva identidad.

## Adaptador esperado

```ts
interface ProfileAdapter {
  getProfile(options: {signal: AbortSignal}): Promise<ProfileEnvelope>;
  performAction(
    request: ProfileActionRequest,
    options: {signal: AbortSignal}
  ): Promise<ProfileEnvelope>;
}
```

`getProfile` devuelve la cuenta autenticada por el servicio. El front no envía un identificador de cuenta elegido por el jugador. La autenticación, las credenciales y el transporte los implementa el proveedor que acuerde el equipo; no se presupone HTTP, WebSocket ni una biblioteca concreta.

`performAction` recibe únicamente intención e identificador de operación:

```json
{
  "requestId": "b16df023-3a83-49ad-8ba3-4870bde8e120",
  "action": {"type": "exchange", "material": "plastic", "amount": 3}
}
```

Las acciones admitidas son `buy`, `craft`, `equip`, `appearance` y `exchange`. No se admite `finish`, ni se envían precios, saldo resultante, cantidad de monedas a conceder o materiales de premio. El servidor valida catálogo, propiedad y recursos y confirma la operación en una transacción persistente.

## Respuesta y revisiones

La lectura devuelve `{playerId, profileRevision, profile}`. Una operación añade el mismo `requestId` recibido. `profile` usa `version: 1`, los contadores `coins`, `plastic`, `metal`, `totalCleaned`, `races`, y las colecciones `owned`, `equipped`, `appearance`. No incluye `settled`, que sólo es el historial limitado del guardado local.

El front verifica tipos, contadores enteros entre 0 y 999.999.999, IDs del catálogo conocido, propiedad del equipo y opciones de apariencia. Los IDs de cuenta/operación son cadenas sin espacios en los extremos ni caracteres de control y de hasta 128 caracteres. Una respuesta incompatible conserva el último perfil confirmado y no acredita recursos.

`profileRevision` es un entero seguro no negativo de esa cuenta. El servicio debe mantenerlo creciente cuando cambie el perfil. Las revisiones anteriores no sustituyen una cartera más reciente. El `playerId` debe permanecer estable durante la sesión: una cuenta distinta exige reiniciar explícitamente la sesión de perfil.

`profile.updated` puede adelantar una actualización confirmada de la misma cuenta. Si lleva el `requestId` de la operación pendiente, puede confirmar esa operación aunque la respuesta original todavía no haya llegado. La posterior respuesta de una solicitud invalidada no vuelve a aplicarse. Una revisión reciente recibida por evento se conserva aunque una confirmación posterior de la operación corresponda a una revisión anterior ya conocida.

El servidor debe actualizar el perfil después de acreditar una carrera por su propia autoridad. `race.ended` describe el resultado y lo concedido; no autoriza al front a sumarlo de nuevo a ninguna cartera.

## Errores, reintentos e idempotencia

El store permite una sola operación económica pendiente. Mientras espera, conserva los saldos confirmados. Una compra, un canje o una fabricación no se muestran como realizados por el mero envío de la solicitud.

Los rechazos de negocio conocidos se lanzan como `{code, requestId?}`: `INVALID_ACTION`, `INVALID_ITEM`, `INSUFFICIENT_COINS`, `INSUFFICIENT_MATERIALS`, `NOT_OWNED`, `ALREADY_OWNED`, `INVALID_APPEARANCE` o `SESSION_REQUIRED`. Un rechazo definitivo significa que la operación no produjo cambios. El proveedor no debe convertir un fallo de red después de enviar en un rechazo definitivo. Si añade `requestId`, debe ser el de la solicitud rechazada.

Un fallo de transporte, una respuesta incompatible o un tiempo de espera agotado después del envío dejan la operación en estado `uncertain`. El front no sabe si el servidor alcanzó a aplicarla. «Reintentar» envía **la misma acción con el mismo `requestId`**. Hasta resolverla, no admite otra operación económica.

Backend necesita unicidad persistente por **cuenta + `requestId`**, almacenar la respuesta definitiva y devolverla a los reintentos sin descontar o conceder dos veces. El mismo identificador con otra acción debe rechazarse. La idempotencia no puede depender de que una pestaña siga abierta.

El timeout del cliente es de 12 segundos por defecto. El adaptador debe respetar `AbortSignal` para liberar trabajo de transporte; abortar una espera no garantiza que una transacción ya recibida por el servidor haya sido cancelada. La operación incierta se guarda sólo en memoria durante esta preparación: si se recarga la página, backend debe seguir conservando la integridad e idempotencia del saldo. Una recuperación de operaciones pendientes entre recargas requerirá un contrato adicional.

## API del store y estados

`createOnlineProfileStore({adapter})` publica `state`, `subscribe`, `load`, `transact`, `retry`, `accept`, `reset` y `dispose`.

| Estado | Significado |
|---|---|
| `unconfigured` | Falta un proveedor con las dos operaciones requeridas. |
| `idle` | Proveedor presente; aún no se ha cargado la cuenta. |
| `loading` | Lectura de cuenta pendiente. |
| `ready` | Perfil confirmado disponible; un rechazo de negocio puede acompañarlo. |
| `pending` | Operación enviada y todavía sin confirmación. |
| `uncertain` | Resultado desconocido; sólo puede reintentarse la misma operación. |
| `error` | La lectura o la identidad no pudieron confirmarse. |

`accept(envelope)` recibe actualizaciones confirmadas. `reset` y `dispose` abortan las esperas e invalidan callbacks tardíos. No transfieren ni mezclan recursos con el guardado local.

## Verificación conjunta pendiente

Con el servicio real, comprobar compra/canje/fabricación confirmados, rechazo sin descuento, doble pulsación, pérdida de la respuesta después de aplicar una transacción, reintento del mismo ID, actualización por evento antes de la respuesta, cierre/recarga y cambio de cuenta. Los resultados de carrera deben acreditarse una sola vez por participante y permanecer separados de los materiales de las carreras locales.

El catálogo actual sigue integrado en el front. Una reconciliación dinámica de catálogo/versiones y la autenticación real requieren acuerdo con backend antes de habilitar el proveedor.
