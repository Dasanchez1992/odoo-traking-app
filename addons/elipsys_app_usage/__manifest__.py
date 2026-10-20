{
    'name': 'Elipsys Time - Uso de aplicaciones',
    'summary': 'Guarda el tiempo de uso de aplicaciones que envía la app de escritorio Elipsys Time',
    'description': """
Uso de aplicaciones
===================

Recoge lo que la app de escritorio **Elipsys Time** mide en cada equipo: el tiempo que cada
programa pasa en primer plano, por día y por persona. No guarda títulos de ventana, ni teclas,
ni capturas de pantalla.

Quién ve qué
------------

* Cada persona ve y envía **solo lo suyo**.
* Quien administra Empleados (``hr.group_hr_manager``) ve el de todo el equipo, en la app y en
  el menú Empleados / Informes / Uso de aplicaciones.

Lo anterior a 180 días se borra solo con una acción planificada diaria.
""",
    'version': '19.0.1.0.0',
    'category': 'Human Resources',
    'author': 'Elipsys',
    'website': 'https://www.elipsys.ec',
    'license': 'LGPL-3',
    'depends': ['hr', 'hr_attendance'],
    'data': [
        # Los grupos primero: el csv de permisos se apoya en ellos.
        'security/app_usage_security.xml',
        'security/ir.model.access.csv',
        'data/ir_cron.xml',
        'data/usuarios.xml',
        'views/app_usage_views.xml',
        'views/res_config_settings_views.xml',
    ],
    'installable': True,
    'application': False,
}
