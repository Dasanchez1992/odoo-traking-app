const TIMEZONE = 'America/Guayaquil';
const CHECK_INTERVAL_MS = 30 * 1000;

// Si la app no estaba abierta a la hora programada todavía se puede fichar un rato después, pero
// el fichaje queda con la hora real en la que se hizo, no con la programada: por eso la entrada
// admite un margen amplio (llegar y abrir la app) y la salida uno corto, para no cerrar una
// jornada con una hora que no tiene nada que ver con la que se fue.
const MARGEN_MIN = { check_in: 180, check_out: 60 };

function ecuadorNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    label: `${get('hour')}:${get('minute')}`,
  };
}

// 'HH:MM' -> minutos desde medianoche. Devuelve null si el valor no sirve, para no fichar a
// una hora inventada cuando la configuración está corrupta.
function parseHHMM(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hora = Number(match[1]);
  const minuto = Number(match[2]);
  if (hora > 23 || minuto > 59) return null;
  return hora * 60 + minuto;
}

function createAutoAttendanceScheduler({
  isEnabled,
  getTimes,
  getState,
  toggle,
  notify,
  onChange,
  // Inyectable para poder probar el calendario sin depender del reloj del sistema.
  clock = ecuadorNow,
}) {
  let timer = null;
  const hechos = new Set();
  const avisados = new Set();

  async function ejecutar(id, label) {
    // El estado real de Odoo manda: si ya fichó a mano no se duplica, y si no se puede leer
    // se deja pasar en vez de arriesgar un registro equivocado.
    const estado = await getState();
    if (estado === 'unknown') return;
    if (id === 'check_in' && estado !== 'out') return;
    if (id === 'check_out' && estado !== 'in') return;

    await toggle();

    notify(
      id === 'check_in' ? 'Entrada registrada' : 'Salida registrada',
      `Marcación automática de las ${label}.`,
      'attendance',
    );
    onChange();
  }

  async function tick() {
    if (!isEnabled()) return;

    const { weekday, dateKey, minutes, label } = clock();
    if (weekday === 'Sat' || weekday === 'Sun') return;

    const times = getTimes();
    const entradas = [
      { id: 'check_in', target: parseHHMM(times.checkIn) },
      { id: 'check_out', target: parseHHMM(times.checkOut) },
    ];

    for (const { id, target } of entradas) {
      if (target === null) continue;

      const delta = minutes - target;
      if (delta < 0 || delta > MARGEN_MIN[id]) continue;

      const key = `${id}:${dateKey}`;
      if (hechos.has(key)) continue;
      // Se marca antes de empezar: el fichaje tarda y el siguiente tick no debe repetirlo.
      hechos.add(key);

      try {
        await ejecutar(id, label);
      } catch (err) {
        // Un fallo puntual de red no debe perder el fichaje del día: se reintenta mientras
        // siga dentro del margen, avisando una sola vez.
        hechos.delete(key);
        if (!avisados.has(key)) {
          avisados.add(key);
          notify(
            'No se pudo fichar automáticamente',
            `${err.message}. Puedes marcar a mano desde la app.`,
            'attendance',
          );
        }
      }
    }
  }

  return {
    // Comprobación inmediata, también útil al arrancar o al recuperar la sesión.
    check: tick,
    start() {
      this.stop();
      tick();
      timer = setInterval(tick, CHECK_INTERVAL_MS);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

module.exports = { createAutoAttendanceScheduler, parseHHMM };
