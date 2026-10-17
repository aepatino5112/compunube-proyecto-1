# Revisión de diversidad · pase 03

2026-10-13. Amplía el pase 02; la valoración del acabado artístico sigue abierta.

## Cambios y comprobaciones

- Blender 5.2.1 LTS regeneró `art/surfer.blend` y el GLB compartido (2 845 992 bytes). Luna, Amara y Samuel tienen objetivos de deformación de rostro/cuerpo; Nico conserva la forma base. Los cinco peinados mantienen pesos sobre el esqueleto de 15 huesos y los ocho clips existentes.
- Tienda → Personajes muestra cuatro retratos de los modelos reales, dos mujeres y dos hombres. Cinco tonos de piel y seis colores de cabello están disponibles para cualquiera, sin monedas ni ventajas. Peinados ofrece cinco cortes, incluidos Coleta y Afro.
- Se revisaron de frente Amara, Luna y Samuel. Se elevó la línea frontal del afro para dejar visibles los ojos y se ajustó el rubio para que se lea amarillo bajo la iluminación de la vista previa. El estudio de movimiento muestra la coleta desde atrás y ahora permite cambiar personaje, piel y cabello.
- Se eligió Luna con piel Oscuro y cabello Azul; después de recargar, los tres controles conservaron su estado seleccionado. Cambiar su peinado a Afro conservó Luna. Cambiar a otro personaje aplica la apariencia inicial de ese personaje.
- La carrera de prueba en Maracaibo avanzó **32 m / 00:02**, recogió un plástico y se pausó. La coleta de Luna y los distintos cabellos de los rivales se ven desde la cámara de carrera. Se abandonó sin acreditar la recolección. No fue una carrera completa ni una medición de rendimiento.
- Móvil **390 × 844**: las cuatro tarjetas y ambas paletas se pueden recorrer y accionar. `clientWidth = scrollWidth = 375`; no hay desplazamiento horizontal. Se seleccionó Amara con piel Profundo y cabello Rubio.

## Pruebas automatizadas

`npm run check` aprobado; `npm test`: **43 pruebas aprobadas**. Se cargan los GLB reales para comprobar objetivos de deformación con cambios de geometría, influencias y materiales independientes entre actores y conservación de formas al animar. Los cuatro personajes pasan las pruebas de manos/pies con red a ambos lados, giros, impulso, salto, aterrizaje, recogida y golpe. Migración v1 conserva inventario y balances; colores válidos persisten y solicitudes inválidas no modifican el perfil.

## Límites

Se comparte el corte de ropa del club; sus proporciones y colores varían, pero aún no hay vestuario propio completo para cada personaje. No se midieron FPS sostenidos ni memoria GPU. La colecta/afro amplían las siluetas, pero todavía no tienen simulación física propia de cabello.

## Evidencia

- `preview-personajes-diversidad.jpg`: tienda habitual con los cuatro personajes; 150 monedas conservadas.
- `preview-personajes-movil.jpg`: cuatro tarjetas y paletas de piel/cabello en móvil.
- `preview-luna-coleta-espalda.jpg`: estudio manual, Luna y recogedor Aurora.
- `preview-luna-carrera.jpg`: carrera pausada con Luna y los tres rivales.

Las elecciones de prueba se hicieron en `localhost:4173`; al terminar se restauró Nico / Medio / Castaño / Al viento. El perfil habitual de `127.0.0.1:4173` conserva equipo, destino y monedas.
