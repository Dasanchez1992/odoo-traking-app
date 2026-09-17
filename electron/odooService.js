const TASK_FIELDS = [
  'id',
  'name',
  'project_id',
  'date_deadline',
  'priority',
  'stage_id',
  'partner_id',
  'allocated_hours',
  'effective_hours',
  'remaining_hours',
  'state',
];

// project.task.state en Odoo 17+: '1_done' (hecha) y '1_canceled' (cancelada) son estados cerrados.
const CLOSED_TASK_STATES = ['1_done', '1_canceled'];

// planned_date_begin solo existe con la planificación de proyectos de Odoo Enterprise.
const TASK_FIELDS_PLANNED = [...TASK_FIELDS, 'planned_date_begin'];

// Odoo 16 y anteriores no tienen allocated_hours (se llamaba planned_hours).
const TASK_FIELDS_BASIC = ['id', 'name', 'project_id', 'date_deadline', 'priority', 'stage_id'];

// Nada se registra por debajo de 5 minutos.
const MIN_BILLABLE_MINUTES = 5;
const MIN_BILLABLE_HOURS = MIN_BILLABLE_MINUTES / 60;

function toOdooUtcString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

async function searchTasksWithFallback(client, extraDomain, order) {
  const domains = [
    [['user_ids', 'in', [client.uid]], ...extraDomain],
    [['user_id', '=', client.uid], ...extraDomain],
  ];
  let lastError;
  for (const fields of [TASK_FIELDS_PLANNED, TASK_FIELDS, TASK_FIELDS_BASIC]) {
    for (const domain of domains) {
      try {
        return await client.execute_kw('project.task', 'search_read', [domain, fields], { order });
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError;
}

// Solo tareas vivas: se descartan las cerradas por estado y, si esa versión de Odoo no tiene
// el campo state, las que están en una etapa plegada (que es donde suelen ir las terminadas).
async function fetchAssignedTasks(client) {
  const base = [['active', '=', true]];
  const variants = [
    [...base, ['state', 'not in', CLOSED_TASK_STATES]],
    [...base, ['stage_id.fold', '=', false]],
    base,
  ];

  let lastError;
  for (const domain of variants) {
    try {
      return await searchTasksWithFallback(client, domain, 'date_deadline asc');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function fetchOverdueTasks(client) {
  const nowStr = toOdooUtcString(new Date());
  const extraDomain = [
    ['date_deadline', '<', nowStr],
    ['date_deadline', '!=', false],
    ['active', '=', true],
  ];
  const variants = [
    [...extraDomain, ['state', 'not in', CLOSED_TASK_STATES]],
    [...extraDomain, ['stage_id.fold', '=', false]],
    extraDomain,
  ];

  let lastError;
  for (const domain of variants) {
    try {
      return await searchTasksWithFallback(client, domain, 'date_deadline asc');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

const TICKET_FIELDS_FULL = [
  'id',
  'name',
  'ticket_ref',
  'partner_id',
  'team_id',
  'stage_id',
  'priority',
  'create_date',
  'project_id',
  'sla_deadline',
  'total_hours_spent',
];
const TICKET_FIELDS_BASIC = ['id', 'name', 'team_id', 'stage_id', 'priority', 'create_date'];

// Helpdesk es de Odoo Enterprise y puede no estar instalado: si el modelo no existe,
// la app simplemente no muestra la pestaña de tickets.
async function fetchAssignedTickets(client) {
  const baseDomain = [['user_id', '=', client.uid]];
  // Un ticket cerrado tiene close_date y suele quedar en una etapa plegada.
  const openDomain = [
    ...baseDomain,
    ['stage_id.fold', '=', false],
    ['close_date', '=', false],
  ];
  const attempts = [
    { domain: openDomain, fields: TICKET_FIELDS_FULL },
    { domain: [...baseDomain, ['stage_id.fold', '=', false]], fields: TICKET_FIELDS_FULL },
    { domain: baseDomain, fields: TICKET_FIELDS_FULL },
    { domain: baseDomain, fields: TICKET_FIELDS_BASIC },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const tickets = await client.execute_kw('helpdesk.ticket', 'search_read', [
        attempt.domain,
        attempt.fields,
      ]);
      return { available: true, tickets };
    } catch (err) {
      lastError = err;
    }
  }

  return { available: false, tickets: [], reason: lastError ? lastError.message : '' };
}

async function resolveTicketProjectId(client, ticketId) {
  try {
    const [ticket] = await client.execute_kw('helpdesk.ticket', 'read', [
      [ticketId],
      ['project_id', 'team_id'],
    ]);
    if (ticket && ticket.project_id) return ticket.project_id[0];
    if (ticket && ticket.team_id) {
      const [team] = await client.execute_kw('helpdesk.team', 'read', [
        [ticket.team_id[0]],
        ['project_id'],
      ]);
      if (team && team.project_id) return team.project_id[0];
    }
  } catch {
    // El helpdesk puede no tener hojas de horas configuradas.
  }
  return null;
}

async function logTicketTimesheet(
  client,
  { ticketId, projectId, startedAt, stoppedAt, description },
) {
  const hours = (stoppedAt - startedAt) / 3600000;
  const unitAmount = Math.max(MIN_BILLABLE_HOURS, Math.round(hours * 100) / 100);

  const resolvedProjectId = projectId || (await resolveTicketProjectId(client, ticketId));
  if (!resolvedProjectId) {
    throw new Error(
      'El ticket no tiene un proyecto de hojas de horas configurado en Odoo (se define en el ' +
        'equipo de asistencia), así que no se puede registrar el tiempo.',
    );
  }

  return client.execute_kw('account.analytic.line', 'create', [
    {
      helpdesk_ticket_id: ticketId,
      project_id: resolvedProjectId,
      unit_amount: unitAmount,
      name: (description || '').trim() || 'Registrado desde Elideysi',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function logTimesheet(client, { taskId, projectId, startedAt, stoppedAt, description }) {
  const hours = (stoppedAt - startedAt) / 3600000;
  const unitAmount = Math.max(MIN_BILLABLE_HOURS, Math.round(hours * 100) / 100);

  // project_id es obligatorio en las hojas de horas; si no vino con la tarea, se relee de Odoo.
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const [task] = await client.execute_kw('project.task', 'read', [[taskId], ['project_id']]);
    resolvedProjectId = task && task.project_id ? task.project_id[0] : null;
  }
  if (!resolvedProjectId) {
    throw new Error(
      'La tarea no tiene un proyecto asignado en Odoo, así que no se puede registrar el tiempo. ' +
        'Asígnale un proyecto y vuelve a intentarlo.',
    );
  }

  return client.execute_kw('account.analytic.line', 'create', [
    {
      task_id: taskId,
      project_id: resolvedProjectId,
      unit_amount: unitAmount,
      name: (description || '').trim() || 'Registrado desde Elideysi',
      date: new Date(startedAt).toISOString().slice(0, 10),
    },
  ]);
}

async function getEmployeeId(client) {
  const users = await client.execute_kw('res.users', 'read', [[client.uid], ['employee_id']]);
  const empField = users[0] && users[0].employee_id;
  if (empField) return empField[0];

  const employees = await client.execute_kw('hr.employee', 'search_read', [
    [['user_id', '=', client.uid]],
    ['id'],
  ]);
  if (employees.length) return employees[0].id;

  throw new Error('No se encontró un empleado de RRHH vinculado a este usuario en Odoo');
}

function isAccessError(err) {
  const msg = (err && err.message) || '';
  return /access|permis|derecho|allowed|AccessError/i.test(msg);
}

// Los usuarios sin grupo de asistencias no pueden leer hr.attendance, pero sí su propia ficha de
// empleado, que ya expone el estado. Se intenta primero esa vía, como hace la propia web de Odoo.
async function getOpenAttendance(client, employeeId) {
  try {
    const [employee] = await client.execute_kw('hr.employee', 'read', [
      [employeeId],
      ['attendance_state', 'last_attendance_id'],
    ]);

    if (employee && employee.attendance_state !== undefined) {
      if (employee.attendance_state !== 'checked_in') return null;

      const attendanceId = Array.isArray(employee.last_attendance_id)
        ? employee.last_attendance_id[0]
        : null;
      if (!attendanceId) return { id: 0, check_in: false };

      try {
        const [attendance] = await client.execute_kw('hr.attendance', 'read', [
          [attendanceId],
          ['check_in'],
        ]);
        return { id: attendanceId, check_in: attendance ? attendance.check_in : false };
      } catch {
        // Sabemos que está fichado aunque no podamos leer la hora exacta.
        return { id: attendanceId, check_in: false };
      }
    }
  } catch (err) {
    if (!isAccessError(err)) throw err;
  }

  const recs = await client.execute_kw('hr.attendance', 'search_read', [
    [
      ['employee_id', '=', employeeId],
      ['check_out', '=', false],
    ],
    ['id', 'check_in'],
  ]);
  return recs[0] || null;
}

async function toggleAttendance(client, employeeId) {
  // No poder leer el estado no impide fichar: attendance_manual alterna por sí solo.
  let open = null;
  let stateKnown = true;
  try {
    open = await getOpenAttendance(client, employeeId);
  } catch {
    stateKnown = false;
  }

  const nowStr = toOdooUtcString(new Date());

  // attendance_manual es el método que usa la propia web de Odoo para fichar; se ejecuta con
  // permisos elevados, así que funciona aunque el usuario no pueda escribir en hr.attendance.
  let manualError;
  try {
    await client.execute_kw('hr.employee', 'attendance_manual', [
      [employeeId],
      'hr_attendance.hr_attendance_action_my_attendances',
    ]);
    return { action: stateKnown ? (open ? 'check_out' : 'check_in') : 'toggled', at: nowStr };
  } catch (err) {
    manualError = err;
    if (!isAccessError(err) && !/attendance_manual|does not exist|no existe/i.test(err.message)) {
      throw err;
    }
  }

  // Sin conocer el estado no se puede escribir a ciegas: se duplicaría una entrada abierta.
  if (!stateKnown) {
    throw manualError;
  }

  if (open) {
    await client.execute_kw('hr.attendance', 'write', [[open.id], { check_out: nowStr }]);
    return { action: 'check_out', at: nowStr };
  }
  await client.execute_kw('hr.attendance', 'create', [
    { employee_id: employeeId, check_in: nowStr },
  ]);
  return { action: 'check_in', at: nowStr };
}

async function fetchProductivity(client, days = 14) {
  const { ecuadorDateKey } = require('./dateUtil');
  const sinceKey = ecuadorDateKey(new Date(Date.now() - (days - 1) * 86400000));
  const lineFields = ['date', 'unit_amount', 'project_id'];

  let lines;
  try {
    lines = await client.execute_kw('account.analytic.line', 'search_read', [
      [
        ['user_id', '=', client.uid],
        ['date', '>=', sinceKey],
      ],
      lineFields,
    ]);
  } catch {
    const employeeId = await getEmployeeId(client);
    lines = await client.execute_kw('account.analytic.line', 'search_read', [
      [
        ['employee_id', '=', employeeId],
        ['date', '>=', sinceKey],
      ],
      lineFields,
    ]);
  }

  let attendances = [];
  try {
    const employeeId = await getEmployeeId(client);
    attendances = await client.execute_kw('hr.attendance', 'search_read', [
      [
        ['employee_id', '=', employeeId],
        ['check_in', '>=', `${sinceKey} 00:00:00`],
      ],
      ['check_in', 'check_out', 'worked_hours'],
    ]);
  } catch {
    attendances = [];
  }

  return { sinceKey, days, lines, attendances };
}

// Ecuador es UTC-5 fijo (sin horario de verano), así que el día local empieza a las 05:00 UTC.
function ecuadorDayStartUtc(dayKey) {
  return `${dayKey} 05:00:00`;
}

function mondayOf(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

// El panel de equipo es solo para quien administra Empleados en Odoo.
async function canManageTeam(client) {
  try {
    const result = await client.execute_kw('res.users', 'has_group', [
      [client.uid],
      'hr.group_hr_manager',
    ]);
    if (typeof result === 'boolean') return result;
  } catch {
    // has_group puede no ser invocable por RPC según la versión.
  }

  try {
    // Sin permisos de RRHH, hr.employee no es legible (los demás usan hr.employee.public).
    const count = await client.execute_kw('hr.employee', 'search_count', [[['active', '=', true]]]);
    return count > 1;
  } catch {
    return false;
  }
}

async function sumByEmployee(client, model, domain, field) {
  const groups = await client.execute_kw(model, 'read_group', [domain, [field], ['employee_id']], {
    lazy: false,
  });
  const totals = {};
  groups.forEach((group) => {
    const rel = group.employee_id;
    const id = Array.isArray(rel) ? rel[0] : rel;
    if (id) totals[id] = group[field] || 0;
  });
  return totals;
}

async function fetchTeamProductivity(client) {
  const { ecuadorDateKey } = require('./dateUtil');
  const today = ecuadorDateKey(new Date());
  const weekStart = mondayOf(today);

  const employees = await client.execute_kw(
    'hr.employee',
    'search_read',
    [
      // El propio usuario queda fuera: su detalle ya está en la pestaña de productividad.
      [
        ['active', '=', true],
        ['user_id', '!=', client.uid],
      ],
      ['name', 'user_id', 'department_id'],
    ],
    { limit: 400, order: 'name asc' },
  );
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return { today, weekStart, employees: [] };

  const safeSum = async (model, domain, field) => {
    try {
      return await sumByEmployee(client, model, domain, field);
    } catch {
      return {};
    }
  };

  const [loggedWeek, loggedToday, workedWeek] = await Promise.all([
    safeSum(
      'account.analytic.line',
      [
        ['employee_id', 'in', ids],
        ['date', '>=', weekStart],
      ],
      'unit_amount',
    ),
    safeSum(
      'account.analytic.line',
      [
        ['employee_id', 'in', ids],
        ['date', '=', today],
      ],
      'unit_amount',
    ),
    safeSum(
      'hr.attendance',
      [
        ['employee_id', 'in', ids],
        ['check_in', '>=', ecuadorDayStartUtc(weekStart)],
      ],
      'worked_hours',
    ),
  ]);

  let todayAttendances = [];
  try {
    todayAttendances = await client.execute_kw('hr.attendance', 'search_read', [
      [
        ['employee_id', 'in', ids],
        ['check_in', '>=', ecuadorDayStartUtc(today)],
      ],
      ['employee_id', 'check_in', 'check_out', 'worked_hours'],
    ]);
  } catch {
    todayAttendances = [];
  }

  const byEmployee = new Map();
  todayAttendances.forEach((att) => {
    const id = Array.isArray(att.employee_id) ? att.employee_id[0] : att.employee_id;
    const current = byEmployee.get(id) || { firstCheckIn: null, worked: 0, open: false };
    if (!current.firstCheckIn || att.check_in < current.firstCheckIn) {
      current.firstCheckIn = att.check_in;
    }
    current.worked += att.check_out
      ? att.worked_hours || 0
      : (Date.now() - new Date(`${att.check_in.replace(' ', 'T')}Z`).getTime()) / 3600000;
    if (!att.check_out) current.open = true;
    byEmployee.set(id, current);
  });

  return {
    today,
    weekStart,
    employees: employees.map((employee) => {
      const attendance = byEmployee.get(employee.id) || {
        firstCheckIn: null,
        worked: 0,
        open: false,
      };
      return {
        id: employee.id,
        name: employee.name,
        department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
        hasUser: !!employee.user_id,
        firstCheckIn: attendance.firstCheckIn,
        checkedIn: attendance.open,
        workedToday: Math.round(attendance.worked * 100) / 100,
        workedWeek: Math.round((workedWeek[employee.id] || 0) * 100) / 100,
        loggedToday: Math.round((loggedToday[employee.id] || 0) * 100) / 100,
        loggedWeek: Math.round((loggedWeek[employee.id] || 0) * 100) / 100,
      };
    }),
  };
}

module.exports = {
  canManageTeam,
  fetchTeamProductivity,
  fetchAssignedTasks,
  fetchAssignedTickets,
  fetchOverdueTasks,
  fetchProductivity,
  logTimesheet,
  logTicketTimesheet,
  getEmployeeId,
  getOpenAttendance,
  toggleAttendance,
};
