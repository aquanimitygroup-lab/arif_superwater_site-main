// Shared helpers for the admin panel. All text from the server is rendered
// by React as text (never as HTML).

export const tk = (n) => `Tk ${Number(n || 0).toLocaleString('en-IN')}`;
export const size = (ml) => (Number(ml) === 2000 ? '2 L' : '500 mL');
export const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const $ = (s) => document.querySelector(s);

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(action, { method = 'GET', data, params = {} } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const r = await fetch(`/api/admin?${qs}`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-SW-Admin': '1' },
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'same-origin',
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && action !== 'login') { onUnauthorized(); throw Object.assign(new Error(body.error || 'Please sign in.'), { status: 401 }); }
  if (!r.ok) throw Object.assign(new Error(body.error || `Request failed (${r.status})`), { status: r.status });
  return body;
}

// ---------- toast ----------
let toastFn = () => {};
export const setToastHandler = (fn) => { toastFn = fn; };
export const toast = (msg, err = false) => toastFn(msg, err);
export const fail = (e) => toast(e.message || String(e), true);

// ---------- shared bits ----------
export const StatusPill = ({ s }) => <span className={`pill ${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
export const PAY_LABEL = { cod: 'Cash on delivery', sslcommerz: 'SSLCommerz', bkash: 'bKash' };

export function StockTiles({ stock }) {
  return (
    <div className="stock-row">
      {stock.map((s) => {
        const avail = s.on_hand - s.reserved;
        const cls = avail <= 0 ? 'out' : s.low ? 'low' : '';
        const total = Math.max(s.on_hand, 1);
        return (
          <div className={`stock ${cls}`} key={s.size_ml}>
            <h3>{`${size(s.size_ml)} bottles`}{avail <= 0 ? <span className="pill failed">Out of stock</span> : s.low ? <span className="pill pending">Running low</span> : <span className="pill ok">In stock</span>}</h3>
            <dl>
              <div><dt>At facility</dt><dd>{s.on_hand.toLocaleString('en-IN')}</dd></div>
              <div><dt>Reserved</dt><dd>{s.reserved.toLocaleString('en-IN')}</dd></div>
              <div><dt>Available</dt><dd className="avail">{avail.toLocaleString('en-IN')}</dd></div>
            </dl>
            <div className="meter" title="Reserved / available">
              <i className="m-res" style={{ width: `${Math.min(100, (s.reserved / total) * 100)}%` }}></i>
              <i className="m-av" style={{ width: `${Math.max(0, Math.min(100, (avail / total) * 100))}%` }}></i>
            </div>
            <p className="hint">{`Low-stock alert at ${s.low_threshold.toLocaleString('en-IN')} available`}</p>
          </div>
        );
      })}
    </div>
  );
}

export function OrdersTable({ rows, onOpen }) {
  // The column names stay visible even when there are no orders yet.
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Payment</th><th>Status</th><th className="r">Total</th></tr></thead>
      <tbody>{!rows.length ? <tr><td colSpan={6} className="empty">No orders here yet.</td></tr> : rows.map((o) => (
        <tr key={o.id} className="clickable" tabIndex={0} onClick={() => onOpen(o.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(o.id)}>
          <td><b>{o.code}</b></td>
          <td>{o.customer_name}<div className="muted">{o.city}</div></td>
          <td className="muted">{when(o.created_at)}</td>
          <td><div>{PAY_LABEL[o.payment_method] || o.payment_method}</div><StatusPill s={o.payment_status} /></td>
          <td><StatusPill s={o.status} /></td>
          <td className="r num">{tk(o.total)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** A card with a small form. onSubmit(form) may throw; its message is shown under the fields. The form is cleared after success. */
export function FormCard({ title, hint, submitLabel, onSubmit, children }) {
  const submit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    err.textContent = ''; btn.disabled = true;
    try { await onSubmit(form); if (form.isConnected) form.reset(); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  };
  return (
    <div className="card"><h2>{title}</h2><p className="hint">{hint}</p>
      <form noValidate onSubmit={submit}>
        <div className="form-grid">{children}</div>
        <p className="form-error"></p>
        <button className="btn primary" type="submit">{submitLabel}</button>
      </form>
    </div>
  );
}

export const Field = ({ label, id, children }) => <div><label htmlFor={id}>{label}</label>{children}</div>;

export const SizeSelect = ({ id }) => <select id={id}><option value="500">500 mL</option><option value="2000">2 L</option></select>;
