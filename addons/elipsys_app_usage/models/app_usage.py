from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

# Tope de aplicaciones por día: la app de escritorio ya manda las más usadas y agrupa el resto.
MAX_LINEAS = 100
DIAS_RETENCION = 180


class ElipsysAppUsage(models.Model):
    _name = 'elipsys.app.usage'
    _description = 'Uso diario de aplicaciones'
    _order = 'date desc, active_seconds desc'
    _rec_name = 'date'

    user_id = fields.Many2one(
        'res.users',
        string='Usuario',
        required=True,
        index=True,
        ondelete='cascade',
        default=lambda self: self.env.user,
    )
    employee_id = fields.Many2one(
        'hr.employee',
        string='Empleado',
        compute='_compute_employee_id',
        store=True,
        ondelete='set null',
    )
    department_id = fields.Many2one(
        related='employee_id.department_id',
        string='Departamento',
        store=True,
    )
    date = fields.Date(string='Día', required=True, index=True, default=fields.Date.context_today)
    active_seconds = fields.Integer(string='Segundos de actividad', default=0)
    idle_seconds = fields.Integer(string='Segundos de inactividad', default=0)
    active_hours = fields.Float(string='Horas de actividad', compute='_compute_hours', store=True)
    idle_hours = fields.Float(string='Horas de inactividad', compute='_compute_hours', store=True)
    line_ids = fields.One2many('elipsys.app.usage.line', 'usage_id', string='Aplicaciones')

    _user_date_uniq = models.Constraint(
        'unique (user_id, date)',
        'Ya hay un registro de uso de ese día para esa persona.',
    )
    _user_date_idx = models.Index('(user_id, date)')

    @api.depends('user_id')
    def _compute_employee_id(self):
        # En sudo a propósito: quien envía su propio uso no tiene por qué poder leer hr.employee.
        for registro in self:
            registro.employee_id = self.env['hr.employee'].sudo().search(
                [('user_id', '=', registro.user_id.id)], limit=1,
            )

    @api.depends('active_seconds', 'idle_seconds')
    def _compute_hours(self):
        for registro in self:
            registro.active_hours = registro.active_seconds / 3600
            registro.idle_hours = registro.idle_seconds / 3600

    @api.depends('user_id', 'date')
    def _compute_display_name(self):
        for registro in self:
            registro.display_name = f'{registro.user_id.name} · {registro.date or ""}'

    # --- Lo que llama la app de escritorio ------------------------------------------------------

    @api.model
    def record_day(self, payload):
        """Guarda el resumen de un día.

        Siempre del usuario que llama: el payload no decide de quién es el registro, así que
        nadie puede escribir (ni falsear) el uso de otra persona.
        """
        if not isinstance(payload, dict):
            raise UserError('El resumen de uso no tiene el formato esperado.')

        fecha = fields.Date.to_date(payload.get('date'))
        if not fecha:
            raise UserError('El resumen de uso viene sin día.')

        valores = {
            'active_seconds': max(0, int(payload.get('activeSeconds') or 0)),
            'idle_seconds': max(0, int(payload.get('idleSeconds') or 0)),
        }

        registro = self.search(
            [('user_id', '=', self.env.uid), ('date', '=', fecha)], limit=1,
        )
        if registro:
            registro.write(valores)
        else:
            registro = self.create({**valores, 'user_id': self.env.uid, 'date': fecha})

        # Las líneas se tocan en sudo: son del propio registro, ya comprobado, y así no hace
        # falta darle a nadie permiso de borrado sobre ellas.
        registro.sudo()._guardar_lineas(payload.get('apps') or [])
        return registro.id

    def _guardar_lineas(self, apps):
        self.ensure_one()

        deseadas = {}
        for entrada in list(apps)[:MAX_LINEAS]:
            if not isinstance(entrada, dict):
                continue
            clave = str(entrada.get('app') or '').strip().lower()[:64]
            segundos = max(0, int(entrada.get('seconds') or 0))
            if not clave or not segundos:
                continue
            deseadas[clave] = {
                'label': (str(entrada.get('label') or clave).strip() or clave)[:128],
                'seconds': segundos,
            }

        Linea = self.env['elipsys.app.usage.line']
        sobrantes = {linea.app: linea for linea in self.line_ids}
        nuevas = []
        for clave, datos in deseadas.items():
            linea = sobrantes.pop(clave, None)
            if linea is None:
                nuevas.append({'usage_id': self.id, 'app': clave, **datos})
            elif linea.seconds != datos['seconds'] or linea.label != datos['label']:
                # Solo se reescribe lo que cambió: una sincronización típica mueve una o dos.
                linea.write(datos)
        if nuevas:
            Linea.create(nuevas)
        if sobrantes:
            Linea.browse([linea.id for linea in sobrantes.values()]).unlink()

    @api.model
    def fetch_report(self, date_from, date_to, limit=5000):
        """Lo que pinta la pestaña Equipo de la app.

        No lleva sudo a propósito: las reglas de registro deciden qué se devuelve. Cada quien ve
        lo suyo y quien administra Empleados, el de todos.
        """
        desde = fields.Date.to_date(date_from)
        hasta = fields.Date.to_date(date_to)
        if not desde or not hasta or hasta < desde:
            raise UserError('El rango de fechas no es válido.')

        registros = self.search(
            [('date', '>=', desde), ('date', '<=', hasta)], limit=limit,
        )
        return [
            {
                'date': str(registro.date),
                'userId': registro.user_id.id,
                'userName': registro.user_id.name,
                'activeSeconds': registro.active_seconds,
                'idleSeconds': registro.idle_seconds,
                'apps': [
                    {'app': linea.app, 'label': linea.label or linea.app, 'seconds': linea.seconds}
                    for linea in registro.line_ids
                ],
            }
            for registro in registros
        ]

    @api.model
    def _gc_old_records(self, days=DIAS_RETENCION):
        """Acción planificada: el historial no crece para siempre."""
        limite = fields.Date.context_today(self) - timedelta(days=days)
        viejos = self.sudo().search([('date', '<', limite)])
        cuantos = len(viejos)
        viejos.unlink()
        return cuantos


class ElipsysAppUsageLine(models.Model):
    _name = 'elipsys.app.usage.line'
    _description = 'Tiempo de una aplicación en un día'
    _order = 'seconds desc, id'
    _rec_name = 'label'

    usage_id = fields.Many2one(
        'elipsys.app.usage',
        string='Uso del día',
        required=True,
        index=True,
        ondelete='cascade',
    )
    # Copias guardadas para poder filtrar y agrupar por persona o por fecha sin pasar por el padre.
    user_id = fields.Many2one(related='usage_id.user_id', string='Usuario', store=True, index=True)
    date = fields.Date(related='usage_id.date', string='Día', store=True, index=True)
    department_id = fields.Many2one(related='usage_id.department_id', string='Departamento', store=True)
    app = fields.Char(string='Programa', required=True, index=True)
    label = fields.Char(string='Aplicación')
    seconds = fields.Integer(string='Segundos')
    hours = fields.Float(string='Horas', compute='_compute_hours', store=True)

    _usage_app_uniq = models.Constraint(
        'unique (usage_id, app)',
        'Esa aplicación ya está en el registro de ese día.',
    )

    @api.depends('seconds')
    def _compute_hours(self):
        for linea in self:
            linea.hours = linea.seconds / 3600
