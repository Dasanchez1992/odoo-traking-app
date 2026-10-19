import { useEffect, useRef, useState } from 'react';
import { Recording } from '../types';
import { startRecorder, RecorderHandle } from '../lib/recorder';
import { formatElapsed, useNow } from '../lib/format';
import { formatOdooDateShort } from '../lib/odooDate';
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconExternal,
  IconSparkle,
  IconStop,
  IconTrash,
} from './Icons';

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number) {
  return formatElapsed(ms);
}

export default function MeetingsPanel() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [sources, setSources] = useState<{ mic: boolean; system: boolean } | null>(null);

  const [transcript, setTranscript] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [aiOk, setAiOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleRef = useRef<RecorderHandle | null>(null);
  const now = useNow(recordingId !== null);

  async function load() {
    setRecordings(await window.api.listRecordings().catch(() => []));
  }

  useEffect(() => {
    load();
    window.api
      .getAiStatus()
      .then((estado) => setAiOk(estado.available))
      .catch(() => setAiOk(false));
  }, []);

  const actual = recordings.find((r) => r.id === selected) ?? null;

  // El audio se pide al proceso principal y se reproduce desde memoria: el disco no se expone.
  useEffect(() => {
    let url: string | null = null;
    if (!selected) {
      setAudioUrl(null);
      return;
    }
    setTranscript(recordings.find((r) => r.id === selected)?.transcript ?? '');
    window.api
      .getRecordingAudio(selected)
      .then((datos) => {
        // El IPC entrega los bytes crudos; se copian a un ArrayBuffer propio para el Blob.
        const copia = new Uint8Array(datos).slice().buffer;
        url = URL.createObjectURL(new Blob([copia], { type: 'audio/webm' }));
        setAudioUrl(url);
      })
      .catch(() => setAudioUrl(null));

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function comenzar() {
    setError(null);
    setBusy(true);
    try {
      const ficha = await window.api.startRecording(title);
      const handle = await startRecorder((chunk) => {
        window.api.pushRecordingChunk(ficha.id, chunk).catch(() => {});
      });
      handleRef.current = handle;
      setSources({ mic: handle.hasMic, system: handle.hasSystemAudio });
      setRecordingId(ficha.id);
      setStartedAt(Date.now());
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar a grabar');
    } finally {
      setBusy(false);
    }
  }

  async function detener() {
    const handle = handleRef.current;
    const id = recordingId;
    if (!handle || !id) return;
    setBusy(true);
    try {
      const duracion = await handle.stop();
      await window.api.finishRecording(id, duracion);
      handleRef.current = null;
      setRecordingId(null);
      setStartedAt(null);
      setSources(null);
      await load();
      setSelected(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la grabación');
    } finally {
      setBusy(false);
    }
  }

  async function guardarTexto() {
    if (!actual) return;
    setBusy(true);
    try {
      await window.api.updateRecording(actual.id, { transcript });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el texto');
    } finally {
      setBusy(false);
    }
  }

  async function resumir() {
    if (!actual) return;
    setSummarizing(true);
    setError(null);
    try {
      // Se guarda el texto antes de resumir: el resumen sale de lo que hay en disco.
      await window.api.updateRecording(actual.id, { transcript });
      await window.api.summarizeMeeting(actual.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo resumir la reunión');
    } finally {
      setSummarizing(false);
    }
  }

  async function borrar(id: string) {
    setBusy(true);
    try {
      await window.api.deleteRecording(id);
      if (selected === id) setSelected(null);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la grabación');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card meetings">
      <div className="panel-head">
        <div className="panel-title">
          <h2>Reuniones</h2>
          <span className="count-chip">{recordings.length}</span>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => window.api.openRecordingsFolder()}>
          <IconExternal size={13} />
          Abrir carpeta
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ margin: '14px 18px 0' }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="meeting-recorder">
        {recordingId ? (
          <>
            <span className="dot is-live" />
            <div className="meeting-live">
              <strong>Grabando… {formatDuration(now - (startedAt ?? now))}</strong>
              <span>
                {sources?.mic ? 'Micrófono' : 'Sin micrófono'}
                {' · '}
                {sources?.system ? 'Audio del sistema' : 'Sin audio del sistema'}
              </span>
            </div>
            <button className="btn-danger btn-sm" onClick={detener} disabled={busy}>
              <IconStop size={13} />
              Detener y guardar
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              placeholder="Título de la reunión (opcional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Título de la reunión"
            />
            <button onClick={comenzar} disabled={busy}>
              <span className="dot is-rec" />
              Grabar reunión
            </button>
          </>
        )}
      </div>

      <p className="browse-hint">
        El audio se guarda en este equipo, en la carpeta de datos de la app, y se va escribiendo
        mientras dura la reunión: si la app se cierra, lo grabado hasta ese momento se conserva.
      </p>

      {recordings.length === 0 ? (
        <div className="empty-state">
          <strong>Todavía no has grabado ninguna reunión</strong>
          <span>Pon un título, pulsa «Grabar reunión» y se guardará aquí al detenerla.</span>
        </div>
      ) : (
        <ul className="meeting-list">
          {recordings.map((rec) => (
            <li
              key={rec.id}
              className={`meeting-item ${selected === rec.id ? 'is-open' : ''} ${
                recordingId === rec.id ? 'is-recording' : ''
              }`}
            >
              <button
                className="meeting-row"
                onClick={() => setSelected(selected === rec.id ? null : rec.id)}
              >
                <span className="meeting-title">{rec.title}</span>
                <span className="meeting-meta">
                  {formatOdooDateShort(rec.startedAt.slice(0, 19).replace('T', ' '))}
                  {rec.endedAt ? ` · ${formatDuration(rec.durationMs)} · ${formatSize(rec.bytes)}` : ' · grabando'}
                  {rec.summary ? ' · resumida' : ''}
                </span>
              </button>

              {confirmDelete === rec.id ? (
                <div className="free-time-confirm">
                  <span>¿Borrar el audio y su resumen?</span>
                  <button className="btn-danger btn-sm" onClick={() => borrar(rec.id)} disabled={busy}>
                    Borrar
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  className="btn-ghost btn-icon"
                  onClick={() => setConfirmDelete(rec.id)}
                  disabled={recordingId === rec.id}
                  title="Borrar esta grabación"
                  aria-label={`Borrar ${rec.title}`}
                >
                  <IconTrash size={14} />
                </button>
              )}

              {selected === rec.id && (
                <div className="meeting-detail">
                  {audioUrl ? (
                    <audio controls src={audioUrl} preload="none" />
                  ) : (
                    <p className="notif-empty">Cargando el audio…</p>
                  )}

                  <label className="field">
                    <span className="field-label">Texto de la reunión</span>
                    <textarea
                      rows={5}
                      placeholder="Pega aquí la transcripción o escribe tus notas de la reunión..."
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      onBlur={guardarTexto}
                    />
                    <span className="field-hint">
                      Se guarda junto al audio. De aquí sale el resumen.
                    </span>
                  </label>

                  <div className="meeting-actions">
                    {aiOk && (
                      <button onClick={resumir} disabled={summarizing || !transcript.trim()}>
                        <IconSparkle size={13} />
                        {summarizing ? 'Resumiendo…' : rec.summary ? 'Rehacer resumen' : 'Resumir con IA'}
                      </button>
                    )}
                    {rec.summary && (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => navigator.clipboard.writeText(rec.summary).catch(() => {})}
                      >
                        <IconCheck size={13} />
                        Copiar resumen
                      </button>
                    )}
                    <button className="btn-ghost btn-sm" onClick={() => setSelected(null)}>
                      <IconClose size={13} />
                      Cerrar
                    </button>
                  </div>

                  {rec.summary && <p className="summary-text">{rec.summary}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
