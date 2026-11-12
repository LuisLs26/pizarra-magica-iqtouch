# Pizarra Mágica

La pantalla abre `/`. El QR lleva al panel docente. Toca el panel de vinculación en la pantalla grande para habilitar audio y pantalla completa. Dibuja dos ojos separados y una boca debajo. Después de una pausa, la pizarra anima los trazos. El panel permite corregir la clasificación, borrar o guardar el dibujo y operar el micrófono.

## Instalación y despliegue

Usa Node.js 22 o superior. Ejecuta `npm install`, `npm test` y `npm run build`. Para producción conecta el repositorio en Cloudflare Workers Builds, selecciona `main` y usa `npm run deploy` como comando de despliegue. El Worker sirve los archivos de `dist` y aplica las migraciones SQLite de Durable Objects declaradas en `wrangler.jsonc`. Mantén el plan gratuito. El binding AI evita gestionar una clave API.

La primera visita necesita internet para instalar la caché de la aplicación. Piper descarga recursos de síntesis y el modelo de voz davefx en su primer uso. Su [ficha](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/es/es_ES/davefx/medium/MODEL_CARD) identifica la licencia CC0 del conjunto de datos. Las frases offline se generaron con la voz española del sistema y se distribuyen como WAV. La voz del navegador sirve como alternativa si Piper falla.

El micrófono debe permanecer con el panel visible y el teléfono desbloqueado. Se envían fragmentos de voz a Workers AI para transcripción y los textos a Gemma. El audio no se escribe en almacenamiento. Los dibujos e historial docente residen en el teléfono. Los metadatos de sesión vencen después de cuatro horas y la invitación es de un solo uso y dura diez minutos. La aplicación aplica un máximo de 100 intentos de inferencia al día en este Worker.

Comprueba permisos y sonido con un celular y la IQTouch antes de usar la aplicación en clase.
