import { useEffect, useState } from 'react';

const tk = (n) => 'Tk ' + Number(n).toLocaleString('en-IN');

/** What the customer is told for each order state (same wording as before). */
function describe(o) {
  const online = o.payment_method !== 'cod';
  if (o.status === 'cancelled' && online && o.payment_status === 'failed')
    return { title: "Payment didn't go through", msg: 'Your payment was not completed, so this order was cancelled and you have not been charged. You can try again from the shop.', state: 'Cancelled', cls: 'bad' };
  if (o.status === 'cancelled')
    return { title: 'Order cancelled', msg: 'This order has been cancelled. Contact us if you think this is a mistake.', state: 'Cancelled', cls: 'bad' };
  if (online && o.payment_status !== 'paid')
    return { title: 'Confirming your payment', msg: "We're waiting for the payment provider to confirm. Refresh this page in a minute.", state: 'Payment pending', cls: '' };
  if (o.status === 'delivered')
    return { title: 'Delivered', msg: 'Your Super Water has been delivered. Enjoy!', state: 'Delivered', cls: 'good' };
  if (o.status === 'dispatched')
    return { title: 'On its way', msg: 'Your order has left our facility and is on its way to you.', state: 'Dispatched', cls: 'good' };
  if (online)
    return { title: 'Payment received', msg: 'Thank you! Your order is confirmed and will be dispatched soon.', state: 'Paid', cls: 'good' };
  return { title: 'Order received', msg: "Thank you! We'll call you shortly to confirm your order and delivery time. Please keep the cash ready on delivery.", state: o.status === 'confirmed' ? 'Confirmed' : 'Received', cls: '' };
}

export default function OrderApp() {
  const [data, setData] = useState(null); // { order } | { error }

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
      <a className="btn" href={o.status === 'cancelled' ? '/#shop' : '/'}>{o.status === 'cancelled' ? 'Back to the shop' : 'Back to Super Water'}</a>
    </>);
  }

  return (
    <main className="wrap">
      <a className="brand" href="/" aria-label="Super Water home"><img src="/assets/aquanimity.png" alt="Aquanimity" /><span className="sw"><span>Super</span><span>Water</span></span></a>
      <section className="card" id="card">{card}</section>
    </main>
  );
}
