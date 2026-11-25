// Endpoint serverless (Vercel): recibe { text } con el contenido de un PDF
// y devuelve el modelo de pasos validado para dibujar el diagrama.
// Requiere la variable de entorno ANTHROPIC_API_KEY en el proyecto de Vercel.

import { extractJson, validateModel } from "../lib/steps.js";

const MAX_CHARS = 150000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const SYSTEM = `Eres un analista de procesos. Recibirás el texto de un procedimiento empresarial.
Devuelve SOLO un objeto JSON válido, sin texto adicional, con esta forma:
{
  "title": "nombre corto del proceso",
  "actors": [{ "id": "identificador_sin_espacios", "name": "área o sistema" }],
  "steps": [
    { "id": "s1", "type": "start|task|decision|end", "label": "texto corto (máx. 6 palabras)",
      "actor": "id de un actor", "next": ["id"] or [{ "to": "id", "label": "Sí|No|..." }] }
  ]
}
Reglas:
- Usa "decision" para bifurcaciones (sí/no, aprobado/rechazado) y etiqueta cada salida en "next".
- Incluye exactamente un paso "start" y al menos un "end".
- Cada "id" de "next" debe existir en "steps".
- Si un sistema como SAP o Excel participa, trátalo como actor.
- Si el texto no describe un proceso, devuelve steps vacío.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST." });

  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Falta 'text'." });
  if (text.length > MAX_CHARS) return res.status(413).json({ error: `El texto supera ${MAX_CHARS} caracteres.` });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en el servidor." });

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch {
    return res.status(502).json({ error: "No se pudo conectar con el servicio de IA." });
  }
  if (!upstream.ok) return res.status(502).json({ error: `El servicio de IA respondió ${upstream.status}.` });

  const data = await upstream.json();
  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return res.status(502).json({ error: "La respuesta de la IA no es JSON válido: " + err.message });
  }

  const result = validateModel(parsed);
  if (!result.ok) return res.status(422).json({ error: "Los pasos no son válidos.", details: result.errors });
  return res.status(200).json(result.model);
}
