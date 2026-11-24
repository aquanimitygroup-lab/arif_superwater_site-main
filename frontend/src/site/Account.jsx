import { useEffect, useRef, useState } from 'react';
import { ORDER_STEPS, describe, fmtDate, payLabel, stepOf, tk } from './orderStatus.js';
import { ReceiptModal } from './Receipt.jsx';

const Icon = ({ d, children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d ? <path d={d} /> : children}</svg>
);
const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></Icon>;
const BagIcon = () => <Icon><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></Icon>;
const PinIcon = () => <Icon><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></Icon>;
const OutIcon = () => <Icon><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M4 12h11" /><path d="m8 8-4 4 4 4" /></Icon>;
const Chevron = () => <Icon d="m6 9 6 6 6-6" />;
const CloseIcon = () => <Icon d="M6 6l12 12M18 6 6 18" />;

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

/* ---------------------------------------------------------------- header menu */
export function AccountMenu({ customer, onOpen, onSignOut }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (tab) => { setOpen(false); onOpen(tab); };
  return (
    <div className="acct-menu-wrap" ref={box}>
      <button type="button" className={`acct-chip${open ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="acct-avatar" aria-hidden="true">{initials(customer.name)}</span>
        <span className="acct-chip-name">{customer.name.split(' ')[0]}</span>
        <span className="acct-caret"><Chevron /></span>
      </button>
      {open ? (
        <div className="acct-menu" role="menu">
          <div className="acct-menu-head">
            <span className="acct-avatar lg" aria-hidden="true">{initials(customer.name)}</span>
            <div><strong>{customer.name}</strong><small title={customer.email}>{customer.email}</small></div>
          </div>
          <button type="button" role="menuitem" onClick={() => go('profile')}><UserIcon />My Profile</button>
          <button type="button" role="menuitem" onClick={() => go('orders')}><BagIcon />My Orders</button>
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onSignOut(); }}><OutIcon />Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- shared pieces */
function Timeline({ order }) {
  const step = stepOf(order);
  if (order.status === 'cancelled') return null;
  return (
    <ol className="acc-steps" aria-label="Order progress">
      {ORDER_STEPS.map((label, i) => (
        <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''}>
          <span className="dot">{i + 1 <= step ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> : i + 1}</span>
          <span className="lbl">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function OrderDetail({ order, onReceipt }) {
  const d = describe(order);
  return (
    <div className="acc-track-result">
      <div className="acc-track-top">
        <div><span className="acc-muted">Order</span><strong className="acc-code">{order.code}</strong></div>
        <span className={`acc-pill ${d.cls}`}>{d.state}</span>
      </div>
      <h3>{d.title}</h3>
      <p className="acc-muted">{d.msg}</p>
      <Timeline order={order} />
      <div className="acc-box">
        <table>
          <tbody>
            {order.items.map((i, n) => <tr key={n}><td>{`${i.qty} × ${i.name}`}</td><td className="r">{tk(i.qty * i.price)}</td></tr>)}
            <tr><td>Delivery</td><td className="r">{order.delivery_fee ? tk(order.delivery_fee) : 'Free'}</td></tr>
            <tr className="total"><td>Total</td><td className="r">{tk(order.total)}</td></tr>
          </tbody>
        </table>
      </div>
      <dl className="acc-meta">
        <div><dt>Placed on</dt><dd>{fmtDate(order.created_at)}</dd></div>
        <div><dt>Payment</dt><dd>{payLabel(order.payment_method)}</dd></div>
        {order.address ? <div className="wide"><dt>Deliver to</dt><dd>{order.address}, {order.city}</dd></div> : null}
      </dl>
      {onReceipt ? <button type="button" className="acc-btn sm" onClick={() => onReceipt(order)}>Receipt</button> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- tabs */
function ProfileTab({ customer, setCustomer, accountCall, toast, areas }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    setBusy(true); setErr('');
    try { const d = await accountCall('profile', body); setCustomer(d.customer); toast('Profile updated.'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const changePassword = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries());
    if (f.next !== f.confirm) { setPwErr('The two new passwords do not match.'); return; }
    setPwBusy(true); setPwErr('');
    try { await accountCall('password', { current: f.current, next: f.next }); form.reset(); toast('Password changed.'); }
    catch (x) { setPwErr(x.message); } finally { setPwBusy(false); }
  };
  const cityList = areas.includes(customer.city) || !customer.city ? areas : [customer.city, ...areas];

  return (<>
    <header className="acc-head"><h2>My Profile</h2><p>Your details are used to fill in the checkout for you.</p></header>
    <form className="acc-card" onSubmit={save} noValidate>
      <h3>Personal information</h3>
      <div className="acc-grid">
        <label>Full name<input name="name" defaultValue={customer.name} required maxLength={80} autoComplete="name" /></label>
        <label>Email address<input value={customer.email} readOnly disabled /></label>
        <label>Mobile number<input name="phone" type="tel" inputMode="tel" defaultValue={customer.phone} placeholder="01XXXXXXXXX" maxLength={20} autoComplete="tel" /></label>
        <label>Area / city
          {areas.length
            ? <select name="city" defaultValue={customer.city}><option value="">Select your area</option>{cityList.map((a) => <option key={a} value={a}>{a}</option>)}</select>
            : <input name="city" defaultValue={customer.city} maxLength={60} autoComplete="address-level2" />}
        </label>
        <label className="wide">Delivery address<textarea name="address" rows={3} defaultValue={customer.address} maxLength={300} autoComplete="street-address" placeholder="House, road, landmark" /></label>
      </div>
      {err ? <p className="acc-err" role="alert">{err}</p> : null}
      <div className="acc-actions"><button className="acc-btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </form>

    <form className="acc-card" onSubmit={changePassword} noValidate>
      <h3>Password &amp; security</h3>
      <div className="acc-grid">
        <label className="wide">Current password<input name="current" type="password" autoComplete="current-password" required maxLength={200} /></label>
        <label>New password <span className="opt">(8+ characters)</span><input name="next" type="password" autoComplete="new-password" required minLength={8} maxLength={200} /></label>
        <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required maxLength={200} /></label>
      </div>
      {pwErr ? <p className="acc-err" role="alert">{pwErr}</p> : null}
      <div className="acc-actions"><button className="acc-btn" type="submit" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Update password'}</button></div>
    </form>
  </>);
}

function OrdersTab({ accountCall, onShop }) {
  const [state, setState] = useState({ loading: true, orders: [], error: '' });
  const [selected, setSelected] = useState(null); // the order whose tracking is open
  const [receipt, setReceipt] = useState(null); // the order whose receipt is open
  useEffect(() => {
    let live = true;
    accountCall('my-orders')
      .then((d) => live && setState({ loading: false, orders: d.orders || [], error: '' }))
      .catch((e) => live && setState({ loading: false, orders: [], error: e.message }));
    return () => { live = false; };
  }, [accountCall]);

  const { loading, orders, error } = state;
  const spent = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  const delivered = orders.filter((o) => o.status === 'delivered').length;
  const active = orders.filter((o) => ['pending', 'confirmed', 'dispatched'].includes(o.status)).length;

  const modal = receipt ? (
    <ReceiptModal order={receipt} onClose={() => setReceipt(null)} secondary={{ label: 'Back to orders', onClick: () => { setReceipt(null); setSelected(null); } }} />
  ) : null;
  if (selected) return (<><TrackView order={selected} onBack={() => setSelected(null)} onReceipt={setReceipt} />{modal}</>);

  return (<>
    <header className="acc-head"><h2>My Orders</h2><p>Everything you have ordered while signed in.</p></header>
    {loading ? <p className="acc-muted">Loading your orders…</p> : error ? <p className="acc-err" role="alert">{error}</p> : orders.length === 0 ? (
      <div className="acc-empty">
        <span className="acc-empty-ic"><BagIcon /></span>
        <h3>No orders yet</h3>
        <p>When you place an order while signed in, it will show up here so you can follow it.</p>
        <button type="button" className="acc-btn primary" onClick={onShop}>Shop Super Water</button>
      </div>
    ) : (<>
      <div className="acc-stats">
        <div><strong>{orders.length}</strong><span>Total orders</span></div>
        <div><strong>{active}</strong><span>In progress</span></div>
        <div><strong>{delivered}</strong><span>Delivered</span></div>
        <div><strong>{tk(spent)}</strong><span>Total spent</span></div>
      </div>
      <ul className="acc-orders">
        {orders.map((o) => {
          const d = describe(o);
          return (
            <li key={o.code} className="acc-order">
              <div className="acc-order-top">
                <div><strong className="acc-code">{o.code}</strong><span className="acc-muted">{fmtDate(o.created_at)} · {payLabel(o.payment_method)}</span></div>
                <span className={`acc-pill ${d.cls}`}>{d.state}</span>
              </div>
              <p className="acc-order-items">{o.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</p>
              <div className="acc-order-foot">
                <strong>{tk(o.total)}</strong>
                <span className="acc-order-btns">
                  <button type="button" className="acc-btn sm primary" onClick={() => setSelected(o)}>Track order</button>
                  <button type="button" className="acc-btn sm" onClick={() => setReceipt(o)}>Receipt</button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>)}
    {modal}
  </>);
}

/** Tracking for one order, opened from "My Orders". Shows the latest status, progress and details. */
function TrackView({ order: initial, onBack, onReceipt }) {
  const [order, setOrder] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  // Refresh the order so the status is current.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/site?action=track&code=${encodeURIComponent(initial.code)}`, { cache: 'no-store' });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'Could not refresh the status.');
        if (live) setOrder(out);
      } catch (x) { if (live) setErr(x.message); } finally { if (live) setBusy(false); }
    })();
    return () => { live = false; };
  }, [initial.code]);

  return (<>
    <button type="button" className="acc-back" onClick={onBack}>&larr; Back to My Orders</button>
    <header className="acc-head"><h2>Track order</h2><p>{busy ? 'Checking the latest status…' : 'Follow your order from our facility to your door.'}</p></header>
    {err ? <p className="acc-err" role="alert">{err}</p> : null}
    <div className="acc-card"><OrderDetail order={order} onReceipt={onReceipt} /></div>
  </>);
}

/* ---------------------------------------------------------------- panel */
export function AccountPanel({ tab, setTab, onClose, customer, setCustomer, accountCall, toast, areas, onShop, onSignOut }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const tabs = [
    { id: 'profile', label: 'My Profile', icon: <UserIcon /> },
    { id: 'orders', label: 'My Orders', icon: <BagIcon /> },
  ];
  const active = tab === 'track' ? 'orders' : tab;

  return (
    <div className="acc-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="acc-modal" role="dialog" aria-modal="true" aria-label="My account">
        <button type="button" className="acc-x" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        <aside className="acc-side">
          <div className="acc-who">
            <span className="acct-avatar xl" aria-hidden="true">{initials(customer.name)}</span>
            <strong>{customer.name}</strong>
            <small title={customer.email}>{customer.email}</small>
          </div>
          <nav aria-label="Account sections">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>
            ))}
          </nav>
          <button type="button" className="acc-signout" onClick={onSignOut}><OutIcon />Sign out</button>
        </aside>
        <section className="acc-main">
          {active === 'profile' && <ProfileTab customer={customer} setCustomer={setCustomer} accountCall={accountCall} toast={toast} areas={areas} />}
          {active === 'orders' && <OrdersTab key="orders" accountCall={accountCall} onShop={onShop} />}
        </section>
      </div>
    </div>
  );
}
