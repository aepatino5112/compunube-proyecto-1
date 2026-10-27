# Game Design Document v1.0

**Compunube · Surf Club** · **Fecha:** 17-10-2026 · **Alcance:** MVP educativo y multijugador online de 2–4 humanos. **Estado:** diseño de producto consolidado; el modo online descrito aquí **no está implementado**. La [línea base B08](frontend-baseline.md) distingue el prototipo jugable de las decisiones posteriores. Trello conserva el estado operativo; este documento expresa el diseño, no la finalización de su código.

## Visión, audiencia y premisa

La audiencia principal son adolescentes de educación media de **aproximadamente 12–17 años**, en sesiones breves de aula/laboratorio, demostraciones o uso individual guiado. Docentes, facilitadores y observadores universitarios son audiencia secundaria. La experiencia debe usar mensajes breves y concretos sin presuponer conocimientos de sostenibilidad o ciencias ambientales; la elección de audiencia es una decisión de diseño, no una conclusión de eficacia [B12](educational-goals.md).

La comunidad **Surf Club** compite surfeando recorridos estilizados inspirados en el **Lago de Maracaibo** y el **Río Orinoco**. Llegar primero es el objetivo competitivo; retirar residuos virtuales del recorrido es el objetivo compartido de cuidado del agua. El pulpo es una amenaza ficticia de gameplay, no una especie o consecuencia ambiental comprobada. La [narrativa B11](narrative-context.md) evita campaña, quests, NPC y progreso narrativo persistente.

## Estado real y alcance

| Estado | Qué comprende en este corte | Límite |
| --- | --- | --- |
| **Implementado local** | Web Surf Club con selección de Maracaibo/Orinoco; carrera de un humano y tres IA, red, salto, impulso, vidas, salvavidas, pulpo, meta y resultado; perfil offline, materiales, canje, tienda, Taller y cosméticos. | Todo se calcula en el navegador y el perfil se guarda en `localStorage`; no constituye autoridad online ni persistencia confiable. |
| **Preparado frontend** | Lobby, adaptadores de sesión/perfil inyectables, envío de intenciones y presentación de snapshots/eventos/resultados; perfil online separado en la UI. | Los proveedores siguen en `null`; las pruebas con dobles no demuestran sala real, autenticación ni settlement. |
| **Diseño online cerrado** | Decisiones B09–B17: 2–4 humanos sin bots, tres R, objetivo compartido de agua, reglas `surf-mvp-2`, ranking y ciclo de sala/reentrada. | Son especificaciones para implementar; no funciones jugables actuales. |
| **Pendiente implementación** | Identidad/perfil online real, Go autoritativo, Rust de negocio, contratos E43, estado de sala, decisión jugable de Reducir, HUD/resumen de agua, PostgreSQL de negocio, settlement, clientes integrados y cliente Python. | No se presentan como completados por documentación, skeleton o DTO propuestos. |

La web actual usa JavaScript/Three.js; **TypeScript es el objetivo de migración gradual**. La segunda interfaz funcional será **Python**, pendiente, según [ADR 0002](../adr/0002-client-language-strategy.md). El modo local sigue separado del perfil online y no migra monedas, materiales, compras o carreras de `localStorage` como verdad [B09](multiplayer-decisions.md).

## Loop del jugador y aprendizaje

1. **Preparación.** El jugador establece o recupera sesión online, recibe perfil/catálogo confirmados, elige mapa al crear una sala o entra por código, valida equipo/apariencia y elige para esa participación **botella reutilizable o desechable**. La primera opción representa **Reducir antes de generar un residuo potencial**; ambas permiten jugar y ninguna altera velocidad, vidas, ranking, premios o monedas. La decisión es diseño B14, aún no implementado.
2. **Sala y salida.** En LOBBY, Go confirma 2–4 humanos y `ready` de todos; el mapa queda fijo por la vida de la sala. COUNTDOWN dura 3 s comunes y puede cancelarse si cambia la preparación o membresía. Go fija roster, reglas y curso antes de RACING [B17](multiplayer-room-lifecycle.md).
3. **Carrera.** Cada cliente envía intención de giro, lado de red, impulso y salto; Go resuelve movimiento, objetos, daño, persecución y meta. El grupo recoge residuos **virtuales** del agua representada; el HUD propuesto separa objetos personales y total compartido retirado/restante de posición competitiva [B13](core-gameplay-loop.md), [B15](water-objective.md).
4. **Resultado.** Go cierra la carrera cuando todos son terminales o 45 s después del primer `finished`. La interfaz separa estado/puesto, contribución al objetivo de agua y materiales acreditables; Rust confirma después el perfil. Una recogida puede contar para el grupo aunque su recolector no reciba materiales [B16](authoritative-race-rules.md).
5. **Progreso y repetición.** Con materiales **efectivamente acreditados**, el jugador puede **Canjear = Reciclar** o **fabricar una red en Taller = Reutilizar**. Las mismas unidades no pueden gastarse dos veces. Para otra carrera en la sala, los miembros vuelven a `not_ready`, confirman perfil y toman una nueva decisión de Reducir; el mapa se conserva.

Los objetivos OE1–OE5 de [B12](educational-goals.md) trazan **acción → feedback → concepto**. Canje y fabricación existen en la demo local, pero su explicación educativa explícita está pendiente; Reducir es todavía diseño. El agua no es moneda, barra de pureza ni porcentaje de contaminación: su lectura es el número de objetos virtuales recogidos y restantes. Las decisiones educativas no prueban aprendizaje ni cambio de conducta.

## Reglas de carrera del MVP online

El ruleset vigente es **`rulesVersion = surf-mvp-2`** (curso doble que el inicial `surf-mvp-1`); [B16](authoritative-race-rules.md) contiene los umbrales, geometría y orden de adjudicación canónicos. Ambos mapas tienen manifiestos separados: **1800** unidades de recorrido (unos 1:50 min sin impulso), límite lateral **X ∈ [−15, +15]**, **113 obstáculos, 211 residuos y 21 salvavidas** por curso. Todos los humanos salen en **Z = 0**, en slots X no solapados del manifiesto, sin ventaja de tiempo o velocidad; countdown común de **3 s**.

| Sistema | Regla resumida de `surf-mvp-2` |
| --- | --- |
| Movimiento | Mismos parámetros para todos: crucero objetivo **16,4 unidades/s**, desplazamiento lateral hasta **10 unidades/s** con `steer` validado en [−1, +1]. Go calcula posición; el cliente no la declara. |
| Impulso y salto | Energía inicial 0; cada residuo confirmado suma **0,20** hasta 1; boost consume **0,25/s** y multiplica velocidad objetivo por **1,40**. Salto solo desde el agua, impulso vertical 6 y gravedad 16; sin doble salto. |
| Objetos y supervivencia | Red barrida y tabla adjudican residuos y salvavidas únicos. **3 vidas**; golpe válido resta 1 y concede **2,6 s** de protección; salvavidas recupera 1 hasta el máximo. Pickup disputado: menor distancia autoritativa del centro al barrido en el mismo tick; empate exacto por `playerId`. |
| Pulpo | Una persecución independiente por humano, con gap inicial 48, inicio tras 6 s, límites 3,5–64 y retirada de 3 s tras contacto; daño sujeto a la misma protección. |
| Meta y fin global | Meta en **Z ≤ −1800**. Go marca `finished` en el primer tick de cruce. Desconexión accidental: **15 s** de reentrada con entrada neutral; salida voluntaria o ventana vencida: `left`. Cierre global al quedar todos terminales o **45 s** después del primer `finished`; restantes activos/reconectando: DNF. |
| Clasificación y premio | Solo `finished` recibe puesto numérico por tiempo autoritativo, con `playerId` como desempate exacto. DNF, `disqualified` y `left` no tienen puesto y reciben **0** materiales; solo `finished` puede acreditar los materiales que Go confirmó. No hay bonus por puesto ni por Reducir. |

La cantidad recogida alimenta el objetivo de agua, **no** el desempate de carrera. Los materiales de participantes sin premio no se agregan al inventario, aunque sus objetos ya no estén en el recorrido. Los límites y efectos precisos de obstáculos, red, tabla, pulpo y orden de presentación de estados terminales permanecen en B16; este resumen no los reemplaza.

## Sala, continuidad y errores visibles

La sala sigue **LOBBY → COUNTDOWN → RACING → RESULTS → LOBBY**, o **CLOSED** cuando queda vacía. En RACING no hay joins; el creador no gobierna la carrera. Los participantes pasan por `not_ready`, `ready`, `racing` y un estado terminal `finished`, `disqualified`, `left` o `dnf`; `reconnecting` conserva entrada neutral y estado autoritativo durante la ventana válida. Llegar o quedar descalificado lleva a espera/espectador mientras los demás siguen. [B17](multiplayer-room-lifecycle.md) fija transiciones y repetición.

El [flujo B10](online-player-flow.md) guía mensajes de sesión/perfil pendiente, sala inexistente o llena, versión incompatible, desconexión, resultado confirmado con perfil pendiente y reintento seguro. `SESSION_REQUIRED`, `ROOM_NOT_FOUND`, `ROOM_FULL` e `INCOMPATIBLE_VERSION` son conceptos de error existentes, **no un contrato final**. La UI no inventa membresía, saldo ni carrera cuando falla un servicio; perder foco no pausa a los demás.

## Economía, cosméticos y autoridad

La demo tiene cuatro personajes (**Nico, Luna, Amara y Samuel**), tres tablas, tres atuendos, cinco peinados y siete redes. Personajes, tablas, atuendos, peinados y redes son **cosméticos**: no cambian velocidad, alcance, vidas o recogida. Maracaibo y Orinoco son los mapas jugables; Caroní y Encuentro son destinos anunciados, **fuera del MVP actual** [B08](frontend-baseline.md). El perfil local permite compra, equipamiento, canje y fabricación, pero su `localStorage` es editable.

| Parte | Autoridad y responsabilidad online diseñada |
| --- | --- |
| **Frontend web y futuro Python** | Capturan intención, muestran perfil/estado/resultado **confirmados** y efectos visuales. No declaran posición, vidas, pickups, ranking, premio ni saldo. |
| **Go Match Service** | Frontera pública; confirma sesión operativa, membresía, sala, roster, versiones, simulación, propiedad única, resultados y coordinación de settlement. La caída de Rust no destruye una carrera activa. |
| **Rust Player/Profile Service** | Mantiene perfil, catálogo, inventario, canje, compra, crafting, equipo y settlement transaccional e idempotente. No ejecuta el tick. |
| **PostgreSQL** | Persistencia durable con ownership lógico `match` para Go y `player` para Rust; Go no escribe datos privados de perfil. |
| **Envoy** | Ambassador/balanceador delante de réplicas Rust en la comunicación interna Go↔Rust. |

El resultado de Go y el perfil confirmado por Rust son pasos distintos. Solo `finished` puede acreditar materiales; settlement único por `(raceId, playerId)` y operaciones económicas atómicas/idempotentes quedan para implementación de Rust/Go. Las compras/canjes/fabricaciones online no se confirman desde el navegador por anticipado. La arquitectura completa está en [ARCHITECTURE.md](../../ARCHITECTURE.md); los [requisitos no funcionales C22](../requirements/non-functional-requirements.md) cubren resiliencia, rendimiento, seguridad y observabilidad **como criterios futuros**, sin duplicarlos aquí.

## Versiones, límites y trabajo pendiente

`rulesVersion` vigente **`surf-mvp-2`** (el inicial `surf-mvp-1` tenía un curso de 900) cambia cuando cambian simulación, elegibilidad, daño, pickups, ranking, fin global o recompensas. `courseVersion` es **separado por mapa/manifiesto** y cambia con posiciones/IDs/tipos de objetos, meta o slots; este GDD no inventa un identificador de curso. `catalogVersion` corresponde a economía/cosméticos y puede refrescarse fuera de carrera; `protocolVersion` gobierna compatibilidad de mensajes. Las versiones de reglas y curso quedan fijadas para cada carrera/sala; clientes incompatibles no inician. **E43** definirá formato y negociación, sin tratar los DTO propuestos del frontend como contratos aprobados.

Quedan por implementar: identidad y perfil online confiables, integración web TypeScript progresiva, segunda interfaz Python, Go autoritativo y su runtime **D28**, servicios Rust y persistencia de negocio, transporte/contratos **E43**, decisión jugable de Reducir, HUD/resultado de agua, settlement duradero y pruebas entre clientes. No se fijan aquí endpoints, payloads, tick Hz ni snapshots Hz. Los escenarios son **estilizados**: el juego no afirma kg retirados, litros salvados, porcentaje de contaminación, limpieza física, restauración ecológica ni aprendizaje demostrado. **ODS 14** es solo marco temático.

## Fuentes canónicas de producto

| Fuente | Decisión que aporta al GDD |
| --- | --- |
| [B08](frontend-baseline.md) | Estado real de prototipo local, mapas, cosméticos y límites de integración. |
| [B09](multiplayer-decisions.md) | Identidad, 2–4 humanos, objetos únicos, cierre, premio y versiones. |
| [B10](online-player-flow.md) | Flujo de entrada, preparación, carrera, errores, resultado y retorno. |
| [B11](narrative-context.md) | Premisa Surf Club, mensajes y guardrails narrativos. |
| [B12](educational-goals.md) | Audiencia, OE1–OE5 y evidencia educativa observable. |
| [B13](core-gameplay-loop.md) | Loop y fronteras de autoridad frontend/Go/Rust. |
| [B14](three-r-design.md) | Significado de las tres R y decisión preventiva de Reducir. |
| [B15](water-objective.md) | Agua como objetivo compartido de objetos virtuales. |
| [B16](authoritative-race-rules.md) | Parámetros `surf-mvp-2`, ranking y premios autoritativos. |
| [B17](multiplayer-room-lifecycle.md) | Estados y transiciones de sala/participación. |
