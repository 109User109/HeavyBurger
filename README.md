# Tienda Online con Node.js + WhatsApp

Tienda virtual moderna en modo oscuro, hecha con HTML/CSS/JavaScript y backend en Node.js para guardar datos en JSON y subir imagenes al servidor.

## Caracteristicas

- Catalogo dinamico (tarjetas generadas desde JSON).
- Filtro por categorias + buscador.
- Carrito local en la tienda publica.
- Compra por WhatsApp con mensaje automatico:
  - productos,
  - cantidades,
  - total estimado,
  - texto final configurable.
- Panel admin en ruta directa `/admin-panel`.
- Login de admin con sesion unica activa.
- Bloqueo de acceso concurrente: solo un administrador puede editar a la vez.
- Expiracion automatica de sesion admin por inactividad.
- Panel admin responsivo (optimizado para uso desde celular).
- Panel admin organizado por secciones (General, Mensajes, Categorias, Productos).
- CRUD completo de categorias y productos.
- Subida de imagenes real al servidor (`/uploads`).
- Captura de foto desde movil directamente en el formulario de producto.
- Listado de productos en admin con:
  - filtro por categoria,
  - busqueda por texto,
  - orden por fecha de publicacion y otros criterios.
- Editor visual de imagen antes de publicar:
  - mover (drag),
  - zoom,
  - recorte final en formato de tarjeta (4:3).
- Vista previa de la tarjeta antes de guardar producto.

## Estructura

```text
/
|- admin-panel/
|  |- index.html
|  |- login.html
|- assets/
|  |- css/
|  |  |- styles.css
|  |  |- admin.css
|  |- js/
|  |  |- app.js
|  |  |- admin.js
|  |  |- admin-login.js
|- data/
|  |- store.json
|- uploads/
|  |- .gitkeep
|- index.html
|- server.js
|- package.json
```

## Instalacion

```bash
npm install
npm start
```

Servidor: `http://localhost:3000`

Opcional (credenciales y TTL de sesion admin):

```bash
set ADMIN_USERNAME=tu_usuario
set ADMIN_PASSWORD=tu_clave
set ADMIN_SESSION_TTL_MINUTES=20
npm start
```

## Deploy en Render (paso a paso)

### Opcion A: Dashboard (recomendada para primer deploy)

1. Sube el proyecto a GitHub (rama principal).
2. En Render: `New` -> `Web Service`.
3. Conecta tu repo y selecciona la rama.
4. Configura:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. En `Environment` agrega:
   - `NODE_ENV=production`
   - `PERSISTENT_STORAGE_PATH=/var/data`
   - `ADMIN_COOKIE_SECURE=true`
   - `TRUST_PROXY_HOPS=1`
   - `ADMIN_USERNAME` (tu usuario)
   - `ADMIN_PASSWORD` (tu clave fuerte)
6. En `Disks` agrega un disco persistente:
   - Mount Path: `/var/data`
   - Size: `1 GB` (o mas segun necesidad)
7. Deploy.

Notas importantes:
- En Render, sin disco persistente los archivos locales se pierden al redeploy/restart.
- El disco persistente en web services requiere un plan pago en Render.
- Con esta configuracion, la app persiste:
  - `store.json` en `/var/data/data/store.json`
  - imagenes en `/var/data/uploads`

### Opcion B: Blueprint (render.yaml)

Este repo ya incluye [`render.yaml`](./render.yaml) con:
- Web Service Node
- Health check en `/healthz`
- Disco persistente montado en `/var/data`
- Variables de entorno base

Solo debes crear el servicio desde Blueprint y completar secretos (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).

## Rutas

- Tienda: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin-panel`

## API

- `GET /api/store`
- `GET /api/admin/session`
- `POST /api/admin/login`
- `POST /api/admin/heartbeat`
- `POST /api/admin/logout`
- `PUT /api/settings`
- `POST /api/categories`
- `PUT /api/categories/:id`
- `DELETE /api/categories/:id`
- `POST /api/products` (multipart/form-data)
- `PUT /api/products/:id` (multipart/form-data)
- `DELETE /api/products/:id`

## Notas

- Los datos se persisten en `data/store.json`.
- Las imagenes se guardan en `uploads/`.
- Si eliminas una categoria con productos, esos productos pasan a `Uncategorized`.
- El numero de WhatsApp debe tener codigo de pais.
- Mientras una sesion admin este activa, otro login admin recibe bloqueo hasta logout o expiracion.
