// Utilidades puras: extraer y validar el JSON de pasos que devuelve el modelo.
// No dependen de red ni de variables de entorno, así se pueden probar fácilmente.

export const STEP_TYPES = ["start", "task", "decision", "end"];

// Extrae el primer objeto JSON de un texto (el modelo a veces añade explicaciones o cercas de código).
export function extractJson(raw) {
  if (typeof raw !== "string") throw new Error("La respuesta no es texto.");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No se encontró un objeto JSON en la respuesta.");
  return JSON.parse(candidate.slice(start, end + 1));
}

// Valida y normaliza el modelo. Devuelve { ok: true, model } o { ok: false, errors }.
export function validateModel(input) {
  const errors = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["El modelo debe ser un objeto."] };

  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length === 0) errors.push("Debe haber al menos un paso en 'steps'.");

  const ids = new Set();
  for (const s of steps) {
    if (!s || typeof s.id !== "string" || !s.id) errors.push("Cada paso necesita un 'id' de texto.");
    else if (ids.has(s.id)) errors.push(`El id '${s.id}' está repetido.`);
    else ids.add(s.id);
    if (s && !STEP_TYPES.includes(s.type)) errors.push(`Tipo no válido en '${s?.id}': '${s?.type}'.`);
  }

  // Normaliza 'next' a [{ to, label }] y comprueba que los destinos existan
  const normalized = steps.map((s) => {
    const list = Array.isArray(s.next) ? s.next : s.next ? [s.next] : [];
    const next = list.map((n) => {
      const to = typeof n === "string" ? n : n?.to;
      const label = typeof n === "string" ? "" : String(n?.label ?? "");
      if (!ids.has(to)) errors.push(`El paso '${s.id}' apunta a un destino inexistente: '${to}'.`);
      return { to, label };
    });
    return {
      id: s.id,
      type: STEP_TYPES.includes(s.type) ? s.type : "task",
      label: String(s.label ?? s.id).slice(0, 120),
      actor: s.actor ? String(s.actor) : "General",
      next,
    };
  });

  // Actores: si no vienen, se crean a partir de los pasos
  const actorIds = [...new Set(normalized.map((s) => s.actor))];
  const actors = (Array.isArray(input.actors) ? input.actors : [])
    .filter((a) => a && a.id)
    .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) }));
  for (const id of actorIds) if (!actors.some((a) => a.id === id)) actors.push({ id, name: id });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    model: {
      title: String(input.title ?? "Proceso").slice(0, 150),
      actors,
      steps: normalized,
    },
  };
}
