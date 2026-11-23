import { useEffect, useRef, useState } from 'react';
import { api, toast, fail, tk, size, when, $, StockTiles, OrdersTable, FormCard, Field, SizeSelect } from './lib.jsx';

/** Loads a section's data; shows "Loading…" until it arrives, or the error in a card. */
function useLoad(load) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let live = true;
    load().then((data) => live && setState({ data, error: null }), (e) => live && setState({ data: null, error: e }));
    return () => { live = false; };
  }, []);
  return state;
}
function Loading({ state, children }) {
  if (state.error) return <div className="card"><p className="form-error">{state.error.message}</p></div>;
  if (!state.data) return <p className="muted">Loading…</p>;
  return children(state.data);
}

// ---------- overview ----------
export function Overview({ me, openOrder }) {
  const state = useLoad(() => api('dashboard'));
  return <Loading state={state}>{(d) => {
    const c = d.counts;
    const gw = d.gateways.filter((g) => g.configured);
    return (<>
      <div className="grid kpis">
        <div className="kpi"><b>{c.orders_24h}</b><span>Orders in the last 24 hours</span></div>
        <div className={`kpi ${c.to_confirm ? 'attn' : ''}`}><b>{c.to_confirm}</b><span>New orders to confirm</span></div>
        <div className={`kpi ${c.to_dispatch ? 'attn' : ''}`}><b>{c.to_dispatch}</b><span>Confirmed, waiting to dispatch</span></div>
        {me.role === 'admin' && <div className="kpi"><b>{tk(c.revenue_30d)}</b><span>{`Paid in the last 30 days (${c.paid_30d} orders)`}</span></div>}
      </div>
      <div><h2 style={{ fontSize: 17, margin: '4px 0 12px' }}>Stock at the production facility</h2><StockTiles stock={d.stock} /></div>
      <div><div className="toolbar" style={{ marginBottom: 12 }}><h2 style={{ fontSize: 17, margin: 0 }}>Latest orders</h2><a href="#orders">All orders →</a></div>
        <OrdersTable rows={d.recent} onOpen={openOrder} /></div>
      {me.role === 'admin' && <div className="card"><h2>Online payments</h2>
        <p className="hint">{gw.length ? `Connected: ${gw.map((g) => g.label).join(', ')}.` : 'No payment gateway is connected yet, so customers can only pay cash on delivery. See Payments & connections.'}</p></div>}
    </>);
  }}</Loading>;
}

// ---------- orders ----------
const orderFilter = { status: '', q: '' }; // remembered while the admin is open
const TABS = [['', 'All'], ['pending', 'New'], ['confirmed', 'Confirmed'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];

export function Orders({ openOrder, setActions }) {
  const [status, setStatus] = useState(orderFilter.status);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef();
  const load = async () => {
    try { const { orders } = await api('orders', { params: orderFilter }); setRows(orders); setError(null); }
    catch (e) { if (rows === null) setError(e); else fail(e); }
  };
  useEffect(() => {
    setActions(<button className="btn" type="button" onClick={() => load().catch(fail)}>Refresh</button>);
    load();
  }, []);
  if (error) return <div className="card"><p className="form-error">{error.message}</p></div>;
  return (<>
    <div className="toolbar">
      <div className="tabs">{TABS.map(([v, label]) => (
        <button key={v} type="button" className={status === v ? 'on' : ''} onClick={() => { orderFilter.status = v; setStatus(v); load(); }}>{label}</button>
      ))}</div>
      <input type="search" id="orderSearch" placeholder="Search code, name or phone" defaultValue={orderFilter.q}
        onInput={(e) => { const v = e.target.value; clearTimeout(timer.current); timer.current = setTimeout(() => { orderFilter.q = v; load(); }, 300); }} />
    </div>
    <div>{rows === null ? <p className="muted">Loading…</p> : <OrdersTable rows={rows} onOpen={openOrder} />}</div>
  </>);
}

// ---------- inventory ----------
const REASONS = { production: 'Production', stocktake: 'Stock count', adjustment: 'Adjustment', order_reserved: 'Reserved for order', order_released: 'Returned from order', order_dispatched: 'Dispatched' };

export function Inventory({ refresh, setActions }) {
  const state = useLoad(() => api('stock'));
  useEffect(() => { setActions(<button className="btn" type="button" onClick={refresh}>Refresh</button>); }, []);
  return <Loading state={state}>{({ stock, movements }) => (<>
    <StockTiles stock={stock} />
    <p className="hint" style={{ margin: '-6px 0 0' }}>"Reserved" bottles belong to website orders that have not left the facility yet. "Available" is what the website can still sell.</p>
    <div className="grid two">
      <FormCard title="Record production" hint="New bottles that came off the line at the facility." submitLabel="Add to stock" onSubmit={async () => {
        await api('production', { method: 'POST', data: { size_ml: Number($('#pSize').value), quantity: Number($('#pQty').value), batch: $('#pBatch').value, note: $('#pNote').value } });
        toast('Production recorded'); refresh();
      }}>
        <Field label="Bottle size" id="pSize"><SizeSelect id="pSize" /></Field>
        <Field label="Bottles produced" id="pQty"><input type="number" id="pQty" min={1} step={1} required /></Field>
        <Field label="Batch number" id="pBatch"><input type="text" id="pBatch" maxLength={60} /></Field>
        <Field label="Note" id="pNote"><input type="text" id="pNote" maxLength={300} /></Field>
      </FormCard>
      <FormCard title="Stock count" hint='Enter what was physically counted at the facility. This replaces the "At facility" number.' submitLabel="Save count" onSubmit={async () => {
        const r = await api('stocktake', { method: 'POST', data: { size_ml: Number($('#cSize').value), counted: Number($('#cQty').value), note: $('#cNote').value } });
        toast(`Count saved (${r.change >= 0 ? '+' : ''}${r.change} bottles)`); refresh();
      }}>
        <Field label="Bottle size" id="cSize"><SizeSelect id="cSize" /></Field>
        <Field label="Bottles counted" id="cQty"><input type="number" id="cQty" min={0} step={1} required /></Field>
        <Field label="Note" id="cNote"><input type="text" id="cNote" maxLength={300} /></Field>
      </FormCard>
      <FormCard title="Adjustment" hint="For breakage, samples or returns. Use a negative number to remove bottles." submitLabel="Save adjustment" onSubmit={async () => {
        await api('adjust', { method: 'POST', data: { size_ml: Number($('#aSize').value), change: Number($('#aQty').value), note: $('#aNote').value } });
        toast('Adjustment saved'); refresh();
      }}>
        <Field label="Bottle size" id="aSize"><SizeSelect id="aSize" /></Field>
        <Field label="Change (+/−)" id="aQty"><input type="number" id="aQty" step={1} required /></Field>
        <Field label="Reason" id="aNote"><input type="text" id="aNote" maxLength={300} required placeholder="e.g. 12 bottles damaged in loading" /></Field>
      </FormCard>
      <FormCard title="Low-stock alerts" hint="Show a warning when available bottles fall to this level." submitLabel="Save alert levels" onSubmit={async () => {
        for (const s of stock) await api('threshold', { method: 'POST', data: { size_ml: s.size_ml, low_threshold: Number($(`#t${s.size_ml}`).value) } });
        toast('Alert levels saved'); refresh();
      }}>
        {stock.map((s) => (
          <Field key={s.size_ml} label={`${size(s.size_ml)} alert level`} id={`t${s.size_ml}`}><input type="number" id={`t${s.size_ml}`} min={0} step={1} defaultValue={s.low_threshold} /></Field>
        ))}
      </FormCard>
    </div>
    <div><h2 style={{ fontSize: 17, margin: '4px 0 12px' }}>Stock history (latest 100)</h2>
      <div className="table-wrap">{movements.length ? <table>
        <thead><tr><th>When</th><th>Size</th><th>What happened</th><th className="r">At facility</th><th className="r">Reserved</th><th>Reference</th><th>By</th></tr></thead>
        <tbody>{movements.map((m) => (
          <tr key={m.id}>
            <td className="muted">{when(m.created_at)}</td><td>{size(m.size_ml)}</td><td>{REASONS[m.reason] || m.reason}{m.note ? <div className="muted">{m.note}</div> : null}</td>
            <td className="r num">{m.on_hand_change ? <span className={`pill ${m.on_hand_change > 0 ? 'change-pos' : 'change-neg'}`}>{`${m.on_hand_change > 0 ? '+' : ''}${m.on_hand_change}`}</span> : '—'}</td>
            <td className="r num">{m.reserved_change ? `${m.reserved_change > 0 ? '+' : ''}${m.reserved_change}` : '—'}</td>
            <td>{m.ref || '—'}</td><td className="muted">{m.actor || '—'}</td>
          </tr>
        ))}</tbody>
      </table> : <p className="empty">No stock changes yet. Record the first production run above.</p>}</div>
    </div>
  </>)}</Loading>;
}

// ---------- content ----------
function CmsField({ f, defaults, values, edits, onEdit, onReset }) {
  const ref = useRef();
  const id = `cms-${f.key.replace(/[^a-z0-9]/gi, '-')}`;
  const current = f.key in edits ? edits[f.key] : f.key in values ? values[f.key] : defaults[f.key];
  const changed = JSON.stringify(current) !== JSON.stringify(defaults[f.key]);
  let body;
  if (f.type === 'bool') {
    body = <label className="check" htmlFor={id}><input type="checkbox" id={id} defaultChecked={Boolean(current)} onChange={(e) => onEdit(f.key, e.target.checked)} />{f.label}</label>;
  } else {
    const isBn = f.key.endsWith('.bn');
    const input = f.type === 'long' || f.type === 'lines'
      ? <textarea id={id} ref={ref} rows={f.type === 'lines' ? 6 : 3} lang={isBn ? 'bn' : undefined} defaultValue={current ?? ''} onInput={(e) => onEdit(f.key, e.target.value)} />
      : <input type={f.type === 'number' ? 'number' : 'text'} id={id} ref={ref} min={f.type === 'number' ? 0 : undefined} lang={isBn ? 'bn' : undefined} defaultValue={current ?? ''}
          onInput={(e) => onEdit(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} />;
    body = (<>
      <div className="field-head"><label htmlFor={id}>{f.label}</label>
        <button type="button" className="reset" onClick={() => { onReset(f.key); ref.current.value = defaults[f.key] ?? ''; }}>Reset to original</button></div>
      {input}
    </>);
  }
  return <div className={`field${changed ? ' changed' : ''}`}>{body}{f.help ? <p className="hint">{f.help}</p> : null}</div>;
}

export function Content({ setActions }) {
  const state = useLoad(() => api('content'));
  const [values, setValues] = useState(null);
  const [edits, setEdits] = useState({});
  const [resets, setResets] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);
  const n = Object.keys(edits).length + resets.size;
  pending.current = n;

  useEffect(() => {
    setActions(<a className="btn" href="/" target="_blank" rel="noopener">Open website ↗</a>);
    window.onbeforeunload = () => (pending.current ? true : undefined);
    return () => { window.onbeforeunload = null; };
  }, []);
  useEffect(() => { if (state.data) setValues(state.data.values); }, [state.data]);

  const onEdit = (key, v) => {
    setEdits((e) => ({ ...e, [key]: v }));
    setResets((r) => { const x = new Set(r); x.delete(key); return x; });
  };
  const onReset = (key) => {
    setEdits((e) => { const x = { ...e }; delete x[key]; return x; });
    if (key in values) setResets((r) => new Set(r).add(key));
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await api('content-save', { method: 'POST', data: { values: edits, reset: [...resets] } });
      setValues(r.values); setEdits({}); setResets(new Set());
      toast('Saved. The website shows the change within about 15 seconds.');
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  return <Loading state={state}>{({ groups, defaults }) => values && (<>
    <p className="hint" style={{ margin: 0 }}>Edit any text on the website. Highlighted fields differ from the original. Changes go live when you press Save.</p>
    {groups.map((g, i) => {
      const changedCount = g.fields.filter((f) => f.key in values).length;
      return (
        <details className="cms-group" open={i === 0} key={g.id}>
          <summary>{g.title}{changedCount ? <span className="count">{`${changedCount} changed`}</span> : null}</summary>
          <div className="cms-body">
            {g.note ? <p className="cms-note">{g.note}</p> : null}
            {g.fields.map((f) => <CmsField key={f.key} f={f} defaults={defaults} values={values} edits={edits} onEdit={onEdit} onReset={onReset} />)}
          </div>
        </details>
      );
    })}
    <div className="savebar"><span>{n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
      <button className="btn accent" type="button" disabled={n === 0 || saving} onClick={save}>Save changes</button></div>
  </>)}</Loading>;
}

// ---------- products ----------
function ProductRow({ p }) {
  const name = useRef(), price = useRef(), was = useRef(), active = useRef();
  const save = async () => {
    try {
      await api('product-save', { method: 'POST', data: { sku: p.sku, name: name.current.value, price: Number(price.current.value), was: Number(was.current.value), active: active.current.checked } });
      toast(`${name.current.value} saved`);
    } catch (e) { fail(e); }
  };
  return (
    <tr>
      <td><input type="text" id={`n-${p.sku}`} ref={name} defaultValue={p.name} maxLength={80} /><div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{`${p.bottles} × ${size(p.size_ml)} · ${p.sku}`}</div></td>
      <td><input type="number" id={`p-${p.sku}`} ref={price} defaultValue={p.price} min={0} step={1} style={{ maxWidth: 110 }} /></td>
      <td><input type="number" id={`w-${p.sku}`} ref={was} defaultValue={p.was} min={0} step={1} style={{ maxWidth: 110 }} /></td>
      <td><label className="check" htmlFor={`a-${p.sku}`}><input type="checkbox" id={`a-${p.sku}`} ref={active} defaultChecked={p.active} />On sale</label></td>
      <td><button className="btn small primary" type="button" onClick={save}>Save</button></td>
    </tr>
  );
}

export function Products() {
  const state = useLoad(() => api('products'));
  return <Loading state={state}>{({ products }) => (<>
    <p className="hint" style={{ margin: 0 }}>Prices are in Taka. "Regular price" is shown crossed out next to the sale price; set it equal to the price to hide the saving. Turn off "On sale" to hide a product from the shop. The text on each shop card is edited under Website content → Shop cards.</p>
    <div className="table-wrap"><table>
      <thead><tr><th>Product</th><th>Price (Tk)</th><th>Regular price (Tk)</th><th>Shop</th><th></th></tr></thead>
      <tbody>{products.map((p) => <ProductRow key={p.sku} p={p} />)}</tbody>
    </table></div>
  </>)}</Loading>;
}

// ---------- payments & connections ----------
export function Payments() {
  const state = useLoad(() => api('gateways'));
  const origin = location.origin;
  return <Loading state={state}>{({ gateways }) => (<>
    <div className="card"><h2>How payments work</h2>
      <p className="hint">Cash on delivery works now. An online gateway appears at checkout as soon as its keys are added to the server settings (appsettings.json or environment variables) and the server is restarted. Switch payment methods on or off under Website content → Ordering.</p></div>
    {gateways.map((g) => (
      <div className="card" key={g.id}>
        <div className="toolbar"><h2>{g.label}</h2>{g.configured ? <span className="pill ok">{g.live ? 'Connected · live' : 'Connected · test mode'}</span> : <span className="pill off">Not connected</span>}</div>
        <p className="hint">Settings:</p>
        <pre className="code">{g.env.join('\n')}</pre>
        <p className="hint">If the gateway asks for your website addresses, use:</p>
        <pre className="code">{g.id === 'sslcommerz'
          ? `IPN (notification) URL: ${origin}/api/payment?provider=sslcommerz&action=ipn\nThe success, fail and cancel addresses are sent automatically with each payment.`
          : `Callback addresses are sent automatically with each payment:\n${origin}/api/payment?provider=${g.id}&action=callback`}</pre>
      </div>
    ))}
    <div className="card"><h2>Production facility connection</h2>
      <p className="hint">Facility staff can sign in here with a Production account (People → Add person). If the facility has its own software, it can send production and stock counts directly using the facility API key (FACILITY_API_KEY in the server settings).</p>
      <pre className="code">{`# Stock levels and orders waiting for dispatch
curl ${origin}/api/facility -H "Authorization: Bearer YOUR_FACILITY_API_KEY"

# Record a production batch
curl -X POST "${origin}/api/facility?action=production" \\
  -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" \\
  -d '{"size_ml":500,"quantity":2400,"batch":"B-1121"}'

# Record a physical stock count
curl -X POST "${origin}/api/facility?action=stocktake" \\
  -H "Authorization: Bearer YOUR_FACILITY_API_KEY" -H "Content-Type: application/json" \\
  -d '{"size_ml":2000,"counted":860,"note":"Monthly count"}'`}</pre>
    </div>
  </>)}</Loading>;
}

// ---------- people ----------
function PersonEditor({ u, onClose, refresh }) {
  const submit = async (e) => {
    e.preventDefault();
    const err = e.currentTarget.querySelector('.form-error');
    err.textContent = '';
    try {
      await api('user-save', { method: 'POST', data: { id: u.id, email: $('#uEmail').value, name: $('#uName').value, role: $('#uRole').value, password: $('#uPass').value, active: $('#uActive').checked } });
      toast(u.id ? 'Account updated' : 'Account created'); refresh();
    } catch (x) { err.textContent = x.message; }
  };
  return (
    <div className="card"><h2>{u.id ? `Edit ${u.email}` : 'Add a person'}</h2>
      <p className="hint">Give production staff "Production" access: they can see and dispatch orders and record stock, but cannot change the website or prices.</p>
      <form noValidate onSubmit={submit}>
        <div className="form-grid">
          <Field label="Email" id="uEmail"><input type="email" id="uEmail" defaultValue={u.email || ''} required /></Field>
          <Field label="Name" id="uName"><input type="text" id="uName" defaultValue={u.name || ''} /></Field>
          <Field label="Access" id="uRole"><select id="uRole" defaultValue={u.role === 'admin' ? 'admin' : 'production'}><option value="production">Production (orders &amp; stock)</option><option value="admin">Administrator (everything)</option></select></Field>
          <Field label={u.id ? 'New password (leave empty to keep)' : 'Password (at least 10 characters)'} id="uPass"><input type="password" id="uPass" autoComplete="new-password" /></Field>
        </div>
        <p><label className="check" htmlFor="uActive"><input type="checkbox" id="uActive" defaultChecked={u.active !== false} />Can sign in</label></p>
        <p className="form-error"></p>
        <div className="actions"><button className="btn primary" type="submit">{u.id ? 'Save' : 'Create account'}</button><button className="btn" type="button" onClick={onClose}>Close</button></div>
      </form>
    </div>
  );
}

export function People({ refresh, setActions }) {
  const state = useLoad(() => api('users'));
  const [editing, setEditing] = useState(null);
  useEffect(() => { setActions(<button className="btn primary" type="button" onClick={() => setEditing({ key: Date.now() })}>Add person</button>); }, []);
  return <Loading state={state}>{({ users }) => (<>
    <div>{editing && <PersonEditor key={editing.key} u={editing} onClose={() => setEditing(null)} refresh={refresh} />}</div>
    <div className="table-wrap"><table>
      <thead><tr><th>Email</th><th>Name</th><th>Access</th><th>Status</th><th></th></tr></thead>
      <tbody>{users.map((u) => (
        <tr key={u.id}><td>{u.email}</td><td>{u.name || '—'}</td><td>{u.role === 'admin' ? 'Administrator' : 'Production'}</td>
          <td>{u.active ? <span className="pill ok">Active</span> : <span className="pill off">Disabled</span>}</td>
          <td className="r"><button className="btn small" type="button" onClick={() => setEditing({ ...u, key: Date.now() })}>Edit</button></td></tr>
      ))}</tbody>
    </table></div>
  </>)}</Loading>;
}

// ---------- my account ----------
export function Account({ me }) {
  return (
    <FormCard title="Change password" hint={`Signed in as ${me.email}. Changing your password signs you out everywhere else.`} submitLabel="Change password" onSubmit={async () => {
      await api('password', { method: 'POST', data: { current: $('#curPass').value, next: $('#newPass').value } });
      toast('Password changed');
    }}>
      <Field label="Current password" id="curPass"><input type="password" id="curPass" autoComplete="current-password" required /></Field>
      <Field label="New password (at least 10 characters)" id="newPass"><input type="password" id="newPass" autoComplete="new-password" required /></Field>
    </FormCard>
  );
}
