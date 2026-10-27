# HTTPS para navegadores en otros equipos (H66)

Go emite la cookie de sesión `HttpOnly; Secure; SameSite=Strict`. Un navegador solo la envía por HTTPS (o a `localhost`), así que para jugar desde **otro equipo del laboratorio** el cliente web debe servirse por HTTPS. El cliente Python no lo necesita (usa `Authorization: Bearer`).

Si cada equipo de jugador corre su propio cliente web y abre `http://127.0.0.1:4173` ([laboratorio por roles](lab-roles.md)), esta guía **no hace falta**: la cookie viaja a `127.0.0.1`. Es para cuando los navegadores abren la web servida desde **otro** equipo.

Diseño: `apps/web/server.mjs` termina TLS y reenvía `/v1` (HTTP y WebSocket) a Go por la red interna. Go ve esa petición sin TLS, así que se le declara el origen público exacto con `PUBLIC_ORIGINS`; Go sigue sin confiar en cabeceras reenviadas y solo acepta ese `Origin` (o el directo) en mutaciones con cookie y en el WebSocket. Verificado en CI Integration: prueba Node (`integration/https.test.js`) y navegador Chromium por HTTPS (`e2e/https.spec.mjs`).

## Pasos (host del servidor)

Sustituir `<IP>` por la IP del host en la red del laboratorio (dato de A05; no se fija aquí).

1. **Certificado.** Opción A, sin dependencias (el navegador avisa una vez por equipo):

   ```sh
   sh scripts/deploy/web-tls-cert.sh ~/compunube-tls <IP> localhost
   ```

   Opción B, sin aviso: [mkcert](https://github.com/FiloSottile/mkcert) en el host (`mkcert -install` y `mkcert -cert-file ~/compunube-tls/web.crt -key-file ~/compunube-tls/web.key <IP> localhost`) e instalar su CA (`mkcert -CAROOT`/`rootCA.pem`) como raíz de confianza en cada equipo de la demo. La clave privada de la CA no sale del host.

   Los archivos se quedan fuera del repositorio (`web.key` es privada, `0600`).

2. **Go con el origen público.** En `.env`: `PUBLIC_ORIGINS=https://<IP>:4173` (varios separados por comas; solo `https://host[:puerto]`, sin ruta ni barra final, host en minúsculas). Desplegar o reiniciar Go: `docker compose up -d match-service-go` (o `scripts/deploy/deploy.sh`). Un valor inválido impide arrancar Go con un error de configuración.

3. **Cliente web por HTTPS**, escuchando en la red del laboratorio:

   ```sh
   cd apps/web
   COMPUNUBE_WEB_HOST=0.0.0.0 COMPUNUBE_WEB_PORT=4173 \
   COMPUNUBE_TLS_CERT=~/compunube-tls/web.crt COMPUNUBE_TLS_KEY=~/compunube-tls/web.key \
   COMPUNUBE_GO_URL=http://127.0.0.1:8080 npm start
   # Compunube: https://0.0.0.0:4173 · online via http://127.0.0.1:8080
   ```

4. **Firewall de Windows**: permitir la entrada al puerto 4173 desde la red del laboratorio. El puerto de Go (8080) solo hace falta para el cliente Python de otros equipos.

5. **En cada equipo de la demo**: abrir `https://<IP>:4173`. Con la opción A, aceptar el aviso del certificado una vez. «Con amigos» debe abrir el lobby y crear la sala.

## Comprobación y fallos

- Herramientas de desarrollo → Application → Cookies: `compunube_session` con *Secure* y *HttpOnly*.
- `401 SESSION_REQUIRED` al crear sala o al abrir el WebSocket desde otro equipo: `PUBLIC_ORIGINS` no coincide exactamente con la barra de direcciones (esquema, IP y puerto) o Go no se reinició tras cambiarlo.
- `ERR_CERT_*` sin opción de continuar: la IP no está en el certificado; regenerarlo con la IP correcta.
- Los navegadores en el mismo host pueden seguir usando `http://127.0.0.1:4173` sin certificado.
