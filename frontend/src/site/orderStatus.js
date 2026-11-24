/* Shared wording for order states, used by the order page and the customer account. */

export const tk = (n) => 'Tk ' + Number(n).toLocaleString('en-IN');

export const ORDER_STEPS = ['Received', 'Confirmed', 'Dispatched', 'Delivered'];

export const stepOf = (o) => ({ pending: 1, confirmed: 2, dispatched: 3, delivered: 4 }[o.status] || 0);

const PAY_LABELS = { cod: 'Cash on delivery', bkash: 'bKash', sslcommerz: 'Card / Mobile banking' };
export const payLabel = (m) => PAY_LABELS[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : '');

export const fmtDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** What the customer is told for each order state. */
export function describe(o) {
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
