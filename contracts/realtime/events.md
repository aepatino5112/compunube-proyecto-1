# Realtime contract

Frontera conceptual cliente ↔ Go. El contrato exacto se cerrará en E43.

## Cliente → Go

- `room.ready`
- `room.leave`
- `race.input`

El cliente envía intención, no posición final, vidas, pickups, ranking o recompensas.

## Go → Cliente

- `room.state`
- `race.start`
- `race.snapshot`
- `race.event`
- `race.ended`

## Reglas

1. Mensajes versionados deben poder rechazarse si son incompatibles.
2. Inputs llevan secuencia monotónica por jugador.
3. Snapshots son estado autoritativo.
4. Reconexión recupera estado actual sin reproducir todo el historial.
