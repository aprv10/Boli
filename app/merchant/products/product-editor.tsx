'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
export type EditableProduct = { id: string; sku: string; name: string; price: number; cost: number; stock: number; reserved: number; days: number; version: number };
export function ProductEditor({ products }: { products: EditableProduct[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<EditableProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); if (!edit) return; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/merchant/products/${edit.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: edit.version, pricePaise: Math.round(edit.price), costPaise: Math.round(edit.cost), stock: edit.stock, days: edit.days }) });
      const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error);
      setEdit(null); setNotice('Product saved. Reserved units and accepted order prices were preserved.'); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  return <>
    {notice ? <p className="shopping-notice" role="status">{notice}</p> : null}
    {edit ? <form className="product-edit-form" onSubmit={save}><h2>Edit {edit.name}</h2><p>{edit.sku} · {edit.reserved} units reserved</p>
      <div>{([{key:'price', label:'Selling price (₹)', factor:100, min:.01}, {key:'cost', label:'Unit cost (₹)', factor:100, min:0}, {key:'stock', label:'Stock on hand', factor:1, min:edit.reserved}, {key:'days', label:'Lead time (days)', factor:1, min:0}] as const).map(field => <label key={field.key}>{field.label}<input required type="number" step={field.factor === 100 ? '.01' : '1'} min={field.min} max={field.key === 'days' ? 365 : 1000000} value={edit[field.key] / field.factor} onChange={event => setEdit({ ...edit, [field.key]: Number(event.target.value) * field.factor })} /></label>)}</div>
      <footer><button disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button><button className="subtle-button" type="button" disabled={busy} onClick={() => {setEdit(null);setError('');}}>Cancel</button></footer>
      {error ? <p className="flow-error" role="alert">{error}</p> : null}
    </form> : null}
    <div className="merchant-table-wrap"><table className="merchant-table"><thead><tr><th>Product / SKU</th><th>Price</th><th>Unit cost</th><th>Available</th><th>Reserved</th><th>Lead time</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{products.map(product => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td>₹{(product.price / 100).toLocaleString('en-IN')}</td><td>₹{(product.cost / 100).toLocaleString('en-IN')}</td><td>{Math.max(0, product.stock - product.reserved)}</td><td>{product.reserved}</td><td>{product.days} days</td><td><button className="table-action" disabled={busy} onClick={() => { setEdit(product); setError(''); setNotice(''); }}>Edit</button></td></tr>)}</tbody></table></div>
  </>;
}
