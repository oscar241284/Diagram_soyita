# PDF → Diagrama de flujo animado

Carga un PDF de procedimiento, revisa los pasos y genera un diagrama de flujo animado con carriles por área y logos.

## Uso local
Abre `index.html` en el navegador (no requiere instalación).

1. Carga un PDF con texto seleccionable.
2. Revisa o edita la estructura de pasos (JSON) o pulsa "Cargar ejemplo".
3. Sube logos opcionales; el nombre del archivo debe coincidir con el actor (`SAP.png`).
4. Pulsa "Dibujar diagrama". Puedes pausar la animación y descargar el SVG.

## Formato de pasos
```json
{
  "title": "Nombre del proceso",
  "actors": [{ "id": "ventas", "name": "Ventas" }],
  "steps": [
    { "id": "s1", "type": "start", "label": "Inicio", "actor": "ventas", "next": ["s2"] },
    { "id": "s2", "type": "decision", "label": "¿Aprobado?", "actor": "ventas",
      "next": [{ "to": "s3", "label": "Sí" }, { "to": "s4", "label": "No" }] }
  ]
}
```
Tipos: `start`, `task`, `decision`, `end`.

## Análisis con IA
`api/analyze.js` es una función serverless (Vercel) que recibe `{ "text": "..." }`, llama al modelo y devuelve el JSON validado con `lib/steps.js`.

Configuración en Vercel:
- Variable `ANTHROPIC_API_KEY` (obligatoria). Nunca la subas al repositorio.
- Variable `ANTHROPIC_MODEL` (opcional, por defecto `claude-sonnet-5-5`).

Pruebas de la lógica de pasos: `npm test`.

## Limitaciones
- Solo PDFs con texto. Los escaneados requieren OCR (pendiente).
- No subir PDFs reales de la empresa al repositorio público.

## Despliegue
GitHub Pages desde la rama principal (carpeta raíz). Requiere repositorio público en cuentas gratuitas.
