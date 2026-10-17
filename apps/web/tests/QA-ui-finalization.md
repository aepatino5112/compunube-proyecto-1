# Cierre de interfaz · 15 de octubre de 2026

Se revisaron los flujos de Inicio, Tienda, Taller, Canjear, ayudas y resultados en el código del front. Los cambios se limitan a `dist/app.js`, `dist/index.html` y `dist/style.css`; no modifican economía, precios, catálogo, persistencia ni reglas de carrera.

## Correcciones

- Las tarjetas conservan el foco de teclado después de elegir, comprar o equipar. Al quedar desactivado el botón de equipar, el foco vuelve a la tarjeta correspondiente.
- El taller conserva el desplazamiento de su lista al reconstruir tarjetas y explica cuántos materiales faltan para una receta.
- «Todo mi plástico / Toda mi chatarra» oculta un recibo anterior de canje antes de presentar la nueva cantidad.
- Durante la carga, el menú y la cabecera permanecen inactivos y se muestra un estado de preparación. Los errores de importación/modelos muestran una acción para recargar; sin JavaScript se explica el requisito.
- El diálogo tiene nombre y descripción accesibles. La tarjeta de resultados queda identificada por su título y texto. Diálogo y resultado admiten desplazamiento vertical cuando falta altura.
- El campo de cantidad solicita teclado numérico; hay blancos táctiles mayores y ajustes para cabeceras estrechas, cantidad de canje y textos de ayuda.
- Reiniciar y salir tienen avisos y botones distintos: «Si reinicias… / Reiniciar carrera» frente a «Si sales… / Salir de la carrera».

## Comprobaciones ejecutadas

`node --check dist/app.js` y la comprobación sintáctica del cargador inline pasan. Las **11 pruebas** de `economy.test.js`, `cosmetics.test.js` y `maps.test.js` pasan: transacciones, persistencia, cosméticos y recorridos mantienen su comportamiento.

## Comprobación integrada del navegador

La comprobación del agente principal está en [QA-frontend-v1.md](QA-frontend-v1.md). Se observaron foco conservado tras seleccionar/comprar/equipar, recibo ocultado al pulsar «Todo», compra, fabricación, recarga con equipo persistente, confirmaciones distintas de reinicio/salida y ayuda accesible. Se revisaron 390 × 844 y 320 × 568 px sin desbordamiento horizontal. No se simularon errores de descarga ni se certificó una sesión íntegra usando sólo teclado; tampoco se trata de una prueba en un móvil físico.
