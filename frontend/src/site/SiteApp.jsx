import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
function loadCart() {
  try { return JSON.parse(localStorage.getItem('sw-cart') || '{}') || {}; } catch (e) { return {}; }
}
const saveCart = (cart) => { try { localStorage.setItem('sw-cart', JSON.stringify(cart)); } catch (e) { /* private mode */ } };

export default function SiteApp() {
  /* ---------- live data from the server (prices, stock, checkout). Until it arrives the built-in prices are shown. ---------- */
  const [products, setProducts] = useState(() => structuredClone(PRODUCTS));
  const [live, setLive] = useState({ ok: false, available: { 500: Infinity, 2000: Infinity }, checkout: null });
  const [content, setContent] = useState({}); // only the values changed in the admin
  const [checkoutNote, setCheckoutNote] = useState('Delivery charge shown at checkout.');

  const [cart, setCart] = useState(loadCart);
  const [size, setSize] = useState('500');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState('cart'); // cart → checkout → done
  const [payMethod, setPayMethod] = useState('');
  const [coErr, setCoErr] = useState('');
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState({ code: '', msg: '', link: '#' });
  const [toastState, setToastState] = useState({ msg: '', show: false });
  const [symbol, setSymbol] = useState({ sym: 'K', label: 'Potassium' });
  const [customer, setCustomer] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const refs = {
    loader: useRef(null), nav: useRef(null), navLinks: useRef(null), heroBottle: useRef(null), pipeline: useRef(null),
    ingList: useRef(null), ingBottle: useRef(null), symBox: useRef(null), dots: useRef(null),
    pill: useRef(null), toggle: useRef(null), cartCount: useRef(null), closeCart: useRef(null),
    form: useRef(null), coName: useRef(null), coPhone: useRef(null), coAddress: useRef(null), coCity: useRef(null),
    coCitySelect: useRef(null), coEmail: useRef(null), coNote: useRef(null), announce: useRef(null),
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
  const updateCart = (next) => { setCart(next); saveCart(next); };

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

  const add = (sku) => {
    if (!canAdd(sku)) return toast(stockMsg(sku));
    updateCart({ ...cleanCart, [sku]: (cleanCart[sku] || 0) + 1 });
    const c = refs.cartCount.current; c.classList.add('bump'); setTimeout(() => c.classList.remove('bump'), 250);
    toast(`Added ${products[sku].name}`);
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
  useEffect(() => { accountCall('me').then((d) => setCustomer(d.customer)).catch(() => {}); }, []);
  const openAuth = (mode = 'login') => { setAuthMode(mode); setAuthErr(''); setAuthOpen(true); };
  const submitAuth = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries());
    if (authMode === 'register' && body.password !== body.password2) { setAuthErr('The two passwords do not match.'); return; }
    delete body.password2;
    setAuthBusy(true); setAuthErr('');
    try {
      const d = await accountCall(authMode, body);
      if (d.staff) { location.href = d.redirect || '/admin'; return; }
      setCustomer(d.customer); setAuthOpen(false);
      toast(authMode === 'register' ? `Welcome, ${d.customer.name}!` : `Welcome back, ${d.customer.name}!`);
    } catch (err) { setAuthErr(err.message); } finally { setAuthBusy(false); }
  };
  const signOut = async () => {
    try { await accountCall('logout', {}); } catch (e) { /* ignore */ }
    setCustomer(null); toast('Signed out.');
  };
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e) => e.key === 'Escape' && setAuthOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [authOpen]);

  const startCheckout = () => {
    if (!live.ok || !live.checkout || !live.checkout.methods.length) {
      return toast("Online ordering isn't available right now. Please try again shortly.");
    }
    setPayMethod(live.checkout.methods[0].id);
    try {
      const saved = { ...JSON.parse(localStorage.getItem('sw-customer') || '{}'), ...(customer ? { name: customer.name, phone: customer.phone, address: customer.address, city: customer.city, email: customer.email } : {}) };
      const fields = { name: refs.coName, phone: refs.coPhone, address: refs.coAddress, city: refs.coCity, email: refs.coEmail };
      for (const k of Object.keys(fields)) if (saved[k] && fields[k].current) fields[k].current.value = saved[k];
      if (saved.city && areas.includes(saved.city) && refs.coCitySelect.current) refs.coCitySelect.current.value = saved.city;
    } catch (e) { /* ignore */ }
    setCoErr('');
    setView('checkout');
    setTimeout(() => refs.coName.current?.focus(), 0);
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
      setLive({ ok: true, available: { 500: Number(d.available['500'] ?? 0), 2000: Number(d.available['2000'] ?? 0) }, checkout: d.checkout });
      setContent(d.content || {});
    } catch (e) {
      // No server (for example the page opened as a file): keep the built-in content.
      setCheckoutNote('Online ordering opens soon.');
    }
  }, []);
  useEffect(() => { loadLive(); }, [loadLive]);

  // The announcement bar makes the fixed header taller; keep anchor links clear of it.
  useEffect(() => {
    if (announce) document.documentElement.style.scrollPaddingTop = (refs.nav.current.offsetHeight + 12) + 'px';
  }, [announce]);

  const placeOrder = async (e) => {
    e.preventDefault();
    const city = areas.length ? refs.coCitySelect.current.value : refs.coCity.current.value;
    const data = {
      name: refs.coName.current.value, phone: refs.coPhone.current.value, address: refs.coAddress.current.value, city,
      email: refs.coEmail.current.value, note: refs.coNote.current.value,
      payment_method: payMethod,
      items: Object.entries(cleanCart).map(([sku, qty]) => ({ sku, qty })),
    };
    const missing = !data.name.trim() ? 'Enter your name.' : !data.phone.trim() ? 'Enter your mobile number.' : !data.address.trim() ? 'Enter your delivery address.' : !data.city.trim() ? 'Enter your area or city.' : emailNeeded && !data.email.trim() ? 'Enter your email address for the payment receipt.' : '';
    if (missing) { setCoErr(missing); return; }
    setPlacing(true); setCoErr('');
    try { localStorage.setItem('sw-customer', JSON.stringify({ name: data.name, phone: data.phone, address: data.address, city, email: data.email })); } catch (x) { /* ignore */ }
    try {
      const r = await fetch('/api/site?action=order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || 'Your order could not be placed. Please try again.');
      updateCart({}); loadLive();
      if (out.redirectUrl) { location.href = out.redirectUrl; return; }
      setDone({ code: `Order ${out.code}`, msg: out.message || '', link: `/order?code=${encodeURIComponent(out.code)}&token=${encodeURIComponent(out.token)}` });
      setView('done');
    } catch (err) {
      setCoErr(err.message);
      if (/stock|left/i.test(err.message)) loadLive();
    } finally { setPlacing(false); }
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
            ? <span className="acct"><span className="acct-name" title={customer.email}>Hi, {customer.name.split(' ')[0]}</span><button type="button" className="acct-btn" onClick={signOut}>Sign out</button></span>
            : <span className="acct"><button type="button" className="acct-btn" onClick={() => openAuth('login')}>Sign in</button><button type="button" className="acct-btn primary" onClick={() => openAuth('register')}>Register</button></span>}
          <button className="cart-btn" id="cartBtn" aria-label="Open cart" onClick={openCart}>
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
                  <button className="btn btn-primary" data-add="" disabled={soldOut} onClick={() => !soldOut && add(pl.sku)}>{soldOut ? 'Out of stock' : plan(pl.sku, 'button')}</button>
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
      <header><h2>{view === 'checkout' ? 'Checkout' : view === 'done' ? 'Thank you' : 'Your cart'}</h2>
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

      <form className="co" id="checkoutForm" ref={refs.form} hidden={view !== 'checkout'} noValidate onSubmit={placeOrder}>
        <button type="button" className="co-back" id="backToCart" onClick={() => setView('cart')}>← Back to cart</button>
        <h3>Delivery details</h3>
        <label htmlFor="coName">Full name</label>
        <input id="coName" ref={refs.coName} name="name" autoComplete="name" required maxLength={80} />
        <label htmlFor="coPhone">Mobile number</label>
        <input id="coPhone" ref={refs.coPhone} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required maxLength={20} />
        <label htmlFor="coAddress">Delivery address</label>
        <textarea id="coAddress" ref={refs.coAddress} name="address" rows={2} autoComplete="street-address" required maxLength={300} placeholder="House, road, area"></textarea>
        <label htmlFor="coCity">Area or city</label>
        <input id="coCity" ref={refs.coCity} name="city" autoComplete="address-level2" required maxLength={60} hidden={areas.length > 0} />
        <select id="coCitySelect" ref={refs.coCitySelect} aria-label="Area or city" hidden={!areas.length}>
          <option value="">Choose your area</option>
          {areas.map((a) => <option key={a}>{a}</option>)}
        </select>
        <label htmlFor="coEmail">Email <span className="opt" id="coEmailOpt">{emailNeeded ? '(needed for the payment receipt)' : '(optional)'}</span></label>
        <input id="coEmail" ref={refs.coEmail} name="email" type="email" autoComplete="email" maxLength={120} required={emailNeeded} />
        <label htmlFor="coNote">Note for delivery <span className="opt">(optional)</span></label>
        <input id="coNote" ref={refs.coNote} name="note" maxLength={300} />
        <h3>Payment</h3>
        <div className="co-methods" id="coMethods" role="radiogroup" aria-label="Payment method">
          {(live.checkout?.methods || []).map((m) => (
            <label key={m.id}><input type="radio" name="pay" value={m.id} checked={payMethod === m.id} onChange={() => setPayMethod(m.id)} /> {m.label}</label>
          ))}
        </div>
        <div className="co-sum">
          <div className="row"><span>Items</span><span id="coSub">{tk(totals.sub)}</span></div>
          <div className="row"><span>Delivery</span><span id="coDel">{del ? tk(del) : 'Free'}</span></div>
          <div className="row total"><span>Total</span><span id="coTotal">{tk(totals.sub + del)}</span></div>
        </div>
        <p className="co-err" id="coErr" role="alert">{coErr}</p>
        <button className="btn btn-primary" type="submit" id="placeOrder" disabled={placing}>{method && method.id !== 'cod' ? `Pay ${tk(totals.sub + del)}` : 'Place order'}</button>
      </form>

      <div className="co-done" id="orderDone" hidden={view !== 'done'}>
        <svg viewBox="0 0 600 488" aria-hidden="true"><use href="#q" fill="url(#qGrad)" /></svg>
        <h3>Order placed</h3>
        <p className="code" id="doneCode">{done.code}</p>
        <p id="doneMsg">{done.msg}</p>
        <a className="btn btn-ghost" id="doneLink" href={done.link}>View your order</a>
      </div>

      <footer id="cartFoot" hidden={view !== 'cart'} style={skus.length ? undefined : { display: 'none' }}>
        <div className="row"><span>Subtotal</span><span id="sub">{tk(totals.was)}</span></div>
        <div className="row saved" hidden={totals.was <= totals.sub}><span>You save</span><span id="saved">{'− ' + tk(totals.was - totals.sub)}</span></div>
        <div className="row total"><span>Total</span><span id="total">{tk(totals.sub)}</span></div>
        <button className="btn btn-primary" id="checkout" onClick={startCheckout}>Checkout</button>
        <small id="checkoutNote">{checkoutNote}</small>
      </footer>
    </aside>
    {/* ===== Sign in / Register ===== */}
    <div className={`auth-scrim${authOpen ? ' open' : ''}`} onClick={() => setAuthOpen(false)}></div>
    <div className={`auth-modal${authOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'} aria-hidden={!authOpen}>
      <button type="button" className="icon-btn auth-x" aria-label="Close" onClick={() => setAuthOpen(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={authMode === 'login'} onClick={() => { setAuthMode('login'); setAuthErr(''); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={authMode === 'register'} onClick={() => { setAuthMode('register'); setAuthErr(''); }}>Create account</button>
      </div>
      {authOpen ? (
        <form key={authMode} className="co auth-form" noValidate onSubmit={submitAuth}>
          {authMode === 'register' ? (<>
            <label htmlFor="auName">Full name</label>
            <input id="auName" name="name" autoComplete="name" required maxLength={80} />
            <label htmlFor="auPhone">Mobile number <span className="opt">(optional)</span></label>
            <input id="auPhone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={20} />
          </>) : null}
          <label htmlFor="auEmail">Email</label>
          <input id="auEmail" name="email" type="email" autoComplete="email" required maxLength={254} />
          <label htmlFor="auPass">Password {authMode === 'register' ? <span className="opt">(8+ characters)</span> : null}</label>
          <input id="auPass" name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required minLength={authMode === 'register' ? 8 : undefined} maxLength={200} />
          {authMode === 'register' ? (<>
            <label htmlFor="auPass2">Confirm password</label>
            <input id="auPass2" name="password2" type="password" autoComplete="new-password" required maxLength={200} />
          </>) : null}
          <p className="co-err" role="alert">{authErr}</p>
          <button className="btn btn-primary" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
      ) : null}
    </div>
    <div className={`toast${toastState.show ? ' show' : ''}`} id="toast" role="status">{toastState.msg}</div>
  </>);
}
