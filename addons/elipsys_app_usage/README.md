# Elipsys Time — Uso de aplicaciones

Módulo de Odoo **19.0** que guarda el tiempo de uso de aplicaciones que mide la app de escritorio
[Elipsys Time](../../README.md). Sin él la app también funciona, pero guarda los resúmenes como
adjuntos sueltos, que Odoo solo deja leer a los administradores de Ajustes
(`base.group_system`); con el módulo los leen quienes administran Empleados
(`hr.group_hr_manager`), que es el mismo permiso que ya pide la pestaña Equipo.

## Qué instala

| Modelo | Para qué |
| --- | --- |
| `elipsys.app.usage` | Un registro por persona y día: segundos de actividad e inactividad. |
| `elipsys.app.usage.line` | El reparto de ese día por programa. |

Dos entradas en **Empleados › Informes**: «Uso de aplicaciones» (lista, tabla dinámica y gráfico)
y «Tiempo por aplicación» (tabla dinámica por programa).

Una acción planificada diaria borra lo anterior a 180 días.

## Permisos

- Toda la plantilla (`base.group_user`): crea y actualiza **su propio** día, y solo ve el suyo.
- Administración de Empleados (`hr.group_hr_manager`): ve y borra el de todo el equipo.

Las reglas de registro son las que mandan: `record_day` siempre escribe con el usuario que llama
—el contenido enviado no decide de quién es el registro— y `fetch_report` no usa `sudo`, así que
devuelve lo que cada quien tenga derecho a ver.

## Instalación

1. Copiar `elipsys_app_usage/` al directorio de addons (en Odoo.sh, a la carpeta de addons del
   repositorio y hacer push).
2. Actualizar la lista de aplicaciones e instalar **Elipsys Time - Uso de aplicaciones**.

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
