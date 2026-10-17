# Contributing

## Metodología

Usamos **Fast Deployment** para entrega frecuente y **Kanban** para flujo de trabajo.

## Ramas

- `feature/<descripcion>`
- `fix/<descripcion>`
- `docs/<descripcion>`
- `chore/<descripcion>`

## Pull Requests

Todo cambio hacia `main` pasa por PR.

Debe:

- tener un objetivo claro;
- evitar cambios no relacionados;
- pasar CI;
- actualizar pruebas cuando aplique;
- actualizar docs si cambia contrato, arquitectura o despliegue.

## Definition of Done técnica

Según corresponda:

- compila;
- lint/format pasa;
- tests pasan;
- está integrado;
- CI queda verde;
- docs/contratos quedan actualizados;
- es demostrable.

## Commits

```text
feat(go): add room lifecycle
feat(rust): add profile repository
fix(realtime): ignore stale input sequence
chore(ci): validate compose configuration
docs: document service boundaries
```

`main` debe mantenerse cerca de un estado desplegable.
