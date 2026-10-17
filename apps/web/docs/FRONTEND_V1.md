# Compunube · Front v1.0

**Estado:** primera versión local del front preparada para integrar backend. **Entrega:** 15 de octubre de 2026. **Versión del paquete:** 1.0.0.

Esta entrega reúne el ciclo completo de elegir destino y equipo, correr, recuperar residuos, terminar y usar los materiales en el club. El juego se ejecuta en un navegador con un jugador humano y tres rivales de IA. La simulación, los resultados y el inventario residen en ese navegador.

## Contenido entregado

| Área | Front v1 |
|---|---|
| Mapas | Maracaibo y Orinoco, con recorridos de 900 m, distribuciones propias y paisaje estilizado |
| Personajes | Nico, Luna, Amara y Samuel; modelos y vestuario propios, tonos de piel, colores de cabello y cinco peinados |
| Tablas | Coral, Manglar y Sol del lago |
| Redes | Costera, Reutilizada, Marea, Cobre, Faro, Aurora y Sol del puente |
| Carrera | Avance automático, giro libre, salto, impulso por recogida, posición, cronómetro, meta y resultados |
| Supervivencia | Tres vidas, protección tras golpes, salvavidas y pulpo perseguidor visible en la cámara trasera |
| Residuos | Plástico —botellas y envoltorios— y chatarra —tubos oxidados en J—, con flotación y señales distintas |
| Progresión | Materiales por llegada a meta, canje por monedas, compra, fabricación y equipamiento cosmético |
| Interfaz | Inicio, destinos, tienda, personajes, canje, taller, ayudas, resultados y recuperación ante error de carga |
| Presentación | Modelos Blender/GLB, agua animada, reflejos, espuma, estelas, salpicaduras y audio procedural |
| Guardado | Perfil, destino y preferencia de sonido en almacenamiento local del navegador |

Todos los equipos cosméticos conservan alcance, velocidad y reglas. Comprar o fabricar añade el objeto al inventario; equiparlo es una acción independiente. Los residuos y salvavidas de una carrera se comparten entre el jugador y los tres rivales: cada objeto tiene un solo recolector.

## Arranque local y sin conexión a internet

Se ha probado con **Node.js 24**. Con la carpeta completa del proyecto, desde la raíz:

```powershell
npm start
```

También puede arrancarse directamente con `node server.mjs`. Abrir [Compunube local](http://127.0.0.1:4173/). Se necesita un navegador que permita WebGL; no se necesita tener Blender instalado para jugar.

El servidor usa módulos incluidos en Node y sirve `dist/`. Three.js y sus complementos están incluidos en `dist/vendor/`; modelos, recursos visuales y código están en la carpeta local. El audio se genera en el navegador. Jugar no requiere `npm install`, CDN, cuentas ni servicios externos. El servidor local debe permanecer en ejecución: abrir `index.html` mediante `file://` no sustituye el arranque HTTP.

Para instalar las dependencias de desarrollo cuando falten y ejecutar las comprobaciones:

```powershell
npm ci
npm run check
npm test
```

`npm ci` puede necesitar conexión si los paquetes no están en la caché; es independiente del arranque del juego ya entregado.

## Cómo jugar

- Flechas izquierda/derecha o **A/D**: girar.
- **Z/X**: dejar la red a la izquierda/derecha. Recoge al tocar el residuo, sin pulsar otro botón.
- **Espacio**: saltar obstáculos; la recogida se suspende mientras la red está en el aire.
- **Shift**: mantener para consumir el impulso cargado recogiendo residuos.
- **P**: pausar o continuar. **C**: alternar tercera persona/cenital.
- En móvil: botones de giro, salto, impulso y lado de la red.
- **♪**: activar o silenciar sonido. La reproducción comienza tras interacción.

Un choque o contacto con el pulpo resta vida cuando termina la protección. Los salvavidas recuperan una sin superar tres. Llegar a cero descalifica. La carrera se pausa al perder el foco o ante una interrupción larga del navegador. Reiniciar y salir durante una carrera requieren confirmación y no acreditan lo recogido.

## Resultados y guardado

Llegar a meta acredita plástico y chatarra. Una descalificación conserva el inventario anterior y no acredita materiales de esa carrera. El canje consume materiales para producir monedas; fabricar consume esos mismos recursos, por lo que no pueden gastarse en ambos destinos.

El perfil usa `compunube.profile.v1`; el mapa y el sonido tienen preferencias separadas. El guardado pertenece al **origen del navegador**: `localhost:4173` y `127.0.0.1:4173` mantienen datos distintos. Conviene usar siempre la misma dirección. Borrar los datos del sitio borra el progreso local; no existe recuperación en una cuenta. Si el navegador bloquea el almacenamiento, la interfaz lo indica y la sesión continúa en memoria.

Las tres R aparecen mediante canje —reciclar—, fabricación —reutilizar— y una explicación educativa de reducir. No hay una mecánica independiente de reducir. Los contadores representan residuos virtuales, no una medición de impacto ambiental.

## Frontera con backend

No hay autenticación, cuentas, API de negocio, base de datos, salas, WebSocket ni jugadores remotos implementados. `server.mjs` es un servidor estático local. Los resultados y transacciones locales no constituyen una autoridad segura frente a manipulación del cliente.

La [entrega backend](backend/README.md), los [fixtures del front](backend/fixtures/current-front.json) y los [contratos TypeScript propuestos](backend/contracts-proposed.ts) son el punto de partida de integración. Los contratos son una propuesta documental; no representan endpoints conectados. Documentación, fixtures y ZIP backend están actualizados para este cierre.

Caroní, Encuentro, una transición entre ríos y nuevos contenidos quedan para ampliaciones posteriores. La conexión de hasta cuatro humanos es el siguiente trabajo conjunto con backend y no forma parte de este cierre local.

## Verificación y mantenimiento

Ver el [informe de cierre del front](../tests/QA-frontend-v1.md) para las comprobaciones de esta entrega y sus límites. Los informes `tests/QA-*.md` anteriores documentan cada pase y no sustituyen la revisión del cierre. No se establece una cifra de FPS ni una garantía de rendimiento para todos los dispositivos.

El [plan actualizado](../PLAN.md) conserva el historial de implementación. Las fuentes Blender, generadores y decisiones visuales permanecen en [art/README.md](../art/README.md). La ilustración aprobada guía la estética; la entrega se evalúa como juego interactivo y no afirma reproducirla exactamente.

Las vistas de estudio —`animation-review.html`, `character-review.html`, `scene-review.html` y `art-study.html`— permiten inspeccionar modelos y composición sin comprar ni modificar el perfil. Son herramientas de revisión, separadas del recorrido habitual Inicio → Carrera → Resultados → Club.
