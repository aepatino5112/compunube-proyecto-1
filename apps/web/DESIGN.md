# Compunube · Recolección, impulso y progresión

El diseño ampliado se desarrolla en [PLAN.md](PLAN.md): mapas venezolanos, tres vidas y recuperación, persecución del pulpo, materiales, tienda y taller. Las reglas ya implementadas de esta nota siguen describiendo el prototipo; las propuestas de economía siguientes son antecedentes revisables.

## Decisiones de esta versión

- Vista principal: tercera persona en 3D. La vista cenital sigue disponible para comparar el maquetado.
- Flechas o A/D: girar. Z: red a la izquierda. X: red a la derecha. No se mantienen pulsadas: el lado elegido permanece activo.
- La red cruza por delante del surfista y los brazos acompañan el mango. La recogida sigue la posición de la red durante el cambio.
- Cada residuo aporta 20 % a una barra de impulso de 100 %. Cinco residuos llenan la barra.
- La barra comienza vacía. Solo se carga recogiendo; no se recarga al esperar.
- Mantener Shift consume 25 % por segundo y permite un 40 % más de velocidad. Una barra llena dura cuatro segundos. En móvil hay un botón que se mantiene pulsado.
- Soltar Shift conserva la energía restante. El límite de velocidad evita acumular mejoras sin fin. Al terminar la barra se vuelve a la velocidad habitual.
- Usar impulso no reduce el número de residuos recogidos. Una recogida sigue contando una sola vez; el cambio de lado no duplica objetos.
- Los rivales simulados recogen por ambos lados y usan el mismo sistema de impulso.

Los valores son un primer balance para probar jugando. Revisar si el alcance, el cambio de manos y los cuatro segundos permiten recoger y adelantar sin perder el control.

## Menú y economía propuestos para la siguiente fase

Flujo: **Inicio → Carrera → Resultado → Vestuario → Nueva carrera**.

1. **Inicio:** personaje y tabla en la bahía, botón Jugar, Vestuario y Controles. En multijugador se añadirá la sala con hasta cuatro jugadores.
2. **Resultado:** posición, tiempo, residuos recogidos y créditos obtenidos. Ejemplo de balance inicial: 10 créditos por residuo; 12 residuos generan 120 créditos.
3. **Canje:** acreditar automáticamente una vez al cerrar la carrera, con una animación que explique «12 residuos → 120 créditos». Esto evita un clic obligatorio y un canje repetido. Si el juego pasa a multijugador, el servidor deberá validar el resultado y otorgar la recompensa una sola vez.
4. **Vestuario:** mostrar la apariencia actual, saldo, precio y previsualización del personaje. Botones Comprar y Equipar deben distinguirse. Propuesta inicial: camiseta de otro color por 100 créditos, conjunto por 300 y tabla por 500.
5. **Cosméticos:** ropa, colores de tabla y modelos de red. Mantener el mismo alcance y velocidad para todos los jugadores; el impulso se gana jugando.

La basura es un resultado de la partida y el impulso es un recurso temporal. La energía gastada no se descuenta del canje. La tabla de precios y la conversión son propuestas, aún sin implementar. No hay créditos, compras ni inventario ficticios en la interfaz actual.

## Orden de trabajo sugerido

1. Probar y ajustar cambio de manos, recogida e impulso.
2. Crear menú, resumen y vestuario con progreso local.
3. Añadir partidas reales de hasta cuatro jugadores y validar recompensas.
