import { useEffect, useState } from 'react';
import { describe } from '../site/orderStatus.js';
import { DownloadIcon, ReceiptModal, downloadReceipt } from '../site/Receipt.jsx';

const tk = (n) => 'Tk ' + Number(n).toLocaleString('en-IN');

export default function OrderApp() {
  const [data, setData] = useState(null); // { order } | { error }
  // The link in the order emails opens this page with the receipt already showing (?receipt=1).
  const [showReceipt, setShowReceipt] = useState(() => new URLSearchParams(location.search).get('receipt') === '1');
  const [dlBusy, setDlBusy] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    (async () => {
      try {
        const r = await fetch(`/api/site?action=order&code=${encodeURIComponent(p.get('code') || '')}&token=${encodeURIComponent(p.get('token') || '')}`);
        const o = await r.json();
        if (!r.ok) throw new Error(o.error || 'We could not find this order.');
        setData({ order: o });
      } catch (e) {
        setData({ error: e.message });
      }
    })();
  }, []);

  let card;
  if (!data) {
    card = <p className="msg" id="loading">Loading your order…</p>;
  } else if (data.error) {
    card = (<>
      <h1>Order not found</h1>
      <p className="msg">{data.error}</p>
      <a className="btn" href="/">Back to Super Water</a>
    </>);
  } else {
    const o = data.order;
    const { title, msg, state, cls } = describe(o);
    const step = { pending: 1, confirmed: 2, dispatched: 3, delivered: 4 }[o.status] || 0;
    card = (<>
      <span className={`state ${cls}`}>{state}</span>
      <h1>{title}</h1>
      <p className="code">{`Order ${o.code}`}</p>
      <p className="msg">{msg}</p>
      {o.status !== 'cancelled' && (<>
        <div className="steps">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        <div className="steps-label">{['Received', 'Confirmed', 'Dispatched', 'Delivered'].map((t) => <span key={t}>{t}</span>)}</div>
      </>)}
      <table>
        <tbody>
          {o.items.map((i, n) => (
            <tr key={n}><td>{`${i.qty} × ${i.name}`}</td><td className="r">{tk(i.qty * i.price)}</td></tr>
          ))}
          <tr><td>Delivery</td><td className="r">{o.delivery_fee ? tk(o.delivery_fee) : 'Free'}</td></tr>
          <tr className="total"><td>Total</td><td className="r">{tk(o.total)}</td></tr>
        </tbody>
      </table>
      <div className="o-actions">
        <button type="button" className="rc-btn primary" onClick={() => setShowReceipt(true)}>Receipt</button>
        <button type="button" className="rc-btn" disabled={dlBusy} onClick={async () => { setDlBusy(true); try { await downloadReceipt(o); } catch (e) { alert('Could not create the PDF. Please try again.'); } finally { setDlBusy(false); } }}><DownloadIcon />{dlBusy ? 'Preparing PDF…' : 'Download receipt'}</button>
      </div>
      <a className="btn" href={o.status === 'cancelled' ? '/#shop' : '/'}>{o.status === 'cancelled' ? 'Back to the shop' : 'Back to Super Water'}</a>
      {showReceipt ? <ReceiptModal order={o} onClose={() => setShowReceipt(false)} secondary={{ label: 'Close', onClick: () => setShowReceipt(false) }} /> : null}
    </>);
  }

  return (
    <main className="wrap">
      <a className="brand" href="/" aria-label="Super Water home"><img src="/assets/aquanimity.png" alt="Aquanimity" /><span className="sw"><span>Super</span><span>Water</span></span></a>
      <section className="card" id="card">{card}</section>
    </main>
  );
}
