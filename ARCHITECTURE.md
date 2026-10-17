# Architecture

## Vista general

```text
Clients
   |
   | HTTP / realtime
   v
+---------------------------+
| Go Match Service          |
|---------------------------|
| API/Gateway boundary      |
| Rooms & active players    |
| Authoritative race state  |
| Goroutines & channels     |
| Retry/timeout/fallback    |
| Circuit breaker/bulkhead  |
+-------------+-------------+
              |
              | PlayerProfilePort
              | gRPC + Protobuf
              v
        +-----------+
        |   Envoy   |  Ambassador / Load Balancer
        +-----+-----+
             / \
            /   \
           v     v
      +--------+ +--------+
      | Rust 1 | | Rust 2 |
      +---+----+ +----+---+
          \          /
           \        /
            v      v
           PostgreSQL
```

## Go Match Service

Go es dueño del estado runtime:

- sesiones y conexiones activas;
- salas y ciclo de vida de partidas;
- jugador dentro de carrera;
- tick autoritativo;
- inputs, snapshots y eventos;
- movimiento, boost, salto, colisiones, pickups, vidas y meta;
- reconexión;
- resultado autoritativo;
- coordinación del settlement con Rust.

La concurrencia debe ser real mediante goroutines, channels, `context.Context`, límites y cierre ordenado.

## Rust Player/Profile Service

Rust es dueño del estado persistente del jugador:

- perfil;
- inventario;
- catálogo;
- apariencia/equipamiento;
- compras;
- crafting;
- canjes;
- acreditación idempotente de resultados.

Las réplicas Rust no deben conservar estado crítico exclusivo en memoria.

## Clientes

Los clientes envían intención y renderizan/interpolan estado confirmado.

Nunca son autoridad de:

- posición final;
- vidas;
- pickups;
- ranking;
- recompensas;
- saldo.

## Comunicación

- **Cliente ↔ Go:** HTTP y canal realtime.
- **Go ↔ Rust:** gRPC + Protocol Buffers.
- **Go/Rust ↔ PostgreSQL:** solo sobre datos de su ownership.

## Patrones previstos

| Patrón | Aplicación |
| --- | --- |
| API Gateway | Go como frontera pública |
| Adapter | port interno + adaptador gRPC |
| Repository | PostgreSQL detrás de repositorios |
| Ambassador | Envoy delante de Rust |
| Circuit Breaker | protege Go frente a fallos repetidos |
| Retry | limitado a operaciones seguras/idempotentes |
| Timeout | deadline explícito para RPC |
| Fallback | la carrera continúa sin perfil/economía |
| Bulkhead | aislamiento de carga/dependencias |
| Observer/Pub-Sub interno | broadcast de eventos/snapshots |

### Reparto de resiliencia

- **Go:** timeout, circuit breaker, fallback y retry limitado.
- **Envoy:** load balancing, health checking y failover de instancia.
- **Rust:** operaciones idempotentes cuando admiten retry.

## Persistencia

Una sola instancia PostgreSQL con ownership lógico inicial:

- schema `match`: Go;
- schema `player`: Rust.

## Restricciones

1. Rust no es dueño del estado vivo de carrera.
2. Go no modifica directamente datos privados de Player/Profile.
3. El frontend no declara premios ni resultados.
4. Direcciones y secretos no se hardcodean.
5. Una caída de Rust no destruye una partida activa.
