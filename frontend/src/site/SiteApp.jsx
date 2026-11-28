import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccountMenu, AccountPanel } from './Account.jsx';
import { DownloadIcon, ReceiptModal, downloadReceipt, fetchOrder } from './Receipt.jsx';
import { DEFAULTS, PRODUCTS, PLANS, INGREDIENTS, Q_PATH, tk, sizeOf } from './data.js';

/* ---------- small icons ---------- */
const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
);
const DropIcon = ({ w = '2.4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" /></svg>
);
const ShieldIcon = ({ w = '2.4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" /></svg>
);
const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /><path d="M8 12h2l1-2 2 4 1-2h2" /></svg>
);
const BalanceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /></svg>
);
const ING_ICONS = [<DropIcon key="1" />, <ShieldIcon key="2" />, <HeartIcon key="3" />, <BalanceIcon key="4" />];

/* ---------- checkout: payment methods shown to the customer ---------- */
const Lock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const PAY_METHODS = [
  { id: 'sslcommerz', name: 'SSLCommerz', desc: 'Cards, mobile banking and internet banking', mark: <span>SSL</span> },
  { id: 'bkash', name: 'bKash', desc: 'Pay with your bKash wallet', mark: <span>b</span> },
  { id: 'cod', name: 'Cash on delivery', desc: 'Pay in cash when your order arrives', mark: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v.01M18 14.5v.01" /></svg> },
];
const WORKING_STEPS = ['Checking stock availability…', 'Reserving your bottles…', 'Confirming your order…'];
const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2 + (i % 2 ? 0.2 : 0), r = 78 + (i % 3) * 22;
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), c: ['#00B4D3', '#0E1036', '#B3E1F2', '#52d6ec'][i % 4], d: (i % 6) * 0.04 };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPTY_DETAILS = { name: '', phone: '', address: '', city: '', email: '', note: '' };

/* ---------- customer account API ---------- */
async function accountCall(action, body) {
  const r = await fetch(`/api/site?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'x-sw-site': '1' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
  return out;
}

/* ---------- cart storage ---------- */
// Every signed-in customer has their own cart; visitors who are not signed in share one "guest" cart.
const GUEST_CART = 'sw-cart';
const cartKeyFor = (c) => (c && c.id ? `sw-cart-u${c.id}` : GUEST_CART);
const readMeHint = () => { try { return JSON.parse(localStorage.getItem('sw-me') || 'null'); } catch (e) { return null; } };
function loadCart(key = GUEST_CART) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
}
const saveCart = (cart, key = GUEST_CART) => { try { localStorage.setItem(key, JSON.stringify(cart)); } catch (e) { /* private mode */ } };

export default function SiteApp() {
  /* ---------- live data from the server (prices, stock, checkout). Until it arrives the built-in prices are shown. ---------- */
  const [products, setProducts] = useState(() => structuredClone(PRODUCTS));
  const [live, setLive] = useState({ ok: false, available: { 500: Infinity, 2000: Infinity }, checkout: null });
  const liveRef = useRef(live);
  liveRef.current = live;
  const [content, setContent] = useState({}); // only the values changed in the admin
  const [checkoutNote, setCheckoutNote] = useState('Delivery charge shown at checkout.');

  const [cart, setCart] = useState(() => loadCart(cartKeyFor(readMeHint())));
  const [size, setSize] = useState('500');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState('cart'); // cart → checkout (details) → payment → review → done
  const [payMethod, setPayMethod] = useState('');
  const [coErr, setCoErr] = useState('');
  const [placing, setPlacing] = useState(false);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [anim, setAnim] = useState(''); // '' | working | redirect
  const [animStep, setAnimStep] = useState(0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [justAdded, setJustAdded] = useState('');
  const [done, setDone] = useState({ code: '', msg: '', link: '#', rawCode: '', token: '', order: null });
  const [receipt, setReceipt] = useState(null);
  const [dlBusy, setDlBusy] = useState(false);
  const [toastState, setToastState] = useState({ msg: '', show: false });
  const [symbol, setSymbol] = useState({ sym: 'K', label: 'Potassium' });
  // Start from the last known signed-in customer so a reload does not flash the Login button; the server confirms it below.
  const [staff, setStaff] = useState(null); // an admin/staff member browsing the site: shown as signed in, never logged out
  const [customer, setCustomer] = useState(() => { try { return JSON.parse(localStorage.getItem('sw-me') || 'null'); } catch (e) { return null; } });
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [acctTab, setAcctTab] = useState(null); // null | profile | orders | track
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const refs = {
    loader: useRef(null), nav: useRef(null), navLinks: useRef(null), heroBottle: useRef(null), pipeline: useRef(null),
    ingList: useRef(null), ingBottle: useRef(null), symBox: useRef(null), dots: useRef(null),
    pill: useRef(null), toggle: useRef(null), cartCount: useRef(null), cartBtn: useRef(null), closeCart: useRef(null),
    form: useRef(null), coName: useRef(null), coPhone: useRef(null), coAddress: useRef(null), coCity: useRef(null),
    coCitySelect: useRef(null), coEmail: useRef(null), coPayEmail: useRef(null), coNote: useRef(null), announce: useRef(null),
  };

  /* ---------- text: admin changes override the built-in text ---------- */
  const t = (key) => (typeof content[key] === 'string' ? content[key] : DEFAULTS[key]);
  const plan = (sku, f) => (content[`plans.${sku}.${f}`] !== undefined ? content[`plans.${sku}.${f}`] : DEFAULTS[`plans.${sku}.${f}`]);
  const marquee = useMemo(() => {
    const own = typeof content['marquee.items'] === 'string' ? content['marquee.items'].split('\n').filter(Boolean) : [];
    return own.length ? own : DEFAULTS['marquee.items'].split('\n').filter(Boolean);
  }, [content]);
  const showSale = content['hero.sale_show'] !== false;
  const announce = content['announce.enabled'] && content['announce.text'] ? content['announce.text'] : '';

  /* ---------- toast ---------- */
  const toastTimer = useRef();
  const toast = useCallback((msg) => {
    setToastState({ msg, show: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState((s) => ({ ...s, show: false })), 2600);
  }, []);

  /* ---------- preloader ---------- */
  useEffect(() => {
    const hide = () => setTimeout(() => refs.loader.current?.classList.add('done'), 1300);
    if (document.readyState === 'complete') hide();
    else { addEventListener('load', hide); return () => removeEventListener('load', hide); }
  }, []);

  /* ---------- navbar ---------- */
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 20);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    // highlight the section in view
    const linkFor = (id) => refs.navLinks.current.querySelector(`a[href="#${id}"]`);
    const navIO = new IntersectionObserver((es) => es.forEach((e) => {
      const a = linkFor(e.target.id); if (a) a.classList.toggle('active', e.isIntersecting);
    }), { rootMargin: '-45% 0px -50% 0px' });
    ['ingredients', 'science', 'shop'].forEach((id) => navIO.observe(document.getElementById(id)));
    return () => { removeEventListener('scroll', onScroll); navIO.disconnect(); };
  }, []);

  /* ---------- reveal on scroll ---------- */
  useEffect(() => {
    const rvIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); } }), { threshold: 0.15 });
    document.querySelectorAll('.rv').forEach((el) => rvIO.observe(el));
    const pipe = refs.pipeline.current;
    const pipeIO = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && pipe.classList.add('in')), { threshold: 0.4 });
    pipeIO.observe(pipe);
    return () => { rvIO.disconnect(); pipeIO.disconnect(); };
  }, []);

  /* ---------- hero bottle: gentle tilt on scroll ---------- */
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onScroll = () => {
      const p = Math.min(scrollY / innerHeight, 1);
      refs.heroBottle.current.style.transform = `translateY(${p * 80}px) rotate(${p * 8}deg) scale(${1 - p * 0.08})`;
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  /* ---------- ingredients: sticky bottle follows the active card ---------- */
  useEffect(() => {
    const cards = [...refs.ingList.current.querySelectorAll('.ing-card')];
    const dots = [...refs.dots.current.querySelectorAll('i')];
    const symBox = refs.symBox.current;
    let activeIdx = 0, swapTimer;
    const setActive = (i) => {
      if (i === activeIdx) return;
      activeIdx = i;
      const c = INGREDIENTS[i];
      cards.forEach((x, j) => x.classList.toggle('active', j === i));
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
      refs.ingBottle.current.style.transform = `rotate(${c.rot}deg) translateY(${i % 2 ? -10 : 10}px)`;
      symBox.classList.add('swap');
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => { setSymbol({ sym: c.sym, label: c.label }); symBox.classList.remove('swap'); }, 180);
    };
    // The active card is the last one whose top has crossed the middle of the screen.
    const pickCard = () => {
      const mid = innerHeight * 0.55;
      let idx = 0;
      cards.forEach((c, j) => { if (c.getBoundingClientRect().top < mid) idx = j; });
      setActive(idx);
    };
    let ticking = false;
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { pickCard(); ticking = false; }); } };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', pickCard);
    pickCard();
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', pickCard); clearTimeout(swapTimer); };
  }, []);

  /* ---------- shop: size toggle pill ---------- */
  const placePill = useCallback(() => {
    const b = refs.toggle.current?.querySelector(`button[data-size="${size}"]`);
    if (!b) return;
    refs.pill.current.style.width = b.offsetWidth + 'px';
    refs.pill.current.style.transform = `translateX(${b.offsetLeft - 5}px)`;
  }, [size]);
  useLayoutEffect(() => {
    placePill();
    addEventListener('resize', placePill);
    document.fonts && document.fonts.ready.then(placePill);
    return () => removeEventListener('resize', placePill);
  }, [placePill]);

  /* ---------- cart ---------- */
  // Drop anything that is no longer sold.
  const cleanCart = useMemo(() => {
    const out = {};
    for (const [k, q] of Object.entries(cart)) if (products[k] && products[k].active !== false && q > 0) out[k] = q;
    return out;
  }, [cart, products]);
  const cartKey = cartKeyFor(customer);
  const updateCart = (next) => { setCart(next); saveCart(next, cartKey); };
  // Signing in or out switches to that person's cart. Items a visitor added before signing in are carried into their cart;
  // after signing out the cart starts empty and never mixes with the previous customer's items.
  const prevCartKey = useRef(cartKey);
  useEffect(() => {
    const prev = prevCartKey.current;
    if (prev === cartKey) return;
    prevCartKey.current = cartKey;
    let next = loadCart(cartKey);
    if (prev === GUEST_CART) {
      const guest = loadCart(GUEST_CART);
      if (Object.keys(guest).length) {
        next = { ...next };
        for (const [sku, q] of Object.entries(guest)) next[sku] = (next[sku] || 0) + q;
        saveCart(next, cartKey); saveCart({}, GUEST_CART);
      }
    }
    setCart(next);
  }, [cartKey]);

  const bottlesInCart = (ml, c = cleanCart) => Object.entries(c).reduce((n, [k, q]) => n + (products[k] && sizeOf(k) === ml ? products[k].unit * q : 0), 0);
  const canAdd = (sku, extra = 1) => bottlesInCart(sizeOf(sku)) + products[sku].unit * extra <= live.available[sizeOf(sku)];
  const stockMsg = (sku) => {
    const left = Math.max(0, live.available[sizeOf(sku)] - bottlesInCart(sizeOf(sku)));
    return left > 0 ? `Only ${left} more ${sizeOf(sku) === 2000 ? '2 L' : '500 mL'} bottle${left === 1 ? '' : 's'} available right now.` : 'That size is out of stock right now.';
  };
  const totals = useMemo(() => {
    let sub = 0, was = 0;
    for (const [k, q] of Object.entries(cleanCart)) if (products[k]) { sub += products[k].price * q; was += products[k].was * q; }
    return { sub, was };
  }, [cleanCart, products]);
  const count = Object.values(cleanCart).reduce((n, q) => n + q, 0);

  const pingCart = () => {
    const c = refs.cartCount.current, b = refs.cartBtn.current;
    c?.classList.add('bump'); setTimeout(() => c?.classList.remove('bump'), 260);
    if (b) { b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); setTimeout(() => b.classList.remove('ping'), 650); }
  };
  /** A copy of the product image flies from the card into the cart button. */
  const flyToCart = (from) => {
    const target = refs.cartBtn.current;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || !target || reduce || !from.animate) { pingCart(); return; }
    const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width || !b.width) { pingCart(); return; }
    const fly = from.cloneNode(false);
    fly.removeAttribute('class');
    fly.className = 'fly-img';
    Object.assign(fly.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
    document.body.appendChild(fly);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    // The arc rises above the header's bottom edge but never leaves the screen, then drops into the cart button.
    const apexY = Math.max(12, Math.min(a.top, b.top) - 60) - a.top;
    const move = fly.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px,${apexY}px) scale(.62) rotate(-10deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px,${dy}px) scale(.1) rotate(12deg)`, opacity: 0.55 },
    ], { duration: 900, easing: 'cubic-bezier(.4,0,.3,1)' });
    move.onfinish = () => { fly.remove(); pingCart(); };
    move.oncancel = () => fly.remove();
  };
  const addedTimer = useRef();
  const add = (sku, ev) => {
    if (!canAdd(sku)) return toast(stockMsg(sku));
    updateCart({ ...cleanCart, [sku]: (cleanCart[sku] || 0) + 1 });
    flyToCart(ev?.currentTarget?.closest('.plan')?.querySelector('.plan-visual img'));
    setJustAdded(sku); clearTimeout(addedTimer.current); addedTimer.current = setTimeout(() => setJustAdded(''), 1400);
    toast(`Added ${products[sku].name} to your cart`);
  };
  const inc = (sku) => { if (!canAdd(sku)) return toast(stockMsg(sku)); updateCart({ ...cleanCart, [sku]: cleanCart[sku] + 1 }); };
  const dec = (sku) => { const next = { ...cleanCart, [sku]: cleanCart[sku] - 1 }; if (next[sku] <= 0) delete next[sku]; updateCart(next); };
  const rm = (sku) => { const next = { ...cleanCart }; delete next[sku]; updateCart(next); };

  /* ---------- drawer views: cart → checkout → done ---------- */
  const openCart = () => { setView('cart'); setCartOpen(true); };
  const closeCart = useCallback(() => setCartOpen(false), []);
  useEffect(() => {
    document.body.classList.toggle('cart-open', cartOpen);
    if (cartOpen) refs.closeCart.current.focus();
  }, [cartOpen]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeCart();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [closeCart]);

  const deliveryFee = (sub) => {
    const c = live.checkout; if (!c) return 0;
    return c.free_over > 0 && sub >= c.free_over ? 0 : (c.delivery_fee || 0);
  };
  const del = deliveryFee(totals.sub);
  const method = (live.checkout?.methods || []).find((x) => x.id === payMethod);
  const emailNeeded = Boolean(method && method.needsEmail);
  const areas = live.checkout?.areas || [];

  /* ---------- customer account ---------- */
  useEffect(() => {
    // Ask the server who is signed in. A failed request (server restarting, network blip) must never sign the user out: retry, and keep what we know.
    let alive = true;
    (async () => {
      for (let i = 0; i < 5 && alive; i++) {
        try { const d = await accountCall('me'); if (alive) { setCustomer(d.customer); setStaff(d.staff || null); } return; }
        catch (e) { await sleep(700 * (i + 1)); }
      }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    try { if (customer) localStorage.setItem('sw-me', JSON.stringify(customer)); else localStorage.removeItem('sw-me'); } catch (e) { /* private mode */ }
  }, [customer]);
  const openAuth = (mode = 'login') => { setAuthMode(mode); setAuthErr(''); setShowPw(false); setShowPw2(false); setAuthOpen(true); };
  const submitAuth = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries());
    if (authMode === 'register' && body.password !== body.password2) { setAuthErr('The two passwords do not match.'); return; }
    if (authMode === 'register' && !/^(\+?88)?01[3-9]\d{8}$/.test((body.phone || '').replace(/[\s-]/g, ''))) { setAuthErr('Enter a valid mobile number, for example 01712345678.'); return; }
    delete body.password2;
    const remember = body.remember === 'on'; delete body.remember;
    setAuthBusy(true); setAuthErr('');
    try {
      const d = await accountCall(authMode, body);
      if (d.staff) { location.href = d.redirect || '/admin'; return; }
      try { if (authMode === 'login' && remember) localStorage.setItem('sw-remember-email', body.identifier || body.email); else localStorage.removeItem('sw-remember-email'); } catch (e) { /* ignore */ }
      setCustomer(d.customer); setAuthOpen(false);
      // Signing in or registering in the middle of checkout: keep what was typed and fill in the rest from the account.
      const c = d.customer;
      setDetails((x) => ({ ...x, name: x.name || c.name || '', phone: x.phone || c.phone || '', address: x.address || c.address || '', city: x.city || c.city || '', email: x.email || c.email || '' }));
      toast(authMode === 'register' ? `Welcome, ${d.customer.name}!` : `Welcome back, ${d.customer.name}!`);
    } catch (err) { setAuthErr(err.message); } finally { setAuthBusy(false); }
  };
  const signOut = async () => {
    try { await accountCall('logout', {}); } catch (e) { /* ignore */ }
    setCustomer(null); setAcctTab(null); toast('Signed out.');
    // Nothing from the signed-out customer should be left for the next person using this browser.
    setDetails(EMPTY_DETAILS); setView('cart'); setCartOpen(false);
    try { localStorage.removeItem('sw-customer'); } catch (e) { /* ignore */ }
  };
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e) => e.key === 'Escape' && setAuthOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [authOpen]);

  const go = (v) => { setCoErr(''); setView(v); setTimeout(() => document.querySelector('#drawer .co:not([hidden])')?.scrollTo({ top: 0 }), 30); };
  const startCheckout = async () => {
    if (checkingOut) return;
    if (!skus.length) return toast('Your cart is empty.');
    let l = live;
    if (!l.ok || !l.checkout || !l.checkout.methods.length) {
      // The shop data may not have arrived yet (slow network or server just started): try once more before giving up.
      setCheckingOut(true);
      const ok = await loadLive();
      setCheckingOut(false);
      if (!ok) return toast("Online ordering isn't available right now. Please try again shortly.");
      l = liveRef.current;
      if (!l.checkout || !l.checkout.methods.length) return toast('No payment method is available right now. Please try again shortly.');
    }
    // Stock can change while the cart is open.
    for (const ml of [500, 2000]) {
      if (bottlesInCart(ml) > l.available[ml]) return toast(`Only ${l.available[ml]} × ${ml === 2000 ? '2 L' : '500 mL'} bottle${l.available[ml] === 1 ? '' : 's'} available right now. Please reduce the quantity.`);
    }
    setPayMethod((cur) => (l.checkout.methods.some((m) => m.id === cur) ? cur : l.checkout.methods[0].id));
    try {
      const saved = { ...JSON.parse(localStorage.getItem('sw-customer') || '{}'), ...(customer ? { name: customer.name, phone: customer.phone, address: customer.address, city: customer.city, email: customer.email } : {}) };
      setDetails((d) => ({ ...d, name: d.name || saved.name || '', phone: d.phone || saved.phone || '', address: d.address || saved.address || '', city: d.city || saved.city || '', email: d.email || saved.email || '' }));
    } catch (e) { /* ignore */ }
    go('checkout');
    setTimeout(() => { refs.form.current?.scrollTo({ top: 0 }); refs.coName.current?.focus(); }, 60);
  };

  /* ---------- content, prices and stock from Admin ---------- */
  const loadLive = useCallback(async () => {
    try {
      const r = await fetch('/api/site?action=content', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      setProducts((prev) => {
        const next = structuredClone(prev);
        for (const p of d.products) {
          if (!next[p.sku]) continue;
          Object.assign(next[p.sku], { name: p.name, price: p.price, was: p.was, active: p.active, unit: p.bottles });
        }
        return next;
      });
      const next = { ok: true, available: { 500: Number(d.available['500'] ?? 0), 2000: Number(d.available['2000'] ?? 0) }, checkout: d.checkout };
      liveRef.current = next;
      setLive(next);
      setContent(d.content || {});
      return true;
    } catch (e) {
      // No server (for example the page opened as a file): keep the built-in content.
      setCheckoutNote('Online ordering opens soon.');
      return false;
    }
  }, []);
  useEffect(() => { loadLive(); }, [loadLive]);

  // The announcement bar makes the fixed header taller; keep anchor links clear of it.
  useEffect(() => {
    if (announce) document.documentElement.style.scrollPaddingTop = (refs.nav.current.offsetHeight + 12) + 'px';
  }, [announce]);

  const setD = (k) => (e) => { e.target.classList?.remove('bad'); setDetails((d) => ({ ...d, [k]: e.target.value })); };
  const fail = (ref, msg) => { ref.current?.classList.add('bad'); ref.current?.focus(); setCoErr(msg); return false; };
  const checkDetails = () => {
    const d = details;
    if (!d.name.trim()) return fail(refs.coName, 'Enter your name.');
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(d.phone.replace(/[\s-]/g, ''))) return fail(refs.coPhone, 'Enter a valid mobile number, for example 01712345678.');
    if (d.address.trim().length < 5) return fail(refs.coAddress, 'Enter your delivery address.');
    if (!d.city.trim()) return fail(areas.length ? refs.coCitySelect : refs.coCity, areas.length ? 'Choose your delivery area.' : 'Enter your area or city.');
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return fail(refs.coEmail, 'Enter a valid email address, or leave it empty.');
    return true;
  };
  const goPayment = (e) => {
    e?.preventDefault();
    if (!checkDetails()) return;
    try { localStorage.setItem('sw-customer', JSON.stringify({ name: details.name, phone: details.phone, address: details.address, city: details.city, email: details.email })); } catch (x) { /* ignore */ }
    go('payment');
  };
  const goReview = () => {
    if (!payMethod || !(live.checkout?.methods || []).some((m) => m.id === payMethod)) return setCoErr('Choose a payment method.');
    if (emailNeeded && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) return fail(refs.coPayEmail, 'Enter your email address for the payment receipt.');
    go('review');
  };

  const placeOrder = async () => {
    if (placing) return;
    const d = details;
    const data = {
      name: d.name, phone: d.phone, address: d.address, city: d.city, email: d.email, note: d.note,
      payment_method: payMethod,
      items: Object.entries(cleanCart).map(([sku, qty]) => ({ sku, qty })),
    };
    setPlacing(true); setCoErr(''); setAnimStep(0); setAnim('working');
    const started = Date.now();
    const ticker = setInterval(() => setAnimStep((n) => Math.min(n + 1, WORKING_STEPS.length - 1)), 750);
    try {
      const r = await fetch('/api/site?action=order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || 'Your order could not be placed. Please try again.');
      await sleep(Math.max(0, 2300 - (Date.now() - started))); // let the animation finish
      updateCart({}); loadLive();
      if (out.redirectUrl) { setAnim('redirect'); await sleep(1100); location.href = out.redirectUrl; return; }
      setDone({ code: `Order ${out.code}`, msg: out.message || '', link: `/order?code=${encodeURIComponent(out.code)}&token=${encodeURIComponent(out.token)}`, rawCode: out.code, token: out.token, order: null });
      // Fetch the full order in the background so the receipt opens instantly.
      fetchOrder(out.code, out.token).then((o) => setDone((d) => (d.rawCode === out.code ? { ...d, order: o } : d))).catch(() => {});
      setAnim(''); setView('done');
    } catch (err) {
      setAnim(''); setCoErr(err.message);
      if (/stock|left/i.test(err.message)) loadLive();
    } finally { clearInterval(ticker); setPlacing(false); }
  };

  const loadDoneOrder = async () => done.order || fetchOrder(done.rawCode, done.token);
  const openReceipt = async () => {
    try { setReceipt(await loadDoneOrder()); } catch (e) { toast(e.message); }
  };
  const downloadDone = async () => {
    if (dlBusy) return;
    setDlBusy(true);
    try { await downloadReceipt(await loadDoneOrder()); } catch (e) { toast('Could not create the PDF. Please try again.'); } finally { setDlBusy(false); }
  };

  const closeMenuOnLink = (e) => { if (e.target.tagName === 'A') setMenuOpen(false); };
  const skus = Object.keys(cleanCart);

  return (<>
    {/* Shared vector of the Aquanimity Q (traced from the brand mark) */}
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00B4D3" /><stop offset="1" stopColor="#B3E1F2" />
        </linearGradient>
        <symbol id="q" viewBox="0 0 600 488"><path fillRule="evenodd" d={Q_PATH} /></symbol>
      </defs>
    </svg>

    {/* ===== Preloader ===== */}
    <div id="loader" ref={refs.loader} aria-hidden="true">
      <div className="loader-stack">
        <svg viewBox="0 0 600 488">
          <defs><clipPath id="qClip"><path d={Q_PATH} /></clipPath></defs>
          <use href="#q" fill="rgba(179,225,242,.18)" />
          <g clipPath="url(#qClip)"><rect className="fill" width="600" height="488" fill="url(#qGrad)" /></g>
        </svg>
        <div className="loader-logos">
          <div className="sw"><img src="/assets/sw-en-v2.png" alt="Super Water" width="769" height="337" /></div>
          <i className="loader-div"></i>
          <div className="sw sw-bn" lang="bn"><img src="/assets/sw-bn.png" alt="সুপার ওয়াটার" width="1004" height="492" /></div>
        </div>
      </div>
    </div>

    {/* ===== Navbar ===== */}
    <header className={`nav${scrolled ? ' scrolled' : ''}`} id="nav" ref={refs.nav}>
      <div className="announce" id="announce" ref={refs.announce} hidden={!announce}>{announce}</div>
      <div className="wrap nav-in">
        <div className="brand"><a href="https://aquanimitygroup.com" aria-label="Aquanimity (aquanimitygroup.com)"><img className="aq" src="/public/assets/aquanimity.png" alt="Aquanimity" /></a><a className="sw" href="#top" aria-label="Super Water — back to top"><img src="/assets/sw-en-v2.png" alt="" width="769" height="337" /></a></div>
        <ul className={`nav-links${menuOpen ? ' open' : ''}`} id="navLinks" ref={refs.navLinks} onClick={closeMenuOnLink}>
          <li><a href="#ingredients">Ingredients</a></li>
          <li><a href="#science">Science</a></li>
          <li><a href="#shop">Shop</a></li>
        </ul>
        <div className="nav-right">
          {customer
            ? <AccountMenu customer={customer} onOpen={setAcctTab} onSignOut={signOut} />
            : staff
              ? <span className="acct"><a className="acct-btn primary" href="/admin" title={staff.email}>Admin panel</a></span>
              : <span className="acct"><button type="button" className="acct-btn primary" onClick={() => openAuth('login')}>Login</button></span>}
          <button className="cart-btn" id="cartBtn" ref={refs.cartBtn} aria-label="Open cart" onClick={openCart}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
            <span className="cart-label">Cart</span>
            <span className="cart-count" id="cartCount" ref={refs.cartCount} aria-live="polite">{count}</span>
          </button>
          <button className="menu-btn" id="menuBtn" aria-label="Menu" aria-expanded={menuOpen} aria-controls="navLinks" onClick={() => setMenuOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 8h16M4 16h16" /></svg>
          </button>
        </div>
      </div>
    </header>

    <main id="top">

      {/* ===== Hero ===== */}
      <section className="hero" aria-labelledby="heroTitle">
        <svg className="hero-q" viewBox="0 0 600 488" aria-hidden="true"><path d={Q_PATH} /></svg>
        <div className="hero-bigtype" aria-hidden="true">SUPER WATER</div>
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <div className="eyebrow rv">{t('hero.eyebrow')}</div>
            <h1 id="heroTitle" className="rv d1 hero-title"><span className="sw hero-sw"><img src="/assets/sw-en-v2.png" alt="" width="769" height="337" /></span><span className="sw hero-sw hero-bn" lang="bn"><img src="/assets/sw-bn.png" alt="" width="1004" height="492" /></span><span className="sr-only">Super Water · সুপার ওয়াটার</span></h1>
            <p className="tagline rv d1"><span>{t('hero.tagline1')}</span> <em>{t('hero.tagline2')}</em></p>
            <p className="lede rv d2">{t('hero.lede')}</p>
            <div className="hero-ctas rv d3">
              <a className="btn btn-primary" href="#shop"><span>{t('hero.cta_shop')}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
              <a className="btn btn-ghost" href="#science">{t('hero.cta_science')}</a>
            </div>
            <div className="price-chip rv d3" id="saleChip" hidden={!showSale}><b>{t('hero.sale_badge')}</b> <span>{t('hero.sale_text')}</span> <s>{t('hero.sale_was')}</s></div>
          </div>

          <div className="hero-bottle">
            <div className="halo"></div>
            <img id="heroBottle" ref={refs.heroBottle} src="/assets/bottle-clear-v2.webp" alt="A 500 mL bottle of Super Water" />
            <div className="shadow"></div>
          </div>

          <ul className="hero-facts">
            <li className="rv d1"><strong>{t('hero.fact1_value')}</strong><span>{t('hero.fact1_label')}</span></li>
            <li className="rv d2"><strong className="word">{t('hero.fact2_value')}</strong><span>{t('hero.fact2_label')}</span></li>
          </ul>
        </div>
        <div className="scroll-cue" aria-hidden="true">Scroll<i></i></div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track" id="marqueeTrack">
          {[...marquee, ...marquee].map((m, i) => <span key={i}>{m}</span>)}
        </div>
      </div>

      {/* ===== Ingredients ===== */}
      <section className="ingredients" id="ingredients" aria-labelledby="ingTitle">
        <div className="wrap">
          <div className="ing-head">
            <div>
              <div className="eyebrow rv">{t('ing.eyebrow')}</div>
              <h2 className="h2 rv d1" id="ingTitle" style={{ marginTop: 14 }}><span>{t('ing.title1')}</span> <em>{t('ing.title2')}</em></h2>
            </div>
            <p className="lede rv d2">{t('ing.lede')}</p>
          </div>

          <div className="ing-grid">
            <div className="ing-stage" aria-hidden="true">
              <div className="ing-ring"></div>
              <div className="ing-symbol" ref={refs.symBox}><b id="ingSym" className={symbol.sym.length > 7 ? 'long' : undefined}>{symbol.sym}</b><small id="ingSymLabel">{symbol.label}</small></div>
              <img id="ingBottle" ref={refs.ingBottle} src="/assets/bottle-clear-v2.webp" alt="" />
              <div className="ing-dots" ref={refs.dots}><i className="on"></i><i></i><i></i><i></i></div>
            </div>

            <div className="ing-list" ref={refs.ingList}>
              {INGREDIENTS.map((ing, i) => (
                <article key={ing.n} className={`ing-card rv${i === 0 ? ' active' : ''}`}>
                  <div className="ing-num">{`0${ing.n} / 04`}</div>
                  <h3>{t(`ing.c${ing.n}.title`)}</h3>
                  <span className="benefit">{ING_ICONS[i]}<span>{t(`ing.c${ing.n}.pill`)}</span></span>
                  <p>{t(`ing.c${ing.n}.text`)}</p>
                  <div className="bn" lang="bn">{t(`ing.c${ing.n}.bn`)}</div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Science ===== */}
      <section className="science" id="science" aria-labelledby="sciTitle">
        <div className="wrap">
          <div className="sci-head">
            <div>
              <div className="eyebrow rv">{t('sci.eyebrow')}</div>
              <h2 className="h2 rv d1" id="sciTitle" style={{ marginTop: 14 }}>{t('sci.title')}</h2>
            </div>
            <p className="lede rv d2">{t('sci.lede')}</p>
          </div>

          <div className="collab">
            <article className="collab-card rv">
              <div className="logo-tile"><img src="/assets/logo-buet.svg" alt="BUET logo" /></div>
              <div><div className="role">{t('sci.c1.role')}</div>
                <h3>{t('sci.c1.title')}</h3>
                <p>{t('sci.c1.text')}</p></div>
            </article>
            <article className="collab-card rv d1">
              <div className="logo-tile duo"><img src="/assets/logo-cghr.svg" alt="CGHR logo" /><img src="/assets/logo-badas.png" alt="Diabetic Association of Bangladesh logo" /></div>
              <div><div className="role">{t('sci.c2.role')}</div>
                <h3>{t('sci.c2.title')}</h3>
                <p>{t('sci.c2.text')}</p></div>
            </article>
          </div>
          <p className="also rv">{t('sci.also')}</p>

          <div className="pipeline" id="pipeline" ref={refs.pipeline}>
            <div className="bar"></div>
            {[1, 2, 3].map((n) => (
              <div key={n} className={`step done rv${n > 1 ? ` d${n - 1}` : ''}`}><div className="dot">✓</div><h3>{t(`sci.s${n}.title`)}</h3><p>{t(`sci.s${n}.text`)}</p><span className="tag">{t(`sci.s${n}.tag`)}</span></div>
            ))}
          </div>

          {/* Preclinical: kept short on purpose */}
          <article className="preclin rv">
            <div>
              <div className="eyebrow">{t('pre.eyebrow')}</div>
              <h3>{t('pre.title')}</h3>
              <p>{t('pre.text')}</p>
            </div>
            <ul className="preclin-stats">
              <li><b>{t('pre.stat1.value')}</b><span>{t('pre.stat1.label')}</span></li>
              <li><b>{t('pre.stat2.value')}</b><span>{t('pre.stat2.label')}</span></li>
            </ul>
          </article>

          {/* Clinical trial */}
          <article className="trial rv">
            <div className="trial-top">
              <div className="trial-meta"><div className="eyebrow">{t('trial.eyebrow')}</div><span className="review-badge">{t('trial.badge')}</span></div>
              <h3>{t('trial.title')}</h3>
            </div>
            <div className="trial-grid">
              <div className="trial-hero">
                <div className="big"><b>{t('trial.big')}</b><span><span>{t('trial.unit')}</span><br /><strong>{t('trial.vs')}</strong></span></div>
                <p className="big-label"><span>{t('trial.big_label')}</span> <span className="pct">{t('trial.pct')}</span></p>
                <p className="fine">{t('trial.fine')}</p>
                <ul className="trial-stats">
                  {[1, 2, 3].map((n) => (
                    <li key={n}><b>{t(`trial.st${n}.value`)}</b><span>{t(`trial.st${n}.label`)}</span><small>{t(`trial.st${n}.small`)}</small></li>
                  ))}
                </ul>
              </div>
              <figure className="chart">
                <figcaption><b>{t('trial.chart_title')}</b><span>{t('trial.chart_sub')}</span></figcaption>
                <div className="legend"><span><i className="sw-line"></i>Super Water</span><span><i className="ctl-line"></i>Standard water</span></div>
                <svg viewBox="0 0 430 230" role="img" aria-label="Post-meal glucose fell from 14.47 to 10.61 mmol/L with Super Water, and from 14.49 to 13.85 mmol/L with standard water.">
                  <g className="grid">
                    <line x1="40" x2="400" y1="20" y2="20" /><line x1="40" x2="400" y1="70" y2="70" /><line x1="40" x2="400" y1="120" y2="120" /><line x1="40" x2="400" y1="170" y2="170" />
                  </g>
                  <g className="ylab"><text x="30" y="24">16</text><text x="30" y="74">14</text><text x="30" y="124">12</text><text x="30" y="174">10</text></g>
                  <line className="ctl" x1="70" y1="57.75" x2="370" y2="73.75" />
                  <line className="swl" pathLength="1" x1="70" y1="58.25" x2="370" y2="154.75" />
                  <circle className="ctl-dot" cx="70" cy="57.75" r="5" /><circle className="ctl-dot" cx="370" cy="73.75" r="5" />
                  <circle className="sw-dot" cx="70" cy="58.25" r="5.5" /><circle className="sw-dot" cx="370" cy="154.75" r="5.5" />
                  <text className="val ctl-t" x="380" y="78">13.85</text>
                  <text className="val sw-t" x="380" y="159">10.61</text>
                  <text className="val base" x="70" y="42" textAnchor="middle">14.5</text>
                  <g className="xlab"><text x="70" y="215" textAnchor="middle">Baseline</text><text x="370" y="215" textAnchor="middle">Week 12</text></g>
                </svg>
                <p className="fine">{t('trial.chart_fine')}</p>
              </figure>
            </div>
            <div className="more">
              <h4>{t('more.title')}</h4>
              <ul className="more-grid">
                {[1, 2, 3, 4, 5].map((n) => (
                  <li key={n}><b><span>{t(`more.${n}.value`)}</span><span className="u">{t(`more.${n}.unit`)}</span></b><p>{t(`more.${n}.label`)}</p><small>{t(`more.${n}.small`)}</small></li>
                ))}
              </ul>
            </div>
          </article>

          <div className="context">
            <h4>{t('ctx.title')}</h4>
            <p>{t('ctx.text')}</p>
            <p className="src">Bhowmik B. et al., <i>Effect of Multi-Mineral Drinking Water on Postprandial Glycaemia in Adults with Type 2 Diabetes and Hypertension in Bangladesh: A Randomised Controlled Trial</i>. Trial registration <a href="https://www.isrctn.com/ISRCTN13257145" target="_blank" rel="noopener">ISRCTN13257145</a> · Ethics approval BADAS-ERC/EC/25/62.</p>
          </div>

          <p className="disclaimer">{t('disclaimer')}</p>
        </div>
      </section>

      {/* ===== Shop ===== */}
      <section className="shop" id="shop" aria-labelledby="shopTitle">
        <div className="wrap">
          <div className="shop-head">
            <div className="eyebrow rv">{t('shop.eyebrow')}</div>
            <h2 className="h2 rv d1" id="shopTitle" style={{ marginTop: 14 }}>{t('shop.title')}</h2>
            <p className="lede rv d2">{t('shop.lede')}</p>
            <div className="toggle rv d3" role="group" aria-label="Bottle size" ref={refs.toggle}>
              <span className="pill" id="pill" ref={refs.pill}></span>
              <button type="button" data-size="500" aria-pressed={size === '500'} onClick={() => setSize('500')}>500 mL</button>
              <button type="button" data-size="2000" aria-pressed={size === '2000'} onClick={() => setSize('2000')}>2 L</button>
            </div>
          </div>

          <div className="plans" id="plans">
            {PLANS[size].filter((pl) => products[pl.sku] && products[pl.sku].active !== false).map((pl) => {
              const p = products[pl.sku];
              const soldOut = p.unit > live.available[sizeOf(pl.sku)];
              const saving = p.was > p.price;
              const badge = plan(pl.sku, 'badge');
              const bullets = [plan(pl.sku, 'bullet1'), plan(pl.sku, 'bullet2')].filter(Boolean);
              return (
                <article key={pl.sku} className={`plan${pl.best ? ' best' : ''}${soldOut ? ' soldout' : ''}`} data-sku={pl.sku}>
                  {badge ? <span className={`badge${pl.soft ? ' soft' : ''}`}>{badge}</span> : null}
                  <div className={`plan-visual${size === '2000' ? ' two-l' : ''}`}><span className="size-tag">{p.size}</span>{pl.x ? <span className="x">{pl.x}</span> : null}
                    <div className="stack">{Array.from({ length: pl.show }, (_, i) => <img key={i} src="/assets/bottle-clear-v2.webp" alt="" />)}</div></div>
                  <h3>{plan(pl.sku, 'title')}</h3>
                  <p className="sub">{plan(pl.sku, 'sub')}</p>
                  <div className="price"><span className="now"><small>Tk</small>{p.price.toLocaleString('en-IN')}</span>{saving ? <><s>{tk(p.was)}</s><span className="save">Save {tk(p.was - p.price)}</span></> : null}</div>
                  <div className="per">{p.unit > 1 ? `${tk(+(p.price / p.unit).toFixed(2))} per bottle` : saving ? `Regular price ${tk(p.was)}` : ' '}</div>
                  <ul>{bullets.map((b, i) => <li key={i}><Tick />{b}</li>)}</ul>
                  <button className={`btn btn-primary${justAdded === pl.sku ? ' added' : ''}`} data-add="" disabled={soldOut} onClick={(e) => !soldOut && add(pl.sku, e)}>
                    {soldOut ? 'Out of stock' : justAdded === pl.sku
                      ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>Added to cart</>
                      : plan(pl.sku, 'button')}
                  </button>
                </article>
              );
            })}
          </div>

          <div className="shop-trust">
            <span><ShieldIcon w="2.2" /><span>{t('shop.trust1')}</span></span>
            <span><DropIcon w="2.2" /><span>{t('shop.trust2')}</span></span>
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg><span>{t('shop.trust3')}</span></span>
          </div>
        </div>
      </section>

    </main>

    {/* ===== Footer ===== */}
    <footer className="footer">
      <div className="footer-hero">
        <div className="wrap">
          <h2 className="h2 rv"><span>{t('footer.headline1')}</span> <span style={{ whiteSpace: 'nowrap' }}>{t('footer.headline2')}</span></h2>
        </div>
      </div>
      <div className="wrap footer-bottom">
        <div className="brand"><a href="https://aquanimitygroup.com" aria-label="Aquanimity (aquanimitygroup.com)"><img className="aq" src="/assets/aquanimity-white.svg" alt="Aquanimity" /></a><a className="sw" href="#top" aria-label="Super Water — back to top"><img src="/assets/sw-en-v2.png" alt="" width="769" height="337" /></a></div>
        <nav aria-label="Footer"><a href="#ingredients">Ingredients</a><a href="#science">Science</a><a href="#shop">Shop</a></nav>
        <span>{t('footer.copyright')}</span>
      </div>
    </footer>

    {/* ===== Cart drawer ===== */}
    <div className="scrim" id="scrim" onClick={closeCart}></div>
    <aside className="drawer" id="drawer" aria-label="Shopping cart" aria-hidden={!cartOpen}>
      <header><h2>{{ checkout: 'Delivery details', payment: 'Payment', review: 'Review order', done: 'Thank you' }[view] || 'Your cart'}</h2>
        <button className="icon-btn" id="closeCart" ref={refs.closeCart} aria-label="Close cart" onClick={closeCart}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </header>
      <div className="cart-items" id="cartItems" hidden={view !== 'cart'}>
        {!skus.length
          ? <div className="cart-empty"><svg viewBox="0 0 600 488"><use href="#q" fill="currentColor" /></svg><p>Your cart is empty.</p></div>
          : skus.map((k) => {
            const p = products[k], q = cleanCart[k];
            return (
              <div className="line" key={k}>
                <div className="thumb"><img src="/assets/bottle-clear-v2.webp" alt="" /></div>
                <div><h4>{p.name}</h4><div className="lp">{tk(p.price)} {p.was > p.price ? <s>{tk(p.was)}</s> : null}</div>
                  <div className="qty"><button aria-label="Decrease" onClick={() => dec(k)}>−</button><span>{q}</span><button aria-label="Increase" onClick={() => inc(k)}>+</button></div></div>
                <div><div className="lt">{tk(p.price * q)}</div><button className="rm" onClick={() => rm(k)}>Remove</button></div>
              </div>
            );
          })}
      </div>

      {['checkout', 'payment', 'review'].includes(view) ? (
        <ol className="co-steps" aria-label="Checkout progress">
          {['Details', 'Payment', 'Review'].map((l, i) => {
            const cur = { checkout: 0, payment: 1, review: 2 }[view];
            return <li key={l} className={i < cur ? 'done' : i === cur ? 'on' : ''}><span>{i < cur ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> : i + 1}</span>{l}</li>;
          })}
        </ol>
      ) : null}

      {/* step 1: delivery details */}
      <form className="co" id="checkoutForm" ref={refs.form} hidden={view !== 'checkout'} noValidate onSubmit={goPayment}>
        <button type="button" className="co-back" id="backToCart" onClick={() => go('cart')}>← Back to cart</button>
        <h3>Delivery details</h3>
        {!customer ? (
          <div className="co-note" role="note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></svg>
            <p>Without an account you can't track this order. <button type="button" onClick={() => openAuth('register')}>Register</button> to track it. Your cart stays as it is.</p>
          </div>
        ) : null}
        <label htmlFor="coName">Full name</label>
        <input id="coName" ref={refs.coName} name="name" autoComplete="name" required maxLength={80} value={details.name} onChange={setD('name')} />
        <label htmlFor="coPhone">Mobile number</label>
        <input id="coPhone" ref={refs.coPhone} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required maxLength={20} value={details.phone} onChange={setD('phone')} />
        <label htmlFor="coAddress">Delivery address</label>
        <textarea id="coAddress" ref={refs.coAddress} name="address" rows={2} autoComplete="street-address" required maxLength={300} placeholder="House, road, area" value={details.address} onChange={setD('address')}></textarea>
        <label htmlFor="coCity">Area or city</label>
        <input id="coCity" ref={refs.coCity} name="city" autoComplete="address-level2" required maxLength={60} hidden={areas.length > 0} value={details.city} onChange={setD('city')} />
        <select id="coCitySelect" ref={refs.coCitySelect} aria-label="Area or city" hidden={!areas.length} value={details.city} onChange={setD('city')}>
          <option value="">Choose your area</option>
          {areas.map((a) => <option key={a}>{a}</option>)}
        </select>
        <label htmlFor="coEmail">Email <span className="opt" id="coEmailOpt">(optional, we email your order updates here)</span></label>
        <input id="coEmail" ref={refs.coEmail} name="email" type="email" autoComplete="email" maxLength={120} value={details.email} onChange={setD('email')} />
        <label htmlFor="coNote">Note for delivery <span className="opt">(optional)</span></label>
        <input id="coNote" ref={refs.coNote} name="note" maxLength={300} value={details.note} onChange={setD('note')} />
        <p className="co-err" id="coErr" role="alert">{view === 'checkout' ? coErr : ''}</p>
        <button className="btn btn-primary" type="submit">Continue to payment<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
      </form>

      {/* step 2: payment method */}
      <div className="co" hidden={view !== 'payment'}>
        <button type="button" className="co-back" onClick={() => go('checkout')}>← Back to details</button>
        <h3>Choose a payment method</h3>
        <p className="co-sub">Pay online or in cash. Your card and wallet details are never shared with us.</p>
        <div className="pay-list" role="radiogroup" aria-label="Payment method">
          {[...PAY_METHODS, ...(live.checkout?.methods || []).filter((m) => !PAY_METHODS.some((p) => p.id === m.id)).map((m) => ({ id: m.id, name: m.label, desc: 'Pay online', mark: <span>{m.label[0]}</span> }))].map((m) => {
            const ok = (live.checkout?.methods || []).some((x) => x.id === m.id), sel = payMethod === m.id && ok;
            return (
              <label key={m.id} className={`pay-opt${sel ? ' on' : ''}${ok ? '' : ' off'}`}>
                <input type="radio" name="pay" value={m.id} checked={sel} disabled={!ok} onChange={() => { setPayMethod(m.id); setCoErr(''); }} />
                <span className={`pay-mark ${m.id}`}>{m.mark}</span>
                <span className="pay-txt"><strong>{m.name}</strong><small>{ok ? m.desc : 'Not available right now'}</small></span>
                <span className="pay-radio" aria-hidden="true"></span>
              </label>
            );
          })}
        </div>
        {emailNeeded ? (
          <div className="pay-email">
            <label htmlFor="coPayEmail">Email for your payment receipt</label>
            <input id="coPayEmail" ref={refs.coPayEmail} type="email" autoComplete="email" maxLength={120} value={details.email} onChange={setD('email')} placeholder="you@example.com" />
          </div>
        ) : null}
        <div className="co-secure"><Lock />Secure checkout. Payments are processed by the gateway you choose.</div>
        <p className="co-err" role="alert">{view === 'payment' ? coErr : ''}</p>
        <button className="btn btn-primary" type="button" onClick={goReview} disabled={!payMethod}>Review order<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
      </div>

      {/* step 3: preview and confirm */}
      <div className="co" hidden={view !== 'review'}>
        <button type="button" className="co-back" onClick={() => go('payment')}>← Back to payment</button>
        <h3>Review your order</h3>
        <p className="co-sub">Check everything below. Nothing is ordered until you confirm.</p>
        <section className="rv-card">
          <header><strong>Delivery</strong><button type="button" onClick={() => go('checkout')}>Edit</button></header>
          <p><b>{details.name}</b> · {details.phone}</p>
          <p>{details.address}, {details.city}</p>
          {details.email ? <p className="rv-dim">{details.email}</p> : null}
          {details.note ? <p className="rv-dim">Note: {details.note}</p> : null}
        </section>
        <section className="rv-card">
          <header><strong>Payment</strong><button type="button" onClick={() => go('payment')}>Change</button></header>
          {(() => { const m = PAY_METHODS.find((x) => x.id === payMethod); return (
            <div className="rv-pay"><span className={`pay-mark sm ${payMethod}`}>{m ? m.mark : <span>{(method?.label || '?')[0]}</span>}</span>
              <span><b>{m ? m.name : method?.label}</b><small>{payMethod === 'cod' ? 'Pay in cash on delivery' : 'You will be taken to a secure page to pay'}</small></span></div>
          ); })()}
        </section>
        <section className="rv-card">
          <header><strong>Items</strong><button type="button" onClick={() => go('cart')}>Edit</button></header>
          <ul className="co-lines">
            {skus.map((k) => <li key={k}><span>{cleanCart[k]} × {products[k].name}</span><span>{tk(products[k].price * cleanCart[k])}</span></li>)}
          </ul>
        </section>
        <div className="co-sum">
          <div className="row"><span>Items</span><span id="coSub">{tk(totals.sub)}</span></div>
          <div className="row"><span>Delivery</span><span id="coDel">{del ? tk(del) : 'Free'}</span></div>
          <div className="row total"><span>Total</span><span id="coTotal">{tk(totals.sub + del)}</span></div>
        </div>
        <p className="co-err" id="coErr2" role="alert">{view === 'review' ? coErr : ''}</p>
        <button className="btn btn-primary btn-confirm" type="button" id="placeOrder" onClick={placeOrder} disabled={placing}>
          <Lock />{payMethod === 'cod' ? 'Confirm order' : `Confirm & pay ${tk(totals.sub + del)}`}
        </button>
      </div>

      {/* animated "placing your order" screen */}
      {anim ? (
        <div className="co-working" role="status" aria-live="polite">
          <div className="co-orb"><i></i><i></i><i></i><svg viewBox="0 0 600 488" aria-hidden="true"><use href="#q" fill="url(#qGrad)" /></svg></div>
          <h3>{anim === 'redirect' ? `Taking you to ${PAY_METHODS.find((x) => x.id === payMethod)?.name || 'the payment page'}…` : WORKING_STEPS[animStep]}</h3>
          <p>{anim === 'redirect' ? 'Please do not close this window.' : 'Hold on, this only takes a moment.'}</p>
          <div className="co-bar"><b className={anim === 'redirect' ? 'full' : ''}></b></div>
          <ul className="co-dots" aria-hidden="true">{WORKING_STEPS.map((x, i) => <li key={x} className={i <= animStep || anim === 'redirect' ? 'on' : ''}></li>)}</ul>
        </div>
      ) : null}

      <div className="co-done" id="orderDone" hidden={view !== 'done'}>
        {view === 'done' ? (
          <div className="ok-badge" aria-hidden="true">
            <span className="ring"></span>
            <svg viewBox="0 0 52 52"><circle className="c" cx="26" cy="26" r="23" fill="none" /><path className="t" fill="none" d="M15 27.5l7.5 7.5L37.5 19" /></svg>
            {CONFETTI.map((c, i) => <i key={i} style={{ '--x': c.x + 'px', '--y': c.y + 'px', '--c': c.c, '--d': c.d + 's' }}></i>)}
          </div>
        ) : null}
        <h3>Order confirmed!</h3>
        <p className="code" id="doneCode">{done.code}</p>
        <p id="doneMsg">{done.msg}</p>
        <button type="button" className="btn btn-ghost" id="doneLink" onClick={openReceipt}>Receipt</button>
        <button type="button" className="btn btn-ghost" onClick={downloadDone} disabled={dlBusy}><DownloadIcon />{dlBusy ? 'Preparing PDF…' : 'Download receipt'}</button>
        <button type="button" className="btn btn-primary" onClick={closeCart}>Continue shopping</button>
      </div>

      <footer id="cartFoot" hidden={view !== 'cart'} style={skus.length ? undefined : { display: 'none' }}>
        <div className="row"><span>Subtotal</span><span id="sub">{tk(totals.was)}</span></div>
        <div className="row saved" hidden={totals.was <= totals.sub}><span>You save</span><span id="saved">{'− ' + tk(totals.was - totals.sub)}</span></div>
        <div className="row total"><span>Total</span><span id="total">{tk(totals.sub)}</span></div>
        <button className="btn btn-primary" id="checkout" onClick={startCheckout} disabled={checkingOut}>{checkingOut ? 'Please wait…' : <>Checkout<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}</button>
        <small id="checkoutNote">{checkoutNote}</small>
      </footer>
    </aside>
    {/* ===== Login / Register page ===== */}
    <div className={`auth-page${authOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Login' : 'Create account'} aria-hidden={!authOpen}>
      <div className="auth-bg" aria-hidden="true">
        {authOpen ? <video className="auth-video" src="/assets/video/water.mp4" poster="/assets/water1.jpg" autoPlay muted loop playsInline preload="auto" tabIndex={-1}></video> : null}
      </div>
      <button type="button" className="auth-back" onClick={() => setAuthOpen(false)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>Back to website
      </button>
      <div className="auth-scroll">
      <div className="auth-hero">
        <span className="auth-q" aria-hidden="true"></span>
        <h2>{authMode === 'login' ? <>Welcome <b>Back!</b></> : <>Create <b>Account</b></>}</h2>
        <p>{authMode === 'login' ? 'Sign in to continue to your account' : 'Join us and get started today'}</p>
        <i className="auth-rule"></i>
      </div>
      <div className="auth-card">
        <h1>{authMode === 'login' ? 'Login' : 'Register'}</h1>
        <p className="auth-sub">{authMode === 'login' ? 'Enter your credentials to access your account' : 'Fill in the details to create your account'}</p>
        {authOpen ? (
          <form key={authMode} className="auth-form" noValidate onSubmit={submitAuth}>
            {authMode === 'register' ? (
              <div className="auth-field">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
                <input name="name" placeholder="Full Name" aria-label="Full name" autoComplete="name" required maxLength={80} />
              </div>
            ) : null}
            {authMode === 'register' ? (
              <div className="auth-field">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h3.5l1.8 4.6-2.3 1.4a11 11 0 0 0 5 5l1.4-2.3L19 14.5V18a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>
                <input name="phone" type="tel" inputMode="tel" placeholder="Mobile Number (01XXXXXXXXX)" aria-label="Mobile number" autoComplete="tel" required maxLength={20} />
              </div>
            ) : null}
            <div className="auth-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
              {authMode === 'login'
                ? <input name="identifier" type="text" defaultValue={(() => { try { return localStorage.getItem('sw-remember-email') || ''; } catch (e) { return ''; } })()} placeholder="Email or Mobile Number" aria-label="Email or mobile number" autoComplete="username" required maxLength={254} />
                : <input name="email" type="email" placeholder="Email Address" aria-label="Email address" autoComplete="email" required maxLength={254} />}
            </div>
            <div className="auth-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
              <input name="password" type={showPw ? 'text' : 'password'} placeholder={authMode === 'register' ? 'Password (8+ characters)' : 'Password'} aria-label="Password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={authMode === 'register' ? 8 : undefined} maxLength={200} />
              <button type="button" className="auth-eye" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPw ? null : <path d="M4 4l16 16" />}</svg></button>
            </div>
            {authMode === 'register' ? (
              <div className="auth-field">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                <input name="password2" type={showPw2 ? 'text' : 'password'} placeholder="Confirm Password" aria-label="Confirm password" autoComplete="new-password" required maxLength={200} />
                <button type="button" className="auth-eye" aria-label={showPw2 ? 'Hide password' : 'Show password'} onClick={() => setShowPw2((v) => !v)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPw2 ? null : <path d="M4 4l16 16" />}</svg></button>
              </div>
            ) : null}
            {authMode === 'login' ? (
              <div className="auth-row">
                <label className="auth-check"><input type="checkbox" name="remember" defaultChecked={(() => { try { return Boolean(localStorage.getItem('sw-remember-email')); } catch (e) { return false; } })()} /><span className="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>Remember Me</label>
                <button type="button" className="auth-link" onClick={() => toast('Password reset is not available yet. Please contact us for help.')}>Forgot Password?</button>
              </div>
            ) : null}
            <p className="auth-err" role="alert">{authErr}</p>
            <button className="auth-submit" type="submit" disabled={authBusy}>
              {authBusy ? 'Please wait…' : (<>
                {authMode === 'login'
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M4 12h11" /><path d="m11 8 4 4-4 4" /></svg>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3.1-6.5 7-6.5" /><path d="M18 14v6M15 17h6" /></svg>}
                {authMode === 'login' ? 'Login' : 'Register'}
              </>)}
            </button>
            <div className="auth-or"><span>or</span></div>
            <button type="button" className="auth-google" onClick={() => toast('Google sign-in is not available yet.')}>
              <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" /><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
              Continue with Google
            </button>
          </form>
        ) : null}
        <p className="auth-switch">
          {authMode === 'login' ? <>Don&apos;t have an account? <button type="button" onClick={() => openAuth('register')}>Register</button></> : <>Already have an account? <button type="button" onClick={() => openAuth('login')}>Login</button></>}
        </p>
      </div>
      </div>
      <div className="auth-powered"><span>Powered by</span><img src="/assets/aquanimity.png" alt="Aquanimity" /></div>
    </div>
    {customer && acctTab ? (
      <AccountPanel tab={acctTab} setTab={setAcctTab} onClose={() => setAcctTab(null)} customer={customer} setCustomer={setCustomer}
        accountCall={accountCall} toast={toast} areas={areas} onSignOut={signOut}
        onShop={() => { setAcctTab(null); setTimeout(() => document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }), 50); }} />
    ) : null}
    {receipt ? (
      <ReceiptModal order={receipt} onClose={() => setReceipt(null)} secondary={{ label: 'Continue shopping', onClick: () => { setReceipt(null); closeCart(); } }} />
    ) : null}
    <div className={`toast${toastState.show ? ' show' : ''}`} id="toast" role="status">{toastState.msg}</div>
  </>);
}
