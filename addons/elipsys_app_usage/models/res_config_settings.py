from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    elipsys_ai_api_key = fields.Char(
        string='Clave de API de Claude',
        config_parameter='elipsys.ai_api_key',
        help='La app de escritorio la usa para redactar descripciones, resumir reuniones y '
             'ayudar con los tickets. Si se deja vacía, cada quien pone la suya en la app. '
             'Cualquier usuario interno puede leerla desde la app, así que conviene que sea una '
             'clave de la empresa con límite de gasto.',
    )
