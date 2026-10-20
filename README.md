# Elipsys Time — Gestión de tiempo y tareas

App de escritorio (Electron + React + TypeScript) que se conecta a una instancia de Odoo por JSON-RPC para:

- Ver las tareas asignadas al usuario logueado (`project.task`), con búsqueda por texto y filtro por proyecto.
- Iniciar y detener un cronómetro por tarea; al detenerlo se registra un timesheet (`account.analytic.line`).
- Abrir cualquier tarea directamente en Odoo desde su nombre.
- Avisar con notificaciones nativas de Windows cuando una tarea está caducada (`date_deadline` vencido).
- Registrar ingreso y salida (`hr.attendance`), usando el empleado vinculado al usuario de Odoo.
- Ver métricas de productividad: horas registradas hoy y esta semana, promedio diario, porcentaje de
  imputación (horas en hojas de horas sobre horas de jornada), horas por día de las últimas dos
  semanas y dedicación por proyecto.
- Recordar los fichajes **15 minutos antes** del horario configurado y volver a avisar a los 15,
  45 y 90 minutos mientras sigan sin marcarse (de lunes a viernes, hora de Ecuador), o marcarlos
  automáticamente a esa hora si se activa la opción.
- Registrar tiempo sin tarea contra un proyecto y asignarle la tarea después, como en Odoo.
- Medir el tiempo de uso de aplicaciones y dejar que quien tenga el permiso lo revise por persona
  (día, semana o mes) desde la pestaña Equipo.
- Arrancar junto con el sistema operativo y quedarse en la bandeja del sistema.

## Comportamiento de la aplicación

- **Miniatura flotante:** al minimizar la ventana (o cerrarla a la bandeja) con un cronómetro en
  marcha, aparece una ventanita siempre visible sobre las demás aplicaciones, con el tiempo, un botón
  para detener y registrar y otro para volver a la app. Se arrastra desde su franja superior.
  Si hay una reunión grabándose, lleva arriba una franja roja con el tiempo de grabación; si solo
  hay grabación y ningún cronómetro, aparece igual con esa franja sola. La ventanita crece y
  encoge según lo que haya, sin moverse de donde la dejaste.
- **Mías o todas:** las pestañas «Mis tareas» y «Tickets» llevan dentro un selector (Mías/Todas,
  Míos/Todos) para pasar a ver todo lo que hay abierto en Odoo, estés asignado o no, sin salir de
  la pestaña.
- **Solo trabajo abierto:** las tareas cerradas (`state` en `1_done` / `1_canceled`) y los tickets con
  fecha de cierre o en etapa plegada no se consultan. Además hay filtros por etapa en ambas listas.
- **Bandeja del sistema:** cerrar la ventana solo la oculta; la app sigue corriendo para poder emitir
  los recordatorios de fichaje. Para cerrarla del todo se usa «Salir» en el menú de la bandeja.
- **Recordatorios:** salen un cuarto de hora antes de la hora de entrada y de la de salida que haya
  en Configuración —las mismas que usa la marcación automática, estén o no activadas—, y se repiten
  a los 15, 45 y 90 minutos si el fichaje sigue sin hacerse. Se omiten en cuanto está hecho (no
  avisa de entrada si ya fichaste, ni de salida si no estás fichado) y, si no se puede consultar el
  estado en Odoo, se manda el aviso previo pero no se insiste. Se pueden desactivar en
  Configuración.
- **Tareas muy atrasadas:** las que llevan más de 30 días vencidas se ocultan por defecto para no
  hacer ruido, y se muestran con el botón «Ver atrasadas +1 mes».
- **Inicio automático:** en Windows y macOS con `app.setLoginItemSettings`; en Linux escribiendo
  `~/.config/autostart/elipsys-time.desktop` (respeta `XDG_CONFIG_HOME`), que es lo que leen GNOME,
  KDE y compañía. Arranca con `--hidden`, o sea minimizada en la bandeja. En Linux hace falta la
  app instalada: desde el código fuente el ejecutable sería el electron de `node_modules`, así que
  ahí la opción sigue deshabilitada.

### Asistencia de IA

Opcional y apagable. Cada persona guarda **su propia** clave de la API de Claude en
Configuración; se cifra con `safeStorage` del sistema operativo en el equipo de cada quien
(`ai-key.dat` en la carpeta de datos) y nunca viaja en el instalador. Al guardarla se comprueba
contra la API listando modelos, que no consume tokens.

Con el módulo [`elipsys_app_usage`](addons/elipsys_app_usage/README.md) instalado también se
puede poner una clave de la empresa en Odoo (Ajustes › Empleados › Elipsys Time) y entonces nadie
tiene que configurar nada: la personal, si la hay, manda sobre la de la empresa.

Cuatro usos, todos con revisión humana antes de que algo llegue a Odoo:

- Redactar la descripción de la hoja de horas al registrar el tiempo.
- Sugerir a qué tarea pertenece un registro de «tiempo sin tarea».
- Resumir la semana por proyecto, para enviar al cliente.
- Triaje de un ticket: resumen, prioridad sugerida, primeros pasos y tickets parecidos.

Los dos primeros usan `claude-haiku-5-5` y los dos últimos `claude-sonnet-5-5`. A Claude solo se
le envían los datos del registro concreto: nombre de tarea o ticket, proyecto, duración y las
descripciones anteriores de ese mismo registro.

### Reuniones

Pestaña propia. Graba micrófono y audio del sistema mezclados (en Windows por *loopback*, para
capturar también a los demás participantes) y escribe el `.webm` a disco por trozos mientras dura
la reunión, de modo que un cierre inesperado no se lleva la sesión. El audio y su ficha viven en
`grabaciones/` dentro de la carpeta de datos de la app: nunca salen del equipo.

La transcripción corre en local con Whisper vía `@huggingface/transformers`: la ventana decodifica
el audio y lo remuestrea a 16 kHz mono, y el proceso principal ejecuta el modelo, que se descarga
una sola vez a `modelos-whisper/`. El modelo se elige en Configuración (`tiny` 42 MB, `base` 77 MB
por defecto, `small` 241 MB). Del texto resultante sale el resumen, ese sí con la API de Claude.

### Uso de aplicaciones

Se registra el tiempo que cada programa pasa **en primer plano**, y nada más: ni títulos de
ventana, ni teclas, ni capturas. En Windows lo averigua un PowerShell de fondo
(`vigilante-uso.ps1`, escrito en la carpeta de datos) que pregunta a `user32.dll` cada cinco
segundos; si una política de grupo impide ejecutar el `.ps1`, se reintenta con `-EncodedCommand`.
Más de cinco minutos sin tocar el equipo (`powerMonitor.getSystemIdleTime`) cuentan como inactivo.

En Linux la medición sale de `xdotool` (hace falta tenerlo instalado y una sesión X11); sin él la
app lo dice en Configuración y no registra nada. Es una ayuda para desarrollo: el registro está
pensado para los equipos con Windows.

Cada día se guarda primero en `uso-apps/<fecha>.json` dentro de la carpeta de datos (120 días) y
se sube a Odoo cada cinco minutos. Dónde acaba depende de si está instalado el módulo
[`elipsys_app_usage`](addons/elipsys_app_usage/README.md):

| | Con el módulo | Sin el módulo |
| --- | --- | --- |
| Dónde se guarda | Modelo `elipsys.app.usage` (+ una línea por programa) | Adjunto suelto `elipsys-uso-u<uid>-<fecha>.json`, con el resumen en `description` |
| Quién lo revisa | Quien tenga el permiso «Elipsys Time / Revisar el uso de aplicaciones» | Administración de Ajustes (`base.group_system`), que es a quien Odoo deja leer los adjuntos sin `res_id` |
| Quién lo enciende | La compañía, en Ajustes › Empleados › Elipsys Time | Siempre encendido |
| Quién borra lo viejo | Acción planificada diaria del módulo | Cada cliente, lo suyo de más de 180 días |
| Analítica en Odoo | Empleados › Informes › Uso de aplicaciones | — |

En los dos casos cada persona solo puede escribir y leer lo suyo; la app detecta el módulo sola
(mira `ir.model` como mucho cada 30 minutos) y cambia de sitio sin tocar nada.

Dentro de la pestaña Equipo, un selector en la cabecera alterna entre el resumen de jornadas y
el uso de aplicaciones, cada uno con su permiso: quien solo tenga el de revisión entra directo al
uso y no ve el selector, y si falta el permiso el panel lo dice en vez de enseñar datos a medias.

La app no enseña nada de esto a la persona medida: ni el interruptor —lo decide la empresa desde
Odoo— ni su propio detalle. Los datos se revisan desde Equipo o desde el menú de Odoo, con el
permiso correspondiente.

### El nombre anterior

La aplicación se llamaba **Elideysi** hasta la versión 1.7.0. El `appId`
(`com.elipsys.elideysi`) se mantiene a propósito: es la clave con la que Windows identifica la
instalación, así que cambiarlo dejaría la versión vieja instalada junto a la nueva en vez de
actualizarla. La carpeta de datos sí cambia de nombre (lleva el del producto), por eso al arrancar
se copian una sola vez `session.dat` y `settings.json` desde la carpeta anterior: nadie tiene que
volver a iniciar sesión.

## Requisitos en Odoo

- Módulo **Proyecto** instalado (tareas con `date_deadline` y asignación por `user_ids` o `user_id`).
- Módulo **Hoja de horas** (`hr_timesheet`) si querés que el tiempo registrado se vea en las hojas de horas del proyecto.
- Módulo **Asistencias** (`hr_attendance`) y que el usuario tenga un empleado vinculado (`res.users.employee_id`).
- Un usuario o API key con permisos para leer/escribir esos modelos.
- Para fichar sin repartir el grupo «Asistencias → Officer», el módulo
  [`elipsys_app_usage`](addons/elipsys_app_usage/README.md): Odoo 19 crea las líneas de horas
  extra con el usuario en curso y sin ese permiso rechaza la marcación entera.
- Para revisar el uso de aplicaciones del equipo: con el módulo `elipsys_app_usage` instalado, el
  permiso **Elipsys Time / Revisar el uso de aplicaciones**; sin él, **Administración / Ajustes**
  (`base.group_system`).

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Levanta Vite en `http://localhost:5173` y abre la ventana de Electron apuntando ahí, con recarga en caliente.

## Ramas y publicación

- **`develop`**: rama de trabajo. Cada push y cada PR ejecuta CI (tipos, sintaxis del proceso
  principal y compilación de la interfaz).
- **`main`**: rama estable. Los PR hacia `main` ejecutan además el empaquetado de Windows y dejan el
  instalador como artefacto descargable, para poder probarlo antes de liberar.
- **Releases**: se publican por etiqueta de versión, no por cada PR. Para liberar una versión:

  ```bash
  npm version patch        # o minor / major: actualiza package.json y crea el commit
  git push origin main --follow-tags
  ```

  El workflow `Publicar release de Windows` compila el instalador, crea el Release en GitHub y sube
  el `.exe` junto con `latest.yml`. También se puede lanzar a mano desde la pestaña Actions.

  El workflow verifica que la etiqueta coincida con la versión de `package.json` y falla si no, para
  evitar releases con numeración inconsistente.

## Actualización automática

La app usa `electron-updater`: al abrirse y cada 4 horas consulta los Releases, descarga la versión
nueva en segundo plano y ofrece reiniciar para instalarla. En Configuración se ve la versión
instalada, el estado y un botón para comprobar a mano. Solo funciona en la app empaquetada.

### Por qué hay dos repositorios

Este repositorio es privado, y `electron-updater` no puede descargar de un repositorio privado sin
incrustar un token en la aplicación. Por eso los instaladores se publican en un repositorio
**público aparte**, configurado en `build.publish` de `package.json`:

    Dasanchez1992/odoo-traking-app-release

El código fuente sigue siendo privado; ese repositorio solo recibe el `.exe` y el `latest.yml`.

### Puesta en marcha (una sola vez)

1. Crear en GitHub el repositorio **público** `odoo-traking-app-release` **con al menos un commit**
   (por ejemplo, marcando «Add a README file» al crearlo). GitHub rechaza crear releases en un
   repositorio vacío, y la publicación falla con «Repository is empty».
2. Generar un token de acceso personal con permiso de escritura de contenido sobre ese repositorio
   (fine-grained: *Contents: Read and write*).
3. En este repositorio, guardarlo en *Settings → Secrets and variables → Actions* con el nombre
   **`RELEASES_TOKEN`**.

Si el secret falta, el workflow se detiene al principio con un mensaje explicándolo, en lugar de
fallar a mitad de la publicación.

> **Firma de código:** los instaladores no están firmados, así que Windows SmartScreen mostrará un
> aviso al instalar. Para evitarlo hace falta un certificado de firma de código (EV o estándar) y
> configurarlo en electron-builder.

## Build de producción

```bash
npm run build      # compila el frontend a dist/
npm run dist       # instalador de Windows (nsis)
npm run dist:deb   # paquete .deb para Debian/Ubuntu
npm run dist:linux # lo mismo que dist:deb, con la configuración de linux por defecto
```

El instalador para Windows se genera mejor corriendo `npm run dist` en Windows (o con Wine en
Linux). El `.deb` se construye en Linux (en WSL también) y sale en `release/` como
`ElipsysTime-<versión>-amd64.deb`.

Del paquete de Linux se dejan fuera los *providers* de CUDA y TensorRT de onnxruntime (273 MB que
solo sirven con GPU NVIDIA; Whisper corre en CPU).

El release de GitHub publica los dos: el `.deb` se construye en un trabajo de Ubuntu y el
instalador de Windows en otro, que recoge el paquete del primero y los sube juntos. Si falla el
`.deb`, no se publica nada.

### Instalar el .deb

```bash
sudo apt install ./ElipsysTime-<versión>-amd64.deb
```

En Linux la app **no se actualiza sola** (electron-updater no sabe actualizar paquetes `.deb`):
hay que descargar el paquete de cada versión nueva. En Windows sí.

## Notas de diseño

- Las credenciales (URL, base de datos, usuario y contraseña) se guardan cifradas en el equipo con `safeStorage` de Electron, en `session.dat` dentro del directorio de datos de la app.
- El cronómetro vive en el proceso principal de Electron, así que sobrevive a un refresco de la ventana. Solo se puede tener un cronómetro corriendo a la vez.
- Las tareas caducadas se revisan cada 5 minutos en segundo plano; solo se notifica una vez por tarea por sesión para no spamear.
- La detección de "tarea asignada" intenta primero el campo `user_ids` (Odoo 14+, multi-asignación) y si falla cae a `user_id` (versiones más viejas).
