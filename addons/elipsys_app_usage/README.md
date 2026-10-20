# Elipsys Time — Soporte en Odoo

Módulo de Odoo **19.0** que resuelve en el servidor tres cosas de la app de escritorio
[Elipsys Time](../../README.md): dónde se guarda el uso de aplicaciones, el fichaje sin repartir
permisos de Asistencias, y la clave de IA de la empresa.

## 1. Uso de aplicaciones

Guarda el tiempo de uso de aplicaciones que mide la app. Sin él la app también funciona, pero guarda los resúmenes como
adjuntos sueltos, que Odoo solo deja leer a los administradores de Ajustes
(`base.group_system`); con el módulo los leen quienes administran Empleados
(`hr.group_hr_manager`), que es el mismo permiso que ya pide la pestaña Equipo.

## Qué instala

| Modelo | Para qué |
| --- | --- |
| `elipsys.app.usage` | Un registro por persona y día: segundos de actividad e inactividad. |
| `elipsys.app.usage.line` | El reparto de ese día por programa. |
| `elipsys.desktop.config` | Lo que la app lee de Odoo al entrar (la clave de IA). |

Un menú propio **Elipsys Time** con dos entradas: «Uso de aplicaciones» (lista, tabla dinámica y
gráfico) y «Tiempo por aplicación» (tabla dinámica por programa). Cuelga de su propio menú y no de
Empleados a propósito: quien revisa el uso no tiene por qué administrar RRHH.

Una acción planificada diaria borra lo anterior a 180 días.

### El permiso

**Elipsys Time → Uso de aplicaciones → «Revisar el uso de aplicaciones»**
(`elipsys_app_usage.group_app_usage_reviewer`), que se asigna en la ficha de cada usuario. Quien
lo tiene ve el uso de toda la plantilla, en el menú de Odoo y en la pestaña Equipo de la app;
quien no, solo el suyo. No va atado a los permisos de Empleados, así que se le puede dar al
responsable de un área sin convertirlo en administrador de RRHH.

Al instalar, el administrador se lo queda para poder repartirlo.

### El interruptor

**Ajustes › Empleados › Elipsys Time → «Registrar el uso de aplicaciones»**, que es un campo de la
compañía (`res.company.elipsys_track_app_usage`, encendido por defecto). Al apagarlo, las apps
dejan de medir en cuanto se conectan. **No se puede apagar desde la app**: quien está siendo
medido no decide si se mide.

## 2. Fichaje sin permisos de más

Odoo 19 solo deja crear asistencias a quien administra Asistencias, y al cerrar una calcula las
horas extra creando líneas de `hr.attendance.overtime.line` **con el usuario en curso**, que
tampoco puede. Por eso fichar desde fuera de Odoo falla con un error de permisos, y la única
salida era repartir el grupo «Officer: Manage attendances», que además deja ver y editar las
asistencias de los demás.

El módulo añade a `hr.employee` tres métodos que hacen lo mismo que el kiosco de Odoo
(`employee.sudo()._attendance_action_change()`), pero **siempre sobre el empleado del usuario que
llama** —nunca se recibe un empleado por parámetro, así que nadie puede fichar por otro—:

| Método | Para qué |
| --- | --- |
| `elipsys_attendance_state()` | Si está dentro o fuera y desde cuándo. |
| `elipsys_attendance_toggle()` | Marca entrada o salida, lo que toque. |
| `elipsys_attendance_close(check_out=False)` | Cierra un fichaje que quedó abierto. |

La app los usa si están; si no, sigue por donde iba. Nadie gana permiso para tocar las
asistencias de otra persona: lo comprobamos en las pruebas.

## 3. Clave de IA de la empresa

En **Ajustes › Empleados › Elipsys Time** (solo Administración/Ajustes) se puede guardar una clave
de API de Claude para toda la plantilla; se guarda en `ir.config_parameter`
(`elipsys.ai_api_key`). La app la lee con `elipsys.desktop.config.get_config()`, que es lo único
que expone de los parámetros del sistema.

Si alguien guarda su clave personal en la app, manda la suya. Si no hay ninguna de las dos, la
asistencia de IA queda apagada.

> **Ojo:** cualquier usuario interno puede leer esa clave desde la app. Conviene que sea una clave
> de la empresa, con su propio límite de gasto, y no la personal de nadie.

## Permisos

- Toda la plantilla (`base.group_user`): crea y actualiza **su propio** día, y solo ve el suyo.
- «Revisar el uso de aplicaciones»: ve y borra el de todo el equipo.

Las reglas de registro son las que mandan: `record_day` siempre escribe con el usuario que llama
—el contenido enviado no decide de quién es el registro— y `fetch_report` no usa `sudo`, así que
devuelve lo que cada quien tenga derecho a ver.

## Instalación

Depende de `hr` y `hr_attendance`.

1. Copiar `elipsys_app_usage/` al directorio de addons (en Odoo.sh, a la carpeta de addons del
   repositorio y hacer push).
2. Actualizar la lista de aplicaciones e instalar **Elipsys Time - Uso de aplicaciones**.
3. Repartir el permiso «Revisar el uso de aplicaciones» a quien deba revisarlo.
4. Opcional: poner la clave de Claude en Ajustes › Empleados › Elipsys Time.

La app de escritorio lo detecta sola (`ir.model`, cada 30 minutos como mucho) y a partir de ahí
manda el uso al modelo en vez de a los adjuntos. Los adjuntos antiguos (`elipsys-uso-u*.json`)
se pueden borrar a mano desde Ajustes › Técnico › Adjuntos si ya no hacen falta.

## Lo que envía la app

```jsonc
// record_day(payload)
{
  "date": "2026-10-20",
  "activeSeconds": 18234,
  "idleSeconds": 1200,
  "apps": [
    { "app": "chrome", "label": "Google Chrome", "seconds": 5400 }
  ]
}
```

Nombre y descripción del programa, y nada más: ni títulos de ventana, ni teclas, ni capturas.
