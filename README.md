# Elideysi — Gestión de tiempo y tareas

App de escritorio (Electron + React + TypeScript) que se conecta a una instancia de Odoo por JSON-RPC para:

- Ver las tareas asignadas al usuario logueado (`project.task`), con búsqueda por texto y filtro por proyecto.
- Iniciar y detener un cronómetro por tarea; al detenerlo se registra un timesheet (`account.analytic.line`).
- Abrir cualquier tarea directamente en Odoo desde su nombre.
- Avisar con notificaciones nativas de Windows cuando una tarea está caducada (`date_deadline` vencido).
- Registrar ingreso y salida (`hr.attendance`), usando el empleado vinculado al usuario de Odoo.
- Ver métricas de productividad: horas registradas hoy y esta semana, promedio diario, porcentaje de
  imputación (horas en hojas de horas sobre horas de jornada), horas por día de las últimas dos
  semanas y dedicación por proyecto.
- Recordar los fichajes a las 09:30 y 17:30 (hora de Ecuador), de lunes a viernes.
- Arrancar junto con el sistema operativo y quedarse en la bandeja del sistema.

## Comportamiento de la aplicación

- **Bandeja del sistema:** cerrar la ventana solo la oculta; la app sigue corriendo para poder emitir
  los recordatorios de fichaje. Para cerrarla del todo se usa «Salir» en el menú de la bandeja.
- **Recordatorios:** se omiten si el fichaje correspondiente ya está hecho (no avisa de entrada si ya
  fichaste, ni de salida si no estás fichado). Se pueden desactivar en Configuración.
- **Tareas muy atrasadas:** las que llevan más de 30 días vencidas se ocultan por defecto para no
  hacer ruido, y se muestran con el botón «Ver atrasadas +1 mes».
- **Inicio automático:** disponible en Windows y macOS (`app.setLoginItemSettings`). En Linux la
  opción aparece deshabilitada.

## Requisitos en Odoo

- Módulo **Proyecto** instalado (tareas con `date_deadline` y asignación por `user_ids` o `user_id`).
- Módulo **Hoja de horas** (`hr_timesheet`) si querés que el tiempo registrado se vea en las hojas de horas del proyecto.
- Módulo **Asistencias** (`hr_attendance`) y que el usuario tenga un empleado vinculado (`res.users.employee_id`).
- Un usuario o API key con permisos para leer/escribir esos modelos.

## Instalación

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

Levanta Vite en `http://localhost:5173` y abre la ventana de Electron apuntando ahí, con recarga en caliente.

## Build de producción

```bash
npm run build     # compila el frontend a dist/
npm run dist       # genera el instalador de Windows (nsis) con electron-builder
npm run dist:linux # genera un AppImage, útil para probar en Linux/WSL
```

El instalador para Windows se genera mejor corriendo `npm run dist` en Windows (o con Wine en Linux). En WSL puro, `npm run dist:linux` es la forma más simple de probar el empaquetado.

## Notas de diseño

- Las credenciales (URL, base de datos, usuario y contraseña) se guardan cifradas en el equipo con `safeStorage` de Electron, en `session.dat` dentro del directorio de datos de la app.
- El cronómetro vive en el proceso principal de Electron, así que sobrevive a un refresco de la ventana. Solo se puede tener un cronómetro corriendo a la vez.
- Las tareas caducadas se revisan cada 5 minutos en segundo plano; solo se notifica una vez por tarea por sesión para no spamear.
- La detección de "tarea asignada" intenta primero el campo `user_ids` (Odoo 14+, multi-asignación) y si falla cae a `user_id` (versiones más viejas).
