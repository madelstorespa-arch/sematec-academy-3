import type { Workbook } from './sheet';

/** Plantillas de documentos (HTML) para SEMATEC Oficina. */
export const DOC_TEMPLATES: Record<string, string> = {
  blanco: '<p></p>',
  carta: `<p style="text-align: right">Santiago, ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</p><p></p><p><strong>Señor(a)</strong><br>Nombre del destinatario<br>Cargo · Institución</p><p><u>Presente</u></p><p></p><p>De mi consideración:</p><p>Escriba aquí el motivo de la carta. Exponga el tema en párrafos breves y claros.</p><p>Sin otro particular, saluda atentamente,</p><p></p><p></p><p style="text-align: center">______________________________<br><strong>Nombre y apellido</strong><br>Cargo</p>`,
  informe: `<h1>Título del informe</h1><p><em>Autor · Curso · Fecha</em></p><h2>1. Introducción</h2><p>Presente el tema y el objetivo del informe.</p><h2>2. Desarrollo</h2><p>Explique el contenido principal con sus fuentes.</p><ul><li>Punto importante</li><li>Otro punto</li></ul><h2>3. Conclusiones</h2><p>Resuma lo aprendido.</p><h2>4. Bibliografía</h2><ol><li>Autor (año). Título. Editorial.</li></ol>`,
  cv: `<h1>Nombre Apellido</h1><p>📧 correo@ejemplo.cl · 📱 +56 9 0000 0000 · Ciudad</p><h2>Perfil</h2><p>Breve descripción de sus habilidades y objetivos profesionales.</p><h2>Experiencia</h2><p><strong>Cargo</strong> — Empresa (2024 – actualidad)</p><ul><li>Logro o responsabilidad principal</li></ul><h2>Educación</h2><p><strong>Carrera o curso</strong> — Institución (año)</p><h2>Habilidades</h2><ul><li>Office (Word, Excel, PowerPoint)</li><li>Trabajo en equipo</li></ul>`,
  guia: `<h1>Guía de estudio</h1><p><strong>Asignatura:</strong> ______ &nbsp; <strong>Unidad:</strong> ______ &nbsp; <strong>Fecha:</strong> ______</p><p><strong>Nombre:</strong> __________________________________</p><h2>Objetivo</h2><p>Al terminar esta guía, el estudiante podrá…</p><h2>Actividades</h2><ol><li>Lea el texto y responda las preguntas.</li><li>Complete la tabla.</li></ol><table><tbody><tr><th>Concepto</th><th>Definición</th></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table>`,
};

const cells = (rows: (string | number)[][], bold = 1) => {
  const out: Workbook['sheets'][number]['cells'] = {};
  rows.forEach((r, ri) => r.forEach((v, ci) => {
    if (v === '') return;
    const key = `${String.fromCharCode(65 + ci)}${ri + 1}`;
    out[key] = ri < bold ? { v: String(v), s: { b: true, bg: '#dbeafe' } } : { v: String(v) };
  }));
  return out;
};

export function sheetTemplate(t: string): Workbook {
  const sheet = (name: string, c: Workbook['sheets'][number]['cells'], widths?: Record<number, number>) => ({ name, cells: c, rows: 60, cols: 16, widths });
  if (t === 'presupuesto') {
    const c = cells([['Concepto', 'Categoría', 'Monto'], ['Arriendo', 'Fijo', 350000], ['Luz y agua', 'Servicios', 45000], ['Internet', 'Servicios', 25000], ['Materiales', 'Variable', 60000], ['', '', ''], ['Total', '', '=SUMA(C2:C5)']]);
    for (let r = 2; r <= 7; r++) c[`C${r}`] = { ...(c[`C${r}`] ?? { v: '' }), s: { ...(c[`C${r}`]?.s ?? {}), fmt: 'currency' } };
    c.A7.s = { b: true }; c.C7.s = { b: true, fmt: 'currency' };
    return { sheets: [sheet('Presupuesto', c, { 0: 180, 1: 120, 2: 120 })] };
  }
  if (t === 'notas') {
    const c = cells([['Estudiante', 'Prueba 1 (30%)', 'Prueba 2 (30%)', 'Trabajo (40%)', 'Promedio', 'Situación'],
      ['Ana Pérez', 6.5, 5.8, 6.2], ['Luis Soto', 4.2, 3.8, 5], ['María Díaz', 5.5, 6, 6.8], ['Pedro Rojas', 3.5, 4.1, 3.9]]);
    for (let r = 2; r <= 5; r++) { c[`E${r}`] = { v: `=REDONDEAR(B${r}*0,3+C${r}*0,3+D${r}*0,4;1)`.replace(/0,(\d)/g, '0.$1'), s: { b: true } }; c[`F${r}`] = { v: `=SI(E${r}>=4;"Aprobado";"Reprobado")` }; }
    c.A7 = { v: 'Promedio del curso', s: { b: true } }; c.E7 = { v: '=REDONDEAR(PROMEDIO(E2:E5);1)', s: { b: true } };
    return { sheets: [sheet('Notas', c, { 0: 160, 1: 110, 2: 110, 3: 110, 4: 90, 5: 100 })] };
  }
  if (t === 'asistencia') {
    const c = cells([['Estudiante', 'Clase 1', 'Clase 2', 'Clase 3', 'Clase 4', 'Asistencia %'], ['Ana Pérez', 1, 1, 0, 1], ['Luis Soto', 1, 0, 0, 1], ['María Díaz', 1, 1, 1, 1]]);
    for (let r = 2; r <= 4; r++) c[`F${r}`] = { v: `=PROMEDIO(B${r}:E${r})`, s: { fmt: 'percent' } };
    c.A6 = { v: '1 = presente · 0 = ausente', s: { i: true, color: '#64748b' } };
    return { sheets: [sheet('Asistencia', c, { 0: 160, 5: 110 })] };
  }
  if (t === 'inventario') {
    const c = cells([['Código', 'Producto', 'Stock', 'Precio', 'Valor total'], ['P-001', 'Cuaderno', 40, 1990], ['P-002', 'Lápiz', 150, 350], ['P-003', 'Archivador', 25, 3490]]);
    for (let r = 2; r <= 4; r++) { c[`E${r}`] = { v: `=C${r}*D${r}`, s: { fmt: 'currency' } }; c[`D${r}`] = { ...c[`D${r}`], s: { fmt: 'currency' } }; }
    c.D6 = { v: 'Total', s: { b: true } }; c.E6 = { v: '=SUMA(E2:E4)', s: { b: true, fmt: 'currency' } };
    return { sheets: [sheet('Inventario', c, { 1: 160, 4: 120 })] };
  }
  return { sheets: [sheet('Hoja1', {})] };
}
