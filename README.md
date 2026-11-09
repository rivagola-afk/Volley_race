# Volley Race Online v2

Versión preparada para publicarse en Internet. Una vez desplegada, **ni el profesor ni los alumnos necesitan instalar nada**.

## Cómo se usa cuando está online

1. El profesor abre `https://TU-SITIO/host` en el computador conectado al proyector.
2. La pantalla crea una sala y muestra un código y un QR.
3. Los alumnos escanean el QR o abren `https://TU-SITIO/join` desde cualquier navegador.
4. Pueden usar Wi‑Fi o datos móviles; no necesitan estar en la misma red que el profesor.
5. Escriben su nombre y aparecen en el lobby.
6. El profesor inicia la carrera.

## Publicación recomendada: Render

Este proyecto incluye `render.yaml` y está listo para un Web Service de Node.js.

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`

Render entrega una URL HTTPS pública del tipo `https://volley-race-xxxx.onrender.com`.

### Importante sobre el plan gratuito

La sala vive en memoria mientras el servicio está activo. Está pensado para partidas de clase, no para guardar historiales permanentes. Si el servicio se reinicia, las salas activas desaparecen.

## Prueba local opcional

También puede ejecutarse localmente con:

```bash
npm start
```

Y abrir `http://localhost:3000/host`.

## Archivos

- `server.js`: servidor y lógica de salas/carreras.
- `public/host.html`: pantalla principal del profesor.
- `public/player.html`: pantalla del alumno.
- `public/host.js`: control y visualización de la carrera.
- `public/player.js`: ingreso y estado del jugador.
- `public/styles.css`: diseño visual.
- `render.yaml`: configuración para publicación pública.
