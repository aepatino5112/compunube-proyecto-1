# C19 · Actores, casos de uso y flujos online

**Alcance:** comportamiento diseñado del MVP online de Compunube; **no está implementado**. Este catálogo deriva del [GDD v1](../product/game-design-document-v1.md), [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md), [B16](../product/authoritative-race-rules.md) y [B17](../product/multiplayer-room-lifecycle.md). Describe resultados observables y autoridades, sin elegir proveedor de autenticación, endpoint, payload o transporte. La demo local B08 y los DTO del frontend son antecedentes, no contratos vigentes.

## Actor y participantes

El **Jugador** es el **actor externo primario** del sistema completo **Compunube Online**: inicia acciones y recibe confirmaciones o errores. Docentes/facilitadores pueden observar la experiencia, pero no tienen acciones online exclusivas en este MVP. Para el diagrama de casos de uso C20, **Frontend, Go, Rust, PostgreSQL y Envoy son internos**, no actores externos.

| Participante interno | Responsabilidad en los flujos |
| --- | --- |
| **Frontend web / futuro Python** | Captura intención y presenta estado, resultado y perfil confirmados; no calcula autoridad de carrera o economía. |
| **Go Match Service** | Frontera pública; confirma sesión operativa, sala, carrera, objetos, snapshots, resultado y coordina settlement. |
| **Rust Player/Profile Service** | Perfil, catálogo, inventario, canje, compra, crafting, equipamiento y settlement idempotente. |
| **PostgreSQL** | Persistencia durable bajo ownership lógico `match` de Go y `player` de Rust; no decide reglas de negocio. |
| **Envoy** | Infraestructura entre Go y réplicas Rust cuando hay comunicación interna; no es un caso de uso del Jugador. |

En cada ficha, **Actor** es siempre Jugador; las acciones automáticas de Go/Rust son respuestas internas a su participación. **Dueño** indica quién confirma el hecho de negocio, no quién dibuja la pantalla. Los estados `finished`, `disqualified`, `left` y DNF, el plazo de 15 s y el de 45 s se rigen por B16–B17. `SESSION_REQUIRED`, `ROOM_NOT_FOUND`, `ROOM_FULL` e `INCOMPATIBLE_VERSION` son conceptos de error ya documentados en B10; E43 definirá su forma contractual.

## Catálogo

### UC-01 · Establecer o recuperar sesión y perfil

- **Actor / precondiciones / disparador:** Jugador; desea modo online; selecciona «Jugar con amigos» o vuelve tras perder una sesión utilizable.
- **Flujo principal:** frontend solicita sesión; Go confirma identidad de jugador; Rust entrega perfil y catálogo por la frontera de Go; frontend muestra datos confirmados.
- **Alternos/errores:** sin sesión válida → `SESSION_REQUIRED` y opción de establecer/recuperar o volver; perfil indisponible → espera/reintento, sin usar `localStorage` como perfil online.
- **Postcondición / dueño / fuentes:** identidad y perfil online confirmados o acceso detenido sin saldo ficticio; **Go+Rust**; [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md), [GDD](../product/game-design-document-v1.md).

### UC-02 · Seleccionar apariencia y equipo permitido

- **Actor / precondiciones / disparador:** Jugador; UC-01 confirmado; elige personaje, apariencia o equipo.
- **Flujo principal:** frontend presenta catálogo/propiedad confirmados; Jugador solicita opción; Rust valida permiso/propiedad y confirma perfil; frontend refleja el cambio.
- **Alternos/errores:** opción no poseída o perfil indisponible → rechazo, conservar último perfil confirmado; una preferencia local solo puede proponerse si es válida online.
- **Postcondición / dueño / fuentes:** apariencia/equipo confirmado sin cambiar estadísticas de carrera; **Rust**; [B08](../product/frontend-baseline.md), [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md).

### UC-03 · Crear sala y fijar mapa

- **Actor / precondiciones / disparador:** Jugador; sesión válida; elige crear con Maracaibo u Orinoco.
- **Flujo principal:** Go crea sala en LOBBY, confirma código/ID, mapa fijo, creador como miembro y compatibilidad; frontend presenta la sala real.
- **Alternos/errores:** sesión o versión incompatible → rechazo sin sala fabricada; fallo de creación → permitir reintentar o volver.
- **Postcondición / dueño / fuentes:** sala confirmada con mapa inmutable durante su vida; creador sin autoridad de carrera; **Go**; [B09](../product/multiplayer-decisions.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-04 · Entrar a sala por código/ID

- **Actor / precondiciones / disparador:** Jugador; sesión válida; introduce un código/ID de sala.
- **Flujo principal:** Go valida sala en LOBBY, espacio hasta cuatro, sesión/versión y confirma membresía; frontend muestra mapa y miembros confirmados.
- **Alternos/errores:** `ROOM_NOT_FOUND`, `ROOM_FULL` o `INCOMPATIBLE_VERSION` → permanecer en entrada y poder corregir/reintentar; COUNTDOWN/RACING/RESULTS no admiten nuevo join.
- **Postcondición / dueño / fuentes:** miembro confirmado o ninguna entrada; **Go**; [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-05 · Elegir Reducir y confirmar preparación

- **Actor / precondiciones / disparador:** Jugador; miembro en LOBBY con perfil, recursos y equipo válidos; elige botella reutilizable o desechable y solicita `ready`.
- **Flujo principal:** Go confirma la elección para esa participación y luego `ready`; frontend presenta ambas confirmaciones. La opción reutilizable representa Reducir, sin ventaja competitiva.
- **Alternos/errores:** elección/perfil/equipo sin confirmar → seguir `not_ready`; cambiar preparación o retirar `ready` antes del inicio revoca preparación y cancela COUNTDOWN si corresponde.
- **Postcondición / dueño / fuentes:** participación preparada con elección trazable o permanece `not_ready`; **Go** para participación, Rust para validez de perfil; [B14](../product/three-r-design.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-06 · Recibir cuenta atrás sincronizada

- **Actor / precondiciones / disparador:** Jugador; sala con 2–4 humanos y todos `ready` confirmados; Go detecta esa condición.
- **Flujo principal:** Go pasa a COUNTDOWN de 3 s, confirma roster, mapa y versiones; frontend muestra inicio común; al terminar Go inicia RACING con salida en Z=0.
- **Alternos/errores:** cambia miembro, preparación o `ready` antes de salir → Go cancela y vuelve a LOBBY; incompatibilidad → no iniciar con reglas/curso distintos.
- **Postcondición / dueño / fuentes:** carrera común iniciada o countdown cancelado; **Go**; [B09](../product/multiplayer-decisions.md), [B16](../product/authoritative-race-rules.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-07 · Participar en carrera autoritativa

- **Actor / precondiciones / disparador:** Jugador; participación `racing`; usa giro, lado de red, impulso o salto.
- **Flujo principal:** frontend envía solo intenciones; Go valida identidad, orden y rango, simula `surf-mvp-1` y publica estado recuperable; frontend presenta posiciones, vida, energía y progreso confirmados.
- **Alternos/errores:** entrada inválida, duplicada o terminal → no altera estado; pérdida de foco libera controles sin pausar sala; conexión perdida conduce a UC-09.
- **Postcondición / dueño / fuentes:** estado de carrera autoritativo avanza para todos; **Go**; [B13](../product/core-gameplay-loop.md), [B16](../product/authoritative-race-rules.md).

### UC-08 · Recoger objeto y recibir feedback

- **Actor / precondiciones / disparador:** Jugador; `racing`, objeto disponible y contacto lógico elegible durante UC-07.
- **Flujo principal:** Go adjudica residuo o salvavidas a un único jugador; actualiza objeto y, según tipo, energía/materiales de carrera o vida; frontend muestra efecto y contadores confirmados.
- **Alternos/errores:** contacto inelegible o pickup disputado perdido → no concede objeto; evento perdido → snapshot reconstruye propietario. Recogida de jugador luego DQ/left/DNF sigue contando para agua, no para premio.
- **Postcondición / dueño / fuentes:** objeto disponible→recogido una sola vez o sin cambio; **Go**; [B09](../product/multiplayer-decisions.md), [B15](../product/water-objective.md), [B16](../product/authoritative-race-rules.md).

### UC-09 · Reentrar tras desconexión accidental

- **Actor / precondiciones / disparador:** Jugador; conexión se pierde durante RACING; intenta volver con la misma identidad/sesión dentro de **15 s**.
- **Flujo principal:** Go mantiene simulación y entrada neutral, valida retorno y entrega snapshot completo; frontend reconstruye curso, objetos, jugador y reloj antes de reanudar la vista.
- **Alternos/errores:** identidad ajena o plazo vencido → no reasigna participante; al vencer queda `left` y 0 premio. Si llegó o fue descalificado durante el corte, conserva ese estado terminal.
- **Postcondición / dueño / fuentes:** participación reanudada desde verdad de Go o terminada `left`; **Go**; [B09](../product/multiplayer-decisions.md), [B13](../product/core-gameplay-loop.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-10 · Abandonar voluntariamente una carrera

- **Actor / precondiciones / disparador:** Jugador; participación en RACING; confirma intención de salir.
- **Flujo principal:** frontend solicita salida; Go marca `left` de inmediato y detiene intenciones de esa participación; la carrera de los demás continúa.
- **Alternos/errores:** cancela confirmación → sigue participando; solicitud duplicada → no duplica efecto ni premio.
- **Postcondición / dueño / fuentes:** `left` con 0 materiales de esa carrera; recogidas previas siguen en objetivo de agua; **Go**; [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-11 · Terminar participación y esperar al grupo

- **Actor / precondiciones / disparador:** Jugador; carrera activa; Go detecta meta, 0 vidas o vencimiento global.
- **Flujo principal:** Go marca `finished`, `disqualified` o DNF según B16, deja de aceptar input terminal y mantiene a los demás; frontend muestra espera/espectador hasta resultado global.
- **Alternos/errores:** `left` por UC-09/10; sin primer `finished`, Go cierra cuando todos ya son terminales; al vencer 45 s tras primera llegada, activos/reconectando quedan DNF.
- **Postcondición / dueño / fuentes:** condición individual definitiva, sin detener partida ajena; **Go**; [B09](../product/multiplayer-decisions.md), [B16](../product/authoritative-race-rules.md), [B17](../product/multiplayer-room-lifecycle.md).

### UC-12 · Consultar resultado y cuidado del agua

- **Actor / precondiciones / disparador:** Jugador; Go cerró globalmente la carrera; abre o recibe resultado.
- **Flujo principal:** frontend presenta estado/puesto competitivo, objetos propios y grupo retirados/restantes, y premio económico como lectura separada; solo `finished` tiene puesto numérico.
- **Alternos/errores:** perfil/settlement aún pendiente → conservar resultado Go y mostrar espera de perfil; sin premio → mantener contribución al agua y feedback de Reducir confirmado.
- **Postcondición / dueño / fuentes:** resultado autoritativo visible sin confundir objetos virtuales con impacto real; **Go**; [B12](../product/educational-goals.md), [B14](../product/three-r-design.md), [B15](../product/water-objective.md), [B16](../product/authoritative-race-rules.md).

### UC-13 · Confirmar settlement y perfil

- **Actor / precondiciones / disparador:** Jugador; resultado Go disponible; espera, consulta o reintenta ver perfil confirmado.
- **Flujo principal:** Go coordina acreditación única por carrera/jugador; Rust aplica settlement idempotente y confirma perfil; frontend separa resultado de estado de perfil y solo muestra nuevo saldo tras confirmación.
- **Alternos/errores:** Rust no disponible, timeout o respuesta perdida → estado pendiente/reconsulta segura, sin sumar saldo local ni repetir efecto; `disqualified`/`left`/DNF acreditan 0.
- **Postcondición / dueño / fuentes:** perfil actualizado una vez o pendiente explícito sin premio ficticio; **Go+Rust**; [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md), [B13](../product/core-gameplay-loop.md), [GDD](../product/game-design-document-v1.md).

### UC-14 · Canjear materiales por monedas

- **Actor / precondiciones / disparador:** Jugador; perfil online confirmado y saldo suficiente; solicita Canjear.
- **Flujo principal:** Rust valida material/cantidad/saldo, consume materiales y acredita monedas en una operación atómica e idempotente; frontend muestra perfil y recibo confirmados, vinculados con Reciclar.
- **Alternos/errores:** saldo insuficiente, material inválido o respuesta incierta → sin gasto optimista; reintento seguro reconoce la misma operación sin duplicar monedas.
- **Postcondición / dueño / fuentes:** saldo/materiales confirmados una vez o sin cambio; **Rust**; [B08](../product/frontend-baseline.md), [B14](../product/three-r-design.md), [B10](../product/online-player-flow.md).

### UC-15 · Fabricar una red

- **Actor / precondiciones / disparador:** Jugador; perfil confirmado, receta válida, materiales suficientes y red no poseída; solicita fabricar en Taller.
- **Flujo principal:** Rust descuenta materiales y concede la red en una operación atómica e idempotente; frontend presenta objeto y nuevo perfil confirmados, vinculados con Reutilizar.
- **Alternos/errores:** receta inválida, material insuficiente, objeto ya poseído o respuesta incierta → sin fabricación/gasto ficticio; reintento no duplica concesión.
- **Postcondición / dueño / fuentes:** red poseída y materiales descontados una vez o sin cambio; **Rust**; [B08](../product/frontend-baseline.md), [B14](../product/three-r-design.md), [GDD](../product/game-design-document-v1.md).

### UC-16 · Comprar o equipar cosméticos

- **Actor / precondiciones / disparador:** Jugador; perfil/catálogo confirmados; selecciona comprar o equipar un artículo permitido.
- **Flujo principal:** Rust valida precio/propiedad y confirma compra atómica o equipamiento de objeto poseído; frontend muestra propiedad, saldo y equipo confirmados. Comprar no equipa por sí solo.
- **Alternos/errores:** saldo insuficiente, artículo inválido/no poseído o respuesta incierta → conservar último perfil confirmado; reintento de compra no duplica gasto.
- **Postcondición / dueño / fuentes:** cosmético poseído/equipado conforme a acción confirmada o perfil sin cambio; **Rust**; [B08](../product/frontend-baseline.md), [B09](../product/multiplayer-decisions.md), [B10](../product/online-player-flow.md).

### UC-17 · Repetir carrera o salir

- **Actor / precondiciones / disparador:** Jugador; sala en RESULTS y resultado global confirmado; elige repetir en la sala o salir al inicio.
- **Flujo principal:** si permanece, Go devuelve miembros a LOBBY como `not_ready` con el mismo mapa; cada uno confirma perfil actualizado y nueva decisión de Reducir antes de UC-05/06. Si sale, Go quita membresía; al quedar vacía, sala CLOSED.
- **Alternos/errores:** perfil pendiente → no marcar `ready`; un solo miembro → LOBBY espera otro; código CLOSED no admite reentrada.
- **Postcondición / dueño / fuentes:** siguiente preparación en misma sala o salida confirmada; **Go**; [B10](../product/online-player-flow.md), [B14](../product/three-r-design.md), [B17](../product/multiplayer-room-lifecycle.md).

## Flujos críticos para revisión y pruebas posteriores

| Flujo | Secuencia y comprobación clave |
| --- | --- |
| Entrada completa | **UC-01 → 02 → 03/04 → 05 → 06 → 07/08 → 11 → 12 → 13**. Ninguna pantalla trata intención como confirmación; la carrera necesita 2–4 humanos ready. |
| Corte y reentrada | **UC-07 → 09 → 07/11**. Go sigue simulando con entrada neutral y el snapshot recupera objetos/estado; identidad ajena o ventana vencida no recuperan el puesto. |
| Resultado y perfil | **UC-11 → 12 → 13**. Resultado Go no depende de respuesta inmediata de Rust; settlement repetido no duplica materiales. |
| Economía posterior | **UC-13 → 14/15/16**. Canje y fabricación compiten por el mismo saldo; operaciones inciertas se reconsultan/reintentan sin doble gasto. |
| Repetición o salida | **UC-12/13 → 17 → 05** si repite. Mapa fijo, todos `not_ready`, perfil y Reducir nuevos; si sale el último, código inutilizable. |

La [arquitectura](../../ARCHITECTURE.md) conserva Go como autoridad de sala/carrera y Rust como autoridad de perfil/economía; [C22](non-functional-requirements.md) mantiene por separado rendimiento, resiliencia y demás requisitos no funcionales. C20 representará estos casos con **Jugador** como actor externo; C21 expresará sus resultados verificables como requisitos. **D28** y **E43** definirán runtime y contratos sin convertir este catálogo en API.
