// =====================================================================
// SOLO PARA PRUEBAS. Servidor que reproduce los contratos de API de
// Webpay Plus, Mercado Pago, Flow y Stripe (endpoints, firmas, retornos y
// notificaciones) para ejercitar el flujo completo sin cobros reales.
// La validación final se hace con los ambientes sandbox de cada proveedor.
// =====================================================================
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 4010, BASE = `http://localhost:${PORT}`;
const FLOW_SECRET = process.env.FLOW_SECRET_KEY ?? 'flow-secret-test', STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_mock';
const db = { webpay: new Map(), mp: new Map(), mpPay: new Map(), flow: new Map(), stripe: new Map(), fintoc: new Map() };
const FINTOC_BANKS = new Set(['cl_banco_estado','cl_banco_bci','cl_banco_bice','cl_banco_de_chile','cl_banco_falabella','cl_banco_itau','cl_banco_ripley','cl_banco_santander','cl_banco_consorcio','cl_banco_scotiabank','cl_mercado_pago','cl_mach','cl_tenpo','cl_banco_security','cl_tapp_caja_los_andes','cl_banco_internacional','cl_banco_coopeuch','cl_copec_pay','cl_prepago_los_heroes','cl_banco_bbva','cl_banco_hsbc']);
const id = (p) => p + crypto.randomBytes(8).toString('hex');
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const html = (res, s) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;max-width:480px;margin:40px auto">${s}</body>`); };
const autopost = (url, fields) => `<form id="f" method="post" action="${url}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')}</form><script>document.getElementById('f').submit()</script>`;
const page = (title, amount, cur, action, extra = '') => `<h2 id="provider">${title}</h2><p>Monto: <b id="amount">${amount} ${cur}</b></p>
<p>Tarjeta de prueba 4051 8856 0044 6623</p><form method="post" action="${action}"><button name="r" value="ok" id="approve">Aprobar pago</button> <button name="r" value="reject" id="reject">Rechazar</button> ${extra}</form>`;
const flowSign = (p) => crypto.createHmac('sha256', FLOW_SECRET).update(Object.keys(p).sort().map((k) => k + p[k]).join('')).digest('hex');
async function notify(url, payload, headers = {}) { try { await fetch(url, { method: 'POST', body: payload, headers }); } catch (e) { console.error('notify', e.message); } }

http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE); const raw = await body(req); const form = new URLSearchParams(raw);
  // ---------------- Fintoc (Paga con tu banco) ----------------
  if (u.pathname === '/fintoc/v2/checkout_sessions' && req.method === 'POST') {
    if (!String(req.headers.authorization ?? '').startsWith('sk_')) return json(res, 401, { error: { message: 'Invalid API key' } });
    const b = JSON.parse(raw);
    const bank = b.payment_method_options?.bank_transfer?.sender_account?.institution_id?.value ?? null;
    if (bank && !FINTOC_BANKS.has(bank)) return json(res, 400, { error: { message: 'invalid institution_id' } });
    if (b.currency !== 'CLP' || !Number.isInteger(b.amount)) return json(res, 400, { error: { message: 'invalid amount/currency' } });
    const s = { id: id('cs_'), object: 'checkout_session', mode: 'test', status: 'created', amount: b.amount, currency: 'CLP', metadata: b.metadata ?? {},
      success_url: b.success_url, cancel_url: b.cancel_url, payment_resource: null, bank, redirect_url: '' };
    s.redirect_url = `${BASE}/fintoc/pay/${s.id}`; db.fintoc.set(s.id, s);
    return json(res, 201, s);
  }
  if (u.pathname.startsWith('/fintoc/v2/checkout_sessions/') && req.method === 'GET') {
    if (!String(req.headers.authorization ?? '').startsWith('sk_')) return json(res, 401, { error: { message: 'Invalid API key' } });
    const s = db.fintoc.get(u.pathname.split('/').pop()); if (!s) return json(res, 404, { error: { message: 'not found' } });
    const { bank, ...pub } = s; return json(res, 200, pub);
  }
  if (u.pathname.startsWith('/fintoc/pay/')) {
    const s = db.fintoc.get(u.pathname.split('/').pop()); if (!s) return json(res, 404, {});
    if (req.method === 'POST') {
      const ok = form.get('r') === 'ok';
      s.status = 'finished';
      s.payment_resource = { payment_intent: { id: id('pi_'), object: 'payment_intent', amount: s.amount, currency: 'CLP', status: ok ? 'succeeded' : 'rejected', payment_type: 'bank_transfer' } };
      await notify('http://localhost:3000/api/pago/webhook/fintoc', JSON.stringify({ id: id('evt_'), type: 'checkout_session.finished', data: { id: s.id, object: 'checkout_session' } }), { 'Content-Type': 'application/json' });
      res.writeHead(303, { Location: ok ? s.success_url : s.cancel_url }); return res.end();
    }
    return html(res, page(`Fintoc · <span id="bank">${s.bank ?? 'elige tu banco'}</span> (prueba)`, s.amount, 'CLP', `/fintoc/pay/${s.id}`));
  }
  // ---------------- Webpay Plus ----------------
  if (u.pathname === '/rswebpaytransaction/api/webpay/v1.2/transactions' && req.method === 'POST') {
    if (!req.headers['tbk-api-key-id'] || !req.headers['tbk-api-key-secret']) return json(res, 401, { error_message: 'Not Authorized' });
    const b = JSON.parse(raw); const token = id('01ab');
    db.webpay.set(token, { ...b, status: 'INITIALIZED', committed: false });
    return json(res, 200, { token, url: `${BASE}/webpay/form` });
  }
  if (u.pathname.startsWith('/rswebpaytransaction/api/webpay/v1.2/transactions/') && req.method === 'PUT') {
    const t = db.webpay.get(u.pathname.split('/').pop());
    if (!t) return json(res, 422, { error_message: 'Invalid token' });
    if (t.committed) return json(res, 422, { error_message: 'Transaction already committed' });
    t.committed = true;
    return json(res, 200, { vci: 'TSY', amount: t.paidAmount ?? t.amount, status: t.status, buy_order: t.buy_order, session_id: t.session_id,
      card_detail: { card_number: '6623' }, accounting_date: '1106', transaction_date: new Date().toISOString(), authorization_code: '1213',
      payment_type_code: 'VN', response_code: t.status === 'AUTHORIZED' ? 0 : -1, installments_number: 0 });
  }
  if (u.pathname === '/webpay/form') {
    const token = form.get('token_ws') ?? u.searchParams.get('token_ws'); const t = db.webpay.get(token);
    if (form.get('r')) {
      if (form.get('r') === 'cancel') return html(res, autopost(t.return_url, { TBK_TOKEN: token, TBK_ORDEN_COMPRA: t.buy_order, TBK_ID_SESION: t.session_id }));
      t.status = form.get('r') === 'reject' ? 'FAILED' : 'AUTHORIZED';
      if (form.get('r') === 'tamper') t.paidAmount = t.amount - 1000;
      return html(res, autopost(t.return_url, { token_ws: token }));
    }
    return html(res, page('Webpay Plus (prueba)', t.amount, 'CLP', `/webpay/form?token_ws=${token}`,
      `<input type="hidden" name="token_ws" value="${token}"><button name="r" value="cancel" id="cancel">Anular compra</button> <button name="r" value="tamper" id="tamper">Monto alterado</button>`));
  }
  // ---------------- Mercado Pago ----------------
  if (u.pathname === '/mp/checkout/preferences' && req.method === 'POST') {
    if (!/^Bearer .+/.test(req.headers.authorization ?? '')) return json(res, 401, { message: 'invalid token' });
    const b = JSON.parse(raw); const pref = id('pref-'); db.mp.set(pref, b);
    return json(res, 201, { id: pref, init_point: `${BASE}/mp/checkout?pref_id=${pref}` });
  }
  if (u.pathname === '/mp/checkout') {
    const pref = u.searchParams.get('pref_id'); const p = db.mp.get(pref); const it = p.items[0];
    if (form.get('r')) {
      const pid = String(Date.now()); const approved = form.get('r') === 'ok';
      db.mpPay.set(pid, { id: Number(pid), status: approved ? 'approved' : 'rejected', transaction_amount: it.unit_price, currency_id: it.currency_id, external_reference: p.external_reference });
      setTimeout(() => notify(p.notification_url, JSON.stringify({ type: 'payment', action: 'payment.created', data: { id: pid } }), { 'Content-Type': 'application/json' }), 200);
      res.writeHead(302, { Location: `${p.back_urls.success}?payment_id=${pid}&status=${approved ? 'approved' : 'rejected'}&external_reference=${p.external_reference}&preference_id=${pref}` });
      return res.end();
    }
    return html(res, page('Mercado Pago (prueba)', it.unit_price, it.currency_id, `/mp/checkout?pref_id=${pref}`));
  }
  if (u.pathname.startsWith('/mp/v1/payments/')) {
    const p = db.mpPay.get(u.pathname.split('/').pop()); return p ? json(res, 200, p) : json(res, 404, { message: 'not found' });
  }
  // ---------------- Flow ----------------
  if (u.pathname === '/flow/payment/create' && req.method === 'POST') {
    const p = Object.fromEntries(form); const s = p.s; delete p.s;
    if (flowSign(p) !== s) return json(res, 401, { code: 108, message: 'Invalid signature' });
    const token = id('flw'); db.flow.set(token, { ...p, status: 1, flowOrder: Math.floor(Math.random() * 1e6) });
    return json(res, 200, { url: `${BASE}/flow/pay`, token, flowOrder: db.flow.get(token).flowOrder });
  }
  if (u.pathname === '/flow/pay') {
    const token = u.searchParams.get('token'); const t = db.flow.get(token);
    if (form.get('r')) {
      t.status = form.get('r') === 'ok' ? 2 : 3;
      await notify(t.urlConfirmation, new URLSearchParams({ token }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
      return html(res, autopost(t.urlReturn, { token }));
    }
    return html(res, page('Flow (prueba)', t.amount, t.currency, `/flow/pay?token=${token}`));
  }
  if (u.pathname === '/flow/payment/getStatus') {
    const p = Object.fromEntries(u.searchParams); const s = p.s; delete p.s;
    if (flowSign(p) !== s) return json(res, 401, { code: 108, message: 'Invalid signature' });
    const t = db.flow.get(p.token); if (!t) return json(res, 400, { message: 'token' });
    return json(res, 200, { flowOrder: t.flowOrder, commerceOrder: t.commerceOrder, status: t.status, amount: Number(t.amount), currency: t.currency, payer: t.email, optional: t.optional });
  }
  // ---------------- Stripe ----------------
  if (u.pathname === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
    if (!/^Bearer sk_/.test(req.headers.authorization ?? '')) return json(res, 401, { error: { message: 'Invalid API Key' } });
    const p = Object.fromEntries(form); const sid = id('cs_test_');
    db.stripe.set(sid, { id: sid, object: 'checkout.session', payment_status: 'unpaid', status: 'open', currency: p['line_items[0][price_data][currency]'],
      amount_total: Number(p['line_items[0][price_data][unit_amount]']), client_reference_id: p.client_reference_id, metadata: { order_id: p['metadata[order_id]'] },
      success_url: p.success_url, cancel_url: p.cancel_url, webhook: req.headers['x-mock-webhook'] });
    return json(res, 200, { id: sid, url: `${BASE}/stripe/pay/${sid}` });
  }
  if (u.pathname.startsWith('/stripe/pay/')) {
    const s = db.stripe.get(u.pathname.split('/').pop());
    if (form.get('r')) {
      if (form.get('r') !== 'ok') { res.writeHead(302, { Location: s.cancel_url }); return res.end(); }
      s.payment_status = 'paid'; s.status = 'complete';
      const evt = JSON.stringify({ id: id('evt_'), type: 'checkout.session.completed', data: { object: { id: s.id, client_reference_id: s.client_reference_id } } });
      const t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac('sha256', STRIPE_WHSEC).update(`${t}.${evt}`).digest('hex');
      await notify('http://localhost:3000/api/pago/webhook/stripe', evt, { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` });
      res.writeHead(302, { Location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) }); return res.end();
    }
    return html(res, page('Stripe Checkout (prueba)', s.amount_total, s.currency.toUpperCase(), `/stripe/pay/${s.id}`));
  }
  if (u.pathname.startsWith('/stripe/v1/checkout/sessions/')) {
    const s = db.stripe.get(u.pathname.split('/').pop()); return s ? json(res, 200, s) : json(res, 404, { error: { message: 'No such session' } });
  }
  json(res, 404, { error: 'mock: ruta desconocida ' + u.pathname });
}).listen(PORT, () => console.log('payment mock on', PORT));
