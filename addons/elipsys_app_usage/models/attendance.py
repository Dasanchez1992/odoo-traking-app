from odoo import api, fields, models
from odoo.exceptions import UserError


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    # Odoo 19 solo deja crear asistencias a quien administra Asistencias, y al cerrar una calcula
    # las horas extra creando líneas de `hr.attendance.overtime.line` con el usuario en curso, que
    # tampoco puede. Resultado: fichar desde fuera de Odoo falla salvo que se reparta el permiso
    # de responsable de asistencias, que además deja ver las de los demás.
    #
    # Estos métodos hacen lo mismo que el kiosco de Odoo (`employee.sudo()._attendance_action_change()`)
    # pero siempre sobre el empleado del usuario que llama: nunca se recibe un empleado por
    # parámetro, así que nadie puede fichar por otra persona.

    def _elipsys_mi_empleado(self):
        empleado = self.env.user.employee_id
        if not empleado:
            raise UserError(
                'Tu usuario de Odoo no tiene un empleado vinculado, así que no se puede fichar.'
            )
        return empleado.sudo()

    def _elipsys_abierta(self, empleado):
        return self.env['hr.attendance'].sudo().search(
            [('employee_id', '=', empleado.id), ('check_out', '=', False)],
            order='check_in desc',
            limit=1,
        )

    @api.model
    def elipsys_attendance_state(self):
        empleado = self._elipsys_mi_empleado()
        abierta = self._elipsys_abierta(empleado)
        return {
            'employeeId': empleado.id,
            'employeeName': empleado.name,
            'state': empleado.attendance_state,
            'attendanceId': abierta.id or False,
            'checkIn': str(abierta.check_in) if abierta.check_in else False,
        }

    @api.model
    def elipsys_attendance_toggle(self):
        """Marca entrada o salida, lo que toque."""
        empleado = self._elipsys_mi_empleado()
        entraba = empleado.attendance_state != 'checked_in'
        asistencia = empleado._attendance_action_change()
        return {
            'action': 'check_in' if entraba else 'check_out',
            'attendanceId': asistencia.id,
            'checkIn': str(asistencia.check_in) if asistencia.check_in else False,
            'checkOut': str(asistencia.check_out) if asistencia.check_out else False,
        }

    @api.model
    def elipsys_attendance_close(self, check_out=False):
        """Cierra un fichaje que quedó abierto, a la hora indicada o ahora mismo."""
        empleado = self._elipsys_mi_empleado()
        abierta = self._elipsys_abierta(empleado)
        if not abierta:
            raise UserError('No hay ningún fichaje abierto que cerrar.')

        momento = fields.Datetime.to_datetime(check_out) if check_out else fields.Datetime.now()
        if not momento:
            raise UserError('La hora de salida no es válida.')
        if momento <= abierta.check_in:
            raise UserError('La salida tiene que ser posterior a la entrada.')
        if momento > fields.Datetime.now():
            raise UserError('No se puede registrar una salida en el futuro.')

        abierta.write({'check_out': momento})
        return {
            'action': 'check_out',
            'attendanceId': abierta.id,
            'checkIn': str(abierta.check_in),
            'checkOut': str(abierta.check_out),
        }
