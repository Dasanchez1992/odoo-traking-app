from odoo import api, models
from odoo.exceptions import AccessError


class ElipsysDesktopConfig(models.TransientModel):
    _name = 'elipsys.desktop.config'
    _description = 'Configuración que la app de escritorio lee de Odoo'

    @api.model
    def get_config(self):
        """Lo que la app necesita saber de Odoo al arrancar.

        La clave de IA se guarda en los parámetros del sistema, que solo leen los
        administradores de Ajustes; esto la reparte a la plantilla, que es justo para lo que se
        configura. Quien tenga un usuario de Odoo puede leerla: conviene usar una clave propia
        de la empresa, con su límite de gasto.
        """
        if not self.env.user._is_internal():
            raise AccessError('Solo el personal interno puede leer esta configuración.')

        parametros = self.env['ir.config_parameter'].sudo()
        return {
            'aiApiKey': parametros.get_param('elipsys.ai_api_key', default='') or '',
            # Quien está siendo medido no decide si se mide: esto sale de la compañía.
            'trackAppUsage': bool(self.env.company.sudo().elipsys_track_app_usage),
        }
