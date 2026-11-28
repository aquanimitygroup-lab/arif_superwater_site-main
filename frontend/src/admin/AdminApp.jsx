import { useCallback, useEffect, useRef, useState } from 'react';
import { api, toast, fail, tk, size, when, StatusPill, PAY_LABEL, setUnauthorizedHandler, setToastHandler } from './lib.jsx';
import { Overview, Orders, Inventory, Content, Products, Payments, Emails, People, Account } from './sections.jsx';

// ---------- navigation ----------
const SECTIONS = [
  { id: 'overview', title: 'Overview', roles: ['admin', 'production'], C: Overview },
  { id: 'orders', title: 'Orders', roles: ['admin', 'production'], C: Orders },
  { id: 'inventory', title: 'Inventory', roles: ['admin', 'production'], C: Inventory },
  { id: 'content', title: 'Website content', roles: ['admin'], C: Content },
  { id: 'products', title: 'Products & prices', roles: ['admin'], C: Products },
  { id: 'payments', title: 'Payments & connections', roles: ['admin'], C: Payments },
  { id: 'emails', title: 'Email notifications', roles: ['admin'], C: Emails },
  { id: 'people', title: 'People', roles: ['admin'], C: People },
  { id: 'account', title: 'My account', roles: ['admin', 'production'], C: Account },
];

/** Shows what is missing on the server when the site is not ready for sign-in. */
function SetupBox() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin?action=status', { cache: 'no-store' });
        if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error();
        setSt(await r.json());
      } catch {
        setSt({ ready: false, offline: true });
      }
    })();
  }, []);
  if (!st || st.ready) return <div className="setup" id="setupBox" hidden></div>;
  const rows = st.offline
    ? [[false, 'The server part of the site is not running', 'Start the .NET server (backend/SuperWater.Api). See README step 1.']]
    : [[st.database.ok, 'Database', st.database.message], [st.session_secret.ok, 'SESSION_SECRET', st.session_secret.message], [st.admin.ok, 'Admin account', st.admin.message]];
  return (
    <div className="setup" id="setupBox">
      <h2>The site needs setting up on the server</h2>
      <ul>{rows.map(([ok, label, msg]) => <li key={label}><span className={ok ? 'ok' : 'no'}>{ok ? '✓' : '✕'}</span><span><b>{label}</b>{ok ? '' : ` · ${msg}`}</span></li>)}</ul>
      <p className="hint" style={{ margin: 0 }}>Add missing settings to appsettings.json (or the server's environment variables), then restart the server.</p>
    </div>
  );
}

function Login({ onSignedIn }) {
  const [error, setError] = useState('');
  const email = useRef(), password = useRef();
  useEffect(() => { email.current.focus(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const btn = e.nativeEvent.submitter; btn.disabled = true; setError('');
    try {
      await api('login', { method: 'POST', data: { email: email.current.value, password: password.current.value } });
      password.current.value = '';
      await onSignedIn();
    } catch (err) { setError(err.message); }
    finally { btn.disabled = false; }
  };
  return (
    <main id="login" className="login">
      <form id="loginForm" className="login-card" noValidate onSubmit={submit}>
        <img src="/assets/aquanimity.png" alt="Aquanimity" className="login-logo" />
        <h1>Super Water admin</h1>
        <label htmlFor="loginEmail">Email</label>
        <input id="loginEmail" ref={email} type="email" autoComplete="username" required />
        <label htmlFor="loginPassword">Password</label>
        <input id="loginPassword" ref={password} type="password" autoComplete="current-password" required />
        <p className="form-error" id="loginError" role="alert">{error}</p>
        <SetupBox />
        <button className="btn primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}

function OrderPanel({ me, order: o, events, onAction, onClose }) {
  const isAdmin = me.role === 'admin';
  const btns = [];
  const canDispatch = ['pending', 'confirmed'].includes(o.status) && (o.payment_method === 'cod' || o.payment_status === 'paid');
  if (isAdmin && o.status === 'pending') btns.push(<button key="c" className="btn primary" onClick={() => onAction('confirm')}>Confirm order</button>);
  if (canDispatch) btns.push(<button key="d" className="btn accent" onClick={() => onAction('dispatch', 'Mark this order as dispatched? Its bottles will be taken out of facility stock.')}>Mark dispatched</button>);
  if (isAdmin && o.status === 'dispatched') btns.push(<button key="v" className="btn primary" onClick={() => onAction('deliver')}>Mark delivered</button>);
  if (isAdmin && ['pending', 'confirmed'].includes(o.status)) btns.push(<button key="x" className="btn danger" onClick={() => onAction('cancel', o.payment_status === 'paid' ? 'This order was paid online. Cancel it? You will need to refund the customer through the payment gateway.' : 'Cancel this order? Its bottles go back into available stock.')}>Cancel order</button>);
  if (isAdmin && o.payment_status !== 'paid' && o.status !== 'cancelled') btns.push(<button key="p" className="btn small" onClick={() => onAction('mark_paid', 'Mark this order as paid?')}>Mark paid</button>);
  if (isAdmin && o.payment_status === 'paid' && o.payment_method !== 'cod') btns.push(<button key="r" className="btn small" onClick={() => onAction('mark_refunded', 'Record that this payment was refunded?')}>Mark refunded</button>);
  if (o.payment_method !== 'cod' && o.payment_status !== 'paid' && o.status === 'pending') btns.push(<p key="h" className="hint">Waiting for online payment. Unpaid online orders are cancelled automatically after 2 hours.</p>);

  return (<>
    <div id="scrim" className="scrim" onClick={onClose}></div>
    <aside id="panel" className="panel" aria-label="Order details">
      <header><h2 id="panelTitle">{`Order ${o.code}`}</h2><button id="panelClose" className="icon" type="button" aria-label="Close" onClick={onClose}>✕</button></header>
      <div id="panelBody" className="panel-body">
        <div className="actions"><StatusPill s={o.status} /><StatusPill s={o.payment_status} /><span className="muted">{when(o.created_at)}</span></div>
        {btns.length ? <div className="actions">{btns}</div> : null}
        <div><h3>Customer</h3><dl className="kv">
          <dt>Name</dt><dd>{o.customer_name}</dd>
          <dt>Phone</dt><dd><a href={`tel:${o.phone}`}>{o.phone}</a></dd>
          <dt>Email</dt><dd>{o.email || '—'}</dd>
          <dt>Address</dt><dd>{o.address}</dd>
          <dt>Area / city</dt><dd>{o.city}</dd>
          <dt>Note</dt><dd>{o.note || '—'}</dd>
        </dl></div>
        <div><h3>Items</h3><table className="items"><tbody>{o.items.map((i, n) => (
          <tr key={n}><td>{`${i.qty} × ${i.name}`}<div className="muted">{`${i.qty * i.bottles} bottles of ${size(i.size_ml)}`}</div></td><td className="r num">{tk(i.qty * i.price)}</td></tr>
        ))}</tbody></table>
          <div className="totals"><span>{`Subtotal ${tk(o.subtotal)}`}</span><span>{`Delivery ${tk(o.delivery_fee)}`}</span><b>{`Total ${tk(o.total)}`}</b></div></div>
        <div><h3>Payment</h3><dl className="kv">
          <dt>Method</dt><dd>{PAY_LABEL[o.payment_method] || o.payment_method}</dd>
          <dt>Gateway reference</dt><dd>{o.provider_ref || '—'}</dd>
          <dt>Stock</dt><dd>{{ reserved: 'Reserved at the facility', released: 'Returned to stock', dispatched: 'Taken out of stock' }[o.stock_state]}</dd>
        </dl></div>
        {events.length ? <div><h3>Payment gateway log</h3><div className="table-wrap"><table><tbody>{events.map((e, n) => (
          <tr key={n}><td className="muted">{when(e.created_at)}</td><td>{`${e.provider} · ${e.kind}`}</td><td>{e.ok ? <span className="pill ok">OK</span> : <span className="pill off">{(e.payload && e.payload.outcome) || '—'}</span>}</td></tr>
        ))}</tbody></table></div></div> : null}
      </div>
    </aside>
  </>);
}

export default function AdminApp() {
  const [me, setMe] = useState(null);
  const [mode, setMode] = useState('boot'); // boot | login | app
  const [hash, setHash] = useState(location.hash.slice(1));
  const [reload, setReload] = useState(0);
  const [actions, setActions] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState(null);
  const [toastState, setToastState] = useState({ msg: '', show: false, err: false });
  const toastTimer = useRef();

  useEffect(() => {
    setToastHandler((msg, err) => {
      setToastState({ msg, show: true, err });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastState((s) => ({ ...s, show: false, err: false })), 3200);
    });
    setUnauthorizedHandler(() => { setMode('login'); setPanel(null); });
  }, []);

  const boot = useCallback(async () => {
    // Only a real "not signed in" answer (401) shows the sign-in page. A server that is restarting or a network blip is retried,
    // so reloading the page never signs the admin out by accident.
    for (let i = 0; i < 5; i++) {
      try {
        const { user } = await api('me');
        setMe(user); setMode('app');
        return;
      } catch (e) {
        if (e.status === 401) { setMode('login'); return; }
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
    setMode('login');
  }, []);
  useEffect(() => { boot(); }, [boot]);

  // ---------- routing (#section) ----------
  useEffect(() => {
    const onHash = () => { setHash(location.hash.slice(1)); setActions(null); setMenuOpen(false); setReload((n) => n + 1); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  // Re-renders the current section with fresh data (the section sets its page actions again).
  const refresh = useCallback(() => { setActions(null); setMenuOpen(false); setReload((n) => n + 1); }, []);
  const allowed = me ? SECTIONS.filter((s) => s.roles.includes(me.role)) : [];
  const section = allowed.find((s) => s.id === hash) || allowed[0];

  // ---------- order panel ----------
  const openOrder = useCallback(async (id) => {
    try {
      const { order, events } = await api('order', { params: { id } });
      setPanel({ order, events });
    } catch (e) { fail(e); }
  }, []);
  const closePanel = useCallback(() => setPanel(null), []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closePanel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closePanel]);
  const doAction = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api('order-action', { method: 'POST', data: { id: panel.order.id, action } });
      toast('Order updated'); await openOrder(panel.order.id); refresh();
    } catch (e) { fail(e); }
  };

  const logout = async () => { await api('logout', { method: 'POST' }).catch(() => {}); setMe(null); window.location.replace('/'); };

  return (<>
    {mode === 'login' && <Login onSignedIn={boot} />}

    {mode === 'app' && me && section && (
      <div id="app" className={`app${menuOpen ? ' menu-open' : ''}`}>
        <aside className="side">
          <div className="brand">
            <img src="/assets/aquanimity-white.png" alt="Aquanimity" />
            <img className="sw-logo" src="/assets/sw-en-v2.png" alt="Super Water" width="769" height="337" />
          </div>
          <nav id="nav" aria-label="Admin sections">
            {allowed.map((s) => <a key={s.id} href={`#${s.id}`} data-id={s.id} className={s.id === section.id ? 'on' : undefined}>{s.title}</a>)}
          </nav>
          <div className="side-foot">
            <div id="whoami" className="who">{`${me.email} · ${me.role === 'admin' ? 'Administrator' : 'Production'}`}</div>
            <a href="/" target="_blank" rel="noopener noreferrer" className="side-link">View website ↗</a>
            <button id="logout" className="side-link" type="button" onClick={logout}>Sign out</button>
          </div>
        </aside>
        <section className="main">
          <header className="topbar">
            <button id="menuToggle" className="menu-toggle" type="button" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>☰</button>
            <h1 id="pageTitle">{section.title}</h1>
            <div id="pageActions" className="page-actions">{actions}</div>
          </header>
          <div id="view" className="view">
            <section.C key={`${section.id}-${reload}`} me={me} openOrder={openOrder} refresh={refresh} setActions={setActions} />
          </div>
        </section>
      </div>
    )}

    {panel && mode === 'app' && <OrderPanel me={me} order={panel.order} events={panel.events} onAction={doAction} onClose={closePanel} />}

    <div id="toast" className={`toast${toastState.show ? ' show' : ''}${toastState.err ? ' err' : ''}`} role="status">{toastState.msg}</div>
  </>);
}
