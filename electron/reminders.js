const TIMEZONE = 'America/Guayaquil';
const CHECK_INTERVAL_MS = 30 * 1000;
const TRIGGER_WINDOW_MIN = 10;

const SCHEDULE = [
  {
    id: 'check_in',
    hour: 9,
    minute: 30,
    title: 'Recordatorio de entrada',
    body: 'Son las 09:30. Marca tu entrada en Elideysi.',
  },
  {
    id: 'check_out',
    hour: 17,
    minute: 30,
    title: 'Recordatorio de salida',
    body: 'Son las 17:30. Marca tu salida en Elideysi.',
  },
];

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
  };
}

function createReminderScheduler({ notify, isEnabled, getAttendanceState }) {
  let timer = null;
  const fired = new Set();

  async function shouldNotify(id) {
    // Evita ruido: no recordar la entrada si ya fichó, ni la salida si no está fichado.
    const state = await getAttendanceState();
    if (state === 'unknown') return true;
    return id === 'check_in' ? state === 'out' : state === 'in';
  }

  async function tick() {
    if (!isEnabled()) return;

    const { weekday, dateKey, minutes } = ecuadorNow();
    if (weekday === 'Sat' || weekday === 'Sun') return;

    for (const entry of SCHEDULE) {
      const target = entry.hour * 60 + entry.minute;
      const delta = minutes - target;
      if (delta < 0 || delta > TRIGGER_WINDOW_MIN) continue;

      const key = `${entry.id}:${dateKey}`;
      if (fired.has(key)) continue;
      fired.add(key);

      if (await shouldNotify(entry.id)) {
        notify(entry.title, entry.body);
      }
    }
  }

  return {
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

module.exports = { createReminderScheduler, SCHEDULE };
