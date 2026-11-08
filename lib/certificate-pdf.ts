import 'server-only';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

export type CertData = {
  orgName: string; legalName?: string | null; title: string; subtitle?: string | null; recipient: string;
  body?: string | null; program?: string | null; course?: string | null; grade?: string | number | null; extra?: string | null;
  dateLine: string; signers: { name: string; title?: string | null }[]; footer?: string | null;
  url: string; code: string; hash: string; revoked: boolean; logo?: Uint8Array | null; logoMime?: string | null;
};

const BRAND = rgb(0.12, 0.27, 0.78), INK = rgb(0.06, 0.09, 0.16), MUTED = rgb(0.39, 0.45, 0.55);

// Las fuentes estándar del PDF solo aceptan caracteres latinos (WinAnsi): se reemplaza el resto
const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...')
  .replace(/\r/g, '').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const w of para.split(/[ \t]+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = INK, max = 440) {
  let yy = y;
  for (const l of wrap(text, font, size, max)) {
    page.drawText(l, { x: (page.getWidth() - font.widthOfTextAtSize(l, size)) / 2, y: yy, size, font, color });
    yy -= size * 1.35;
  }
  return yy;
}

/** Genera el certificado en PDF (A4), con el mismo contenido verificable que la página. */
export async function certificatePdf(d: CertData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(`${d.title} - ${d.recipient}`)); pdf.setAuthor(clean(d.orgName)); pdf.setSubject(`Código de verificación ${d.code}`);
  const page = pdf.addPage([595.28, 841.89]);
  const W = page.getWidth(), H = page.getHeight();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique), mono = await pdf.embedFont(StandardFonts.Courier);

  page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: BRAND, borderWidth: 3 });
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: BRAND, borderWidth: 1 });

  let y = H - 85;
  if (d.logo && d.logoMime && /png|jpe?g/.test(d.logoMime)) {
    try {
      const img = d.logoMime.includes('png') ? await pdf.embedPng(d.logo) : await pdf.embedJpg(d.logo);
      const s = img.scaleToFit(130, 60);
      page.drawImage(img, { x: (W - s.width) / 2, y: y - s.height + 10, width: s.width, height: s.height });
      y -= s.height + 8;
    } catch { /* logo en formato no compatible: se omite */ }
  }
  const org = clean(d.orgName.toUpperCase()).split(' ').map((w) => w.split('').join('\u00A0')).join('\u00A0\u00A0\u00A0');
  y = centered(page, org, y, bold, 11, BRAND, 480);
  if (d.legalName) y = centered(page, d.legalName, y - 2, reg, 10, MUTED);
  y = centered(page, d.title, y - 34, bold, 24, INK, 450);
  if (d.subtitle) y = centered(page, d.subtitle, y - 2, ital, 11, MUTED);
  y = centered(page, 'Se certifica que', y - 26, reg, 12, MUTED);
  y = centered(page, d.recipient, y - 6, bold, 20, INK);
  if (d.body) y = centered(page, d.body, y - 16, reg, 11.5, INK, 430);
  if (d.program && !(d.body ?? '').includes(d.program)) y = centered(page, `Programa: ${d.program}`, y - 8, bold, 12);
  if (d.course && !(d.body ?? '').includes(d.course)) y = centered(page, `Asignatura: ${d.course}${d.grade ? ` - Nota final ${d.grade}` : ''}`, y - 4, bold, 12);
  if (d.extra) y = centered(page, d.extra, y - 10, bold, 11.5, INK, 430);
  y = centered(page, d.dateLine, y - 18, reg, 10.5, MUTED);

  // Firmas
  const sig = d.signers.slice(0, 2);
  if (sig.length) {
    const sy = Math.min(y - 60, 250);
    sig.forEach((g, i) => {
      const cx = sig.length === 1 ? W / 2 : i === 0 ? W / 2 - 120 : W / 2 + 120;
      page.drawLine({ start: { x: cx - 85, y: sy }, end: { x: cx + 85, y: sy }, thickness: 0.8, color: INK });
      const n = clean(g.name), t = clean(g.title ?? '');
      page.drawText(n, { x: cx - bold.widthOfTextAtSize(n, 10) / 2, y: sy - 14, size: 10, font: bold, color: INK });
      if (t) page.drawText(t, { x: cx - reg.widthOfTextAtSize(t, 9) / 2, y: sy - 27, size: 9, font: reg, color: MUTED });
    });
  }

  // Verificación con QR
  const qr = await pdf.embedPng(Buffer.from((await QRCode.toDataURL(d.url, { margin: 1, width: 300 })).split(',')[1], 'base64'));
  page.drawImage(qr, { x: W - 60 - 100, y: 70, width: 100, height: 100 });
  let vy = 150;
  for (const [txt, f, s] of [['Verifique la autenticidad en:', reg, 8.5], [d.url, mono, 7.5], [`Codigo: ${d.code}`, bold, 9], [`Huella SHA-256: ${d.hash.slice(0, 40)}...`, reg, 7]] as [string, PDFFont, number][]) {
    for (const l of wrap(txt, f, s, 300)) { page.drawText(l, { x: 60, y: vy, size: s, font: f, color: MUTED }); vy -= s * 1.5; }
  }
  if (d.footer) for (const [i, l] of wrap(d.footer, reg, 7.5, W - 120).entries()) page.drawText(l, { x: 60, y: 48 - i * 10, size: 7.5, font: reg, color: MUTED });
  if (d.revoked) {
    page.drawText('REVOCADO', { x: 120, y: 330, size: 90, font: bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.25, rotate: degrees(35) });
  }
  return pdf.save();
}
