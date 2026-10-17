# Canje visual y red con fondo · 12/10/2026

- La estación muestra las mismas mallas de botella, lata y envoltorio que carga la carrera desde `waste-models.js`. Los retratos se generan con el renderizador de vista previa existente.
- Selección de plástico/chatarra actualiza vista flotante, disponibilidad, precio, imagen de entrega y saldo previsto. Las recetas del taller también muestran estos residuos.
- En navegador se rechazaron una cantidad excesiva (2 con 1 disponible) y una fracción (0,5). Se canjeó el plástico disponible por cuatro monedas: saldo 4 → 8, plástico 1 → 0; el estado se mantuvo tras recargar. El estado vacío deshabilita canje y explica cómo obtener materiales. La chatarra restante sigue disponible por seis monedas.
- Revisado a 1280 px y comprobado a 390 px sin desbordamiento horizontal (ancho de contenido y documento: 390). Se restableció el tamaño de navegador al terminar.
- El taller muestra la red con bolsa curva, fondo y boca abierta. La malla oscura conserva contraste sobre el fondo claro. En carrera se recogieron dos residuos con los modelos compartidos; se mantuvieron las reglas de descalificación y no se guardaron los materiales de esa prueba.
- Comprobaciones de sintaxis y diez pruebas existentes pasan. Consola de navegador sin errores ni advertencias en las comprobaciones.

La bolsa es geometría animada con la herramienta; aún no simula tela. Las cantidades siguen agrupadas por material, no por botella/lata individual. La estación y los retratos respetan la preferencia de movimiento reducido.
