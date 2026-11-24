import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, payLabel, tk } from './orderStatus.js';
import './receipt.css';

/** Loads one order with its private link (code + token). Used for the receipt after checkout. */
export async function fetchOrder(code, token) {
  const r = await fetch(`/api/site?action=order&code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  const o = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(o.error || 'Could not load the receipt.');
  return o;
}

const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};

function stampOf(o) {
  if (o.status === 'cancelled') return { label: 'Cancelled', cls: 'bad' };
  if (o.payment_status === 'refunded') return { label: 'Refunded', cls: 'warn' };
  if (o.payment_status === 'paid') return { label: 'Paid', cls: 'good' };
  if (o.payment_method === 'cod') return { label: 'Pay on delivery', cls: 'warn' };
  return { label: 'Payment pending', cls: 'warn' };
}

/** The receipt itself: a voucher with every detail of the order. */
export function Voucher({ order: o }) {
  const st = stampOf(o);
  return (
    <article className="rc">
      <div className="rc-bar"></div>
      <header className="rc-head">
        <div className="rc-brand"><img src="/assets/sw-en-v2.png" alt="Super Water" /><small>by <img className="rc-aq" src="/assets/aquanimity.png" alt="Aquanimity" /></small></div>
        <div className="rc-title"><b>RECEIPT</b><span>{o.code}</span><em className={`rc-stamp ${st.cls}`}>{st.label}</em></div>
      </header>

      <div className="rc-meta">
        <div><span>Date</span><b>{fmtDateTime(o.created_at)}</b></div>
        <div><span>Payment</span><b>{payLabel(o.payment_method)}</b></div>
        <div><span>Order status</span><b>{describe(o).state}</b></div>
      </div>

      <div className="rc-tear" aria-hidden="true"><i></i><hr /><i></i></div>

      <section className="rc-two">
        <div>
          <h4>Billed to</h4>
          <p><b>{o.customer_name}</b></p>
          {o.phone ? <p>{o.phone}</p> : null}
          {o.email ? <p>{o.email}</p> : null}
        </div>
        <div>
          <h4>Deliver to</h4>
          <p>{o.address}</p>
          <p>{o.city}</p>
        </div>
      </section>

      <table className="rc-items">
        <thead><tr><th>Item</th><th className="c">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {o.items.map((i, n) => (
            <tr key={n}><td>{i.name}</td><td className="c">{i.qty}</td><td className="r">{tk(i.price)}</td><td className="r">{tk(i.qty * i.price)}</td></tr>
          ))}
        </tbody>
      </table>

      <dl className="rc-sums">
        <div><dt>Subtotal</dt><dd>{tk(o.subtotal)}</dd></div>
        <div><dt>Delivery</dt><dd>{o.delivery_fee ? tk(o.delivery_fee) : 'Free'}</dd></div>
        <div className="grand"><dt>Total</dt><dd>{tk(o.total)}</dd></div>
      </dl>

      {o.note ? <p className="rc-note"><b>Note:</b> {o.note}</p> : null}

      <footer className="rc-foot">
        <b>Thank you for choosing Super Water.</b>
        <span>This is a computer-generated receipt and does not need a signature.</span>
        <span>{location.host}</span>
      </footer>
    </article>
  );
}

/** Builds the receipt off-screen and saves it as a PDF. The PDF libraries are only loaded when someone downloads. */
export async function downloadReceipt(order) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.className = 'rc-offscreen';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<Voucher order={order} />));
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const w = 440, h = Math.round((w * canvas.height) / canvas.width);
    const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h, undefined, 'FAST');
    pdf.save(`Receipt-${order.code}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}

const DownloadIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>;
export { DownloadIcon };

/** The receipt in a pop-up with a Download button and one more button (for example "Back to orders"). */
export function ReceiptModal({ order, onClose, secondary }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const download = async () => {
    setBusy(true); setErr('');
    try { await downloadReceipt(order); }
    catch (e) { console.error(e); setErr('Could not create the PDF. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rc-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rc-modal" role="dialog" aria-modal="true" aria-label={`Receipt ${order.code}`}>
        <button type="button" className="rc-x" aria-label="Close receipt" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className="rc-scroll"><Voucher order={order} /></div>
        <div className="rc-actions">
          <button type="button" className="rc-btn primary" onClick={download} disabled={busy}><DownloadIcon />{busy ? 'Preparing PDF…' : 'Download receipt'}</button>
          {secondary ? <button type="button" className="rc-btn" onClick={secondary.onClick}>{secondary.label}</button> : null}
        </div>
        {err ? <p className="rc-err" role="alert">{err}</p> : null}
      </div>
    </div>
  );
}
