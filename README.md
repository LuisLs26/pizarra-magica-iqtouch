# Pizarra Mágica

La pantalla abre `/`. El QR lleva al panel docente. Toca el panel de vinculación en la pantalla grande para habilitar audio y pantalla completa. Usa la casita o Alt+Mayús+Q para volver a mostrar el mismo código. Escanearlo desde otro celular transfiere el control y desconecta el panel anterior. Dibuja dos ojos separados y una boca debajo. Cuando termines, pulsa **Dar vida** en el panel docente. Los dibujos recién hechos, recuperados al recargar o cargados desde la biblioteca esperan esa acción. El panel permite corregir la clasificación, borrar o guardar el dibujo y operar el micrófono.

## Instalación y despliegue

Usa Node.js 22 o superior. Ejecuta `npm install`, `npm test` y `npm run build`. Para producción conecta el repositorio en Cloudflare Workers Builds, selecciona `main` y usa `npm run deploy` como comando de despliegue. El Worker sirve los archivos de `dist` y aplica las migraciones SQLite de Durable Objects declaradas en `wrangler.jsonc`. Mantén el plan gratuito. El binding AI evita gestionar una clave API.

La primera visita necesita internet para instalar la caché de la aplicación. Piper descarga recursos de síntesis y el modelo de voz davefx en su primer uso. Su [ficha](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/es/es_ES/davefx/medium/MODEL_CARD) identifica la licencia CC0 del conjunto de datos. Las frases offline se generaron con la voz española del sistema y se distribuyen como WAV. La voz del navegador sirve como alternativa si Piper falla.

En el panel docente, abre Chrome y toca **Toca para hablar** para usar su servicio de dictado en español. Mantén el panel visible y el teléfono desbloqueado. Revisa o corrige el texto y pulsa **Enviar a Gemma**. También puedes escribir la pregunta. El panel actual envía solo el texto al Worker. Chrome puede procesar el audio en su servicio de reconocimiento. Los dibujos e historial docente residen en el teléfono. El mismo QR funciona durante cuatro horas o hasta cerrar la sesión. Cada escaneo válido reemplaza el acceso del controlador anterior. La aplicación aplica un máximo de 100 intentos de inferencia al día en este Worker.

Comprueba permisos y sonido con un celular y la IQTouch antes de usar la aplicación en clase.
