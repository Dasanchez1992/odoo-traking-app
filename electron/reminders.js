const TIMEZONE = 'America/Guayaquil';
const CHECK_INTERVAL_MS = 30 * 1000;
const TRIGGER_WINDOW_MIN = 10;
// El aviso llega antes de la hora, que es cuando sirve para algo: a la hora en punto ya se te
// pasó. Mismo margen para entrada y salida.
const AVISO_ANTES_MIN = 15;
// Y si se pasa igual, se insiste un rato después. Solo mientras el fichaje siga sin hacer: en
// cuanto marca, los siguientes se callan solos.
const AVISOS_DESPUES_MIN = [15, 45, 90];

const HORARIO_POR_DEFECTO = { checkIn: '08:30', checkOut: '17:30' };

function aMinutos(hora, porDefecto) {
  const encaja = /^(\d{1,2}):(\d{2})$/.exec(String(hora || '').trim());
  if (!encaja) return aMinutos(porDefecto, '08:30');
  const h = Number(encaja[1]);
  const m = Number(encaja[2]);
  if (h > 23 || m > 59) return aMinutos(porDefecto, '08:30');
  return h * 60 + m;
}

function comoHora(minutos) {
  const total = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Los avisos del día, calculados desde el horario que tenga configurado cada quien: uno antes de
 * cada fichaje y unos cuantos después, por si se pasó.
 */
function buildSchedule(horario = {}, antesMin = AVISO_ANTES_MIN, despuesMin = AVISOS_DESPUES_MIN) {
  const fichajes = [
    {
      id: 'check_in',
      at: aMinutos(horario.checkIn, HORARIO_POR_DEFECTO.checkIn),
      nombre: 'entrada',
      accion: 'Marca entrada en Elipsys Time.',
    },
    {
      id: 'check_out',
      at: aMinutos(horario.checkOut, HORARIO_POR_DEFECTO.checkOut),
      nombre: 'salida',
      accion: 'Marca salida en Elipsys Time.',
    },
  ];

  const avisos = [];
  fichajes.forEach((fichaje) => {
    avisos.push({
      id: `${fichaje.id}:antes`,
      target: fichaje.id,
      // Si alguien entra a las 00:05, el aviso se queda a las 00:00 en vez de irse al día anterior.
      at: Math.max(0, fichaje.at - antesMin),
      insiste: false,
      title: `Recordatorio de ${fichaje.nombre}`,
      body: `Tu ${fichaje.nombre} es a las ${comoHora(fichaje.at)}. ${fichaje.accion}`,
    });

    despuesMin.forEach((minutos) => {
      const cuando = fichaje.at + minutos;
      // Lo que se pasaría de medianoche no se avisa: ya sería del día siguiente.
      if (cuando > 23 * 60 + 59) return;
      avisos.push({
        id: `${fichaje.id}:despues:${minutos}`,
        target: fichaje.id,
        at: cuando,
        insiste: true,
        title: `Sigues sin marcar ${fichaje.nombre}`,
        body: `Son las ${comoHora(cuando)} y tu ${fichaje.nombre} sigue sin registrar. ${fichaje.accion}`,
      });
    });
  });

  return avisos.sort((a, b) => a.at - b.at);
}

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

function createReminderScheduler({
  notify,
  isEnabled,
  getAttendanceState,
  // El horario sale de la configuración: el mismo que usa la marcación automática.
  getSchedule = () => HORARIO_POR_DEFECTO,
  now = ecuadorNow,
}) {
  let timer = null;
  const fired = new Set();

  async function shouldNotify(target, insiste) {
    // Evita ruido: no recordar la entrada si ya fichó, ni la salida si no está fichado.
    const state = await getAttendanceState();
    // Sin saber cómo está, el aviso previo se manda igual (no cuesta nada) pero no se insiste:
    // dar la lata a alguien que a lo mejor ya fichó es peor que callarse.
    if (state === 'unknown') return !insiste;
    return target === 'check_in' ? state === 'out' : state === 'in';
  }

  async function tick() {
    if (!isEnabled()) return;

    const { weekday, dateKey, minutes } = now();
    if (weekday === 'Sat' || weekday === 'Sun') return;

    for (const entry of buildSchedule(getSchedule())) {
      const delta = minutes - entry.at;
      if (delta < 0 || delta > TRIGGER_WINDOW_MIN) continue;

      const key = `${entry.id}:${dateKey}`;
      if (fired.has(key)) continue;
      fired.add(key);

      if (await shouldNotify(entry.target, entry.insiste)) {
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

module.exports = { createReminderScheduler, buildSchedule, AVISO_ANTES_MIN, AVISOS_DESPUES_MIN };
