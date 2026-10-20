from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    # El registro de uso se enciende y se apaga aquí, no en la app de cada persona: lo decide la
    # empresa, no quien está siendo medido.
    elipsys_track_app_usage = fields.Boolean(
        string='Registrar el uso de aplicaciones',
        default=True,
        help='Las apps de escritorio de esta compañía miden el tiempo que cada programa pasa en '
             'primer plano y lo envían a Odoo. Al desmarcarlo dejan de medir en cuanto se '
             'conectan.',
    )
