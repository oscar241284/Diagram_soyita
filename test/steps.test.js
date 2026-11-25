import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, validateModel } from "../lib/steps.js";

test("extrae JSON aunque venga con texto y cercas de código", () => {
  const raw = 'Aquí tienes:\n```json\n{"title":"X","steps":[]}\n```\nListo.';
  assert.deepEqual(extractJson(raw), { title: "X", steps: [] });
});

test("lanza error si no hay JSON", () => {
  assert.throws(() => extractJson("sin datos"), /No se encontró/);
});

test("valida un proceso correcto y normaliza 'next'", () => {
  const r = validateModel({
    title: "Pedido",
    steps: [
      { id: "s1", type: "start", label: "Inicio", actor: "ventas", next: ["s2"] },
      { id: "s2", type: "decision", label: "¿Stock?", actor: "almacen", next: [{ to: "s3", label: "Sí" }] },
      { id: "s3", type: "end", label: "Fin", actor: "almacen" },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.model.steps[0].next, [{ to: "s2", label: "" }]);
  assert.deepEqual(r.model.steps[1].next, [{ to: "s3", label: "Sí" }]);
  assert.deepEqual(r.model.actors.map((a) => a.id), ["ventas", "almacen"]);
});

test("detecta destinos inexistentes y ids repetidos", () => {
  const r = validateModel({
    steps: [
      { id: "s1", type: "start", next: ["nope"] },
      { id: "s1", type: "end" },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("inexistente")));
  assert.ok(r.errors.some((e) => e.includes("repetido")));
});

test("rechaza tipos desconocidos", () => {
  const r = validateModel({ steps: [{ id: "a", type: "magia" }] });
  assert.equal(r.ok, false);
});
