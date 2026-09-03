import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, MessageSquareText, PackageCheck, ShieldCheck, SlidersHorizontal, Store } from 'lucide-react';
import { SpotlightCard } from './components/ui/spotlight-card';
import { BlurFade } from './components/ui/blur-fade';

function ProductIllustration({ kind }: { kind: 'kit' | 'bottle' | 'notebook' }) {
  return <svg className={`story-product-art art-${kind}`} viewBox="0 0 360 240" fill="none" aria-hidden="true">
    <ellipse cx="180" cy="207" rx="94" ry="10" fill="currentColor" opacity=".07" />
    {kind === 'bottle' ? <>
      <g transform="rotate(11 181 128)">
        <path d="M154 63h52v19c0 13 20 19 20 42v67c0 12-10 19-23 19h-47c-13 0-22-7-22-19v-67c0-23 20-29 20-42V63Z" fill="#cdd6c4" stroke="#62745c" strokeWidth="2" />
        <path d="M151 55c0-5 4-8 9-8h40c5 0 9 3 9 8v17h-58V55Z" fill="#39513e" />
        <path d="M148 123v64c0 5 2 9 7 11" stroke="#f7f9ee" strokeWidth="5" strokeLinecap="round" />
        <path d="M137 144h85v37h-85z" fill="#eaf0dc" />
        <path d="M172 163c10-20 23-15 23-15-1 19-12 23-23 15Zm0 0-9 9" stroke="#71885b" strokeWidth="2" strokeLinecap="round" />
        <path d="M161 54h36" stroke="#829573" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="m105 90-10-7m143 5 10-7m-151 71-13 1" stroke="#a3b38d" strokeWidth="2" strokeLinecap="round" />
    </> : kind === 'notebook' ? <>
      <g transform="rotate(-12 175 133)">
        <path d="M114 64h120v136H114z" fill="#eee9dc" stroke="#9a9d84" strokeWidth="2" />
        <path d="M116 58h119v134H116c-8 0-13 2-13 8V68c0-6 5-10 13-10Z" fill="#698063" stroke="#4b6248" strokeWidth="2" />
        <path d="M119 60v130" stroke="#adc095" strokeWidth="2" />
        <path d="M139 97h69m-69 9h42" stroke="#dce7c9" strokeWidth="3" strokeLinecap="round" />
        <path d="M211 59v142l-9-6-9 6V59" fill="#d8b774" />
        <path d="M118 197h112" stroke="#c0bdaa" strokeWidth="2" />
        <path d="M140 164h27" stroke="#c0d0ad" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g transform="rotate(21 261 133)"><rect x="258" y="75" width="8" height="109" rx="4" fill="#c1a56b" /><path d="m258 184 4 13 4-13" fill="#4d6145" /><path d="M262 85v30" stroke="#f3e8cb" strokeWidth="2" /></g>
    </> : <>
      <path d="M85 131 175 97l101 34-89 44-102-44Z" fill="#dacbab" stroke="#aa9572" strokeWidth="2" />
      <g transform="rotate(-9 148 115)"><rect x="116" y="62" width="59" height="101" rx="5" fill="#76906a" stroke="#536e4c" strokeWidth="2" /><path d="M127 64v93m12-70h23m-23 9h16" stroke="#d0debf" strokeWidth="2" strokeLinecap="round" /></g>
      <g transform="rotate(8 208 103)"><path d="M193 67h27v20c0 9 9 13 9 24v48h-46v-48c0-11 10-15 10-24V67Z" fill="#dce1d1" stroke="#88967a" strokeWidth="2" /><rect x="191" y="62" width="31" height="15" rx="3" fill="#40583e" /></g>
      <path d="M85 131v61l102 32v-66L85 131Z" fill="#cfb68c" stroke="#aa9572" strokeWidth="2" />
      <path d="M187 158v66l89-38v-55l-89 27Z" fill="#e3d3b2" stroke="#aa9572" strokeWidth="2" />
      <path d="m85 131-22 25 102 33 22-31M187 158l26 17 87-31-24-13" fill="#eddfc0" stroke="#aa9572" strokeWidth="2" strokeLinejoin="round" />
      <path d="m227 179 13-5v16l-13 5v-16Z" fill="#83946d" opacity=".75" />
      <path d="m95 82-5-9m160 5 6-10m-11 40 13-3" stroke="#a3b38d" strokeWidth="2" strokeLinecap="round" />
    </>}
  </svg>;
}

const startingPoints = [
  { kind: 'kit', label: 'Welcome kits', description: 'A thoughtful first day, in one bundle.', href: '/request?product=welcome%20kits', note: 'Bags, drinkware, stationery & more' },
  { kind: 'bottle', label: 'Steel bottles', description: 'Something useful. For everyone.', href: '/request?product=steel%20bottles', note: 'Choose your quantity and budget' },
  { kind: 'notebook', label: 'Notebooks', description: 'For fresh ideas and new beginnings.', href: '/request?product=notebooks', note: 'Explore the connected catalog' },
] as const;

export function HomeStory() {
  return <div className="home-story">
    <nav className="story-nav" aria-label="Explore Boli">
      <div>
        <span className="story-nav-label">A little more about Boli</span>
        <div className="story-nav-sections"><a href="#how-boli-works">How it works</a><a href="#what-to-buy">What to buy</a><a href="#for-merchants">For merchants</a></div>
        <a className="story-nav-start" href="#start-shopping">Start a request <ArrowRight size={14} /></a>
      </div>
    </nav>

    <section className="story-section story-how" id="how-boli-works" aria-labelledby="story-how-title" tabIndex={-1}>
      <BlurFade><header className="story-heading"><div><span className="story-eyebrow">LESS BACK-AND-FORTH. MORE GETTING IT DONE.</span><h2 id="story-how-title">A good deal starts<br />with <em>your words.</em></h2></div><p>No long search ritual. Tell Boli what matters, compare the actual items, and choose what works for you.</p></header></BlurFade>
      <div className="story-steps">
        {[{ number: '01', Icon: MessageSquareText, title: 'Tell us what matters.', copy: 'The product, the quantity, your budget, and when you need it. Boli helps turn that into a clear request.' },
          { number: '02', Icon: PackageCheck, title: 'See what actually fits.', copy: 'Browse eligible options with the items, charges and delivery lead time visible. Ask for a better price if you need one.' },
          { number: '03', Icon: ShieldCheck, title: 'You make the call.', copy: 'Review the final offer before paying. Boli checks the store’s rules; you choose whether to go ahead.' }].map(({ number, Icon, title, copy }) => <article key={number}><div className="story-step-top"><Icon size={25} strokeWidth={1.5} /><span>{number}</span></div><h3>{title}</h3><p>{copy}</p></article>)}
      </div>
      <div className="story-principle"><ShieldCheck size={17} /><span>AI helps you find the deal. <strong>It doesn’t get to spend your money.</strong></span></div>
    </section>

    <section className="story-products-band" id="what-to-buy" aria-labelledby="story-products-title" tabIndex={-1}>
      <div className="story-section">
        <BlurFade><header className="story-heading"><div><span className="story-eyebrow">A FEW PLACES TO START</span><h2 id="story-products-title">Real things.<br /><em>Real possibilities.</em></h2></div><div><p>Welcome kits or a product from the connected store. Start with a category, then make the request your own.</p><Link className="story-text-link" href="/catalog">Browse all products <ArrowRight size={16} /></Link></div></header></BlurFade>
        <div className="story-product-grid">{startingPoints.map((item, index) => <BlurFade key={item.kind} delay={index * 0.07}><SpotlightCard depth className={`story-product-card story-product-${item.kind}`}><Link href={item.href} aria-label={`Start a request for ${item.label.toLowerCase()}`}><div className="story-art-stage"><ProductIllustration kind={item.kind} /><span>{item.note}</span></div><div className="story-product-copy"><div><h3>{item.label}</h3><p>{item.description}</p></div><span className="story-product-arrow"><ArrowRight size={20} /></span></div></Link></SpotlightCard></BlurFade>)}</div>
        <p className="story-catalog-note">Demo merchant · Illustrations shown · Prices and availability are checked when you request an offer.</p>
      </div>
    </section>

    <section className="story-section story-merchant" id="for-merchants" aria-labelledby="story-merchant-title" tabIndex={-1}>
      <BlurFade><div className="story-merchant-panel">
        <div><span className="story-eyebrow"><Store size={16} /> ON THE OTHER SIDE OF EVERY DEAL</span><h2 id="story-merchant-title">Your products.<br />Your rules.<br /><em>A new way to sell.</em></h2><p>See what buyers want, review offers that need your attention, and keep your catalog ready for the next order.</p><Link href="/sell">Explore the merchant workspace <ArrowRight size={17} /></Link></div>
        <div className="story-merchant-details"><SlidersHorizontal size={28} strokeWidth={1.5} /><h3>Control stays with the store.</h3>{[{ title: 'A catalog you can work with', copy: 'Edit product prices, costs, stock and lead times.' }, { title: 'Clear rules for every offer', copy: 'Set your minimum margin and automatic price-reduction limit.' }, { title: 'Decisions you can act on', copy: 'Approve or decline price requests and follow paid orders.' }].map(item => <div key={item.title}><Check size={16} /><p><strong>{item.title}</strong><span>{item.copy}</span></p></div>)}<small>Explore with The Good Batch’s connected demo store.</small></div>
      </div></BlurFade>
    </section>

    <section className="story-section story-faq" aria-labelledby="story-faq-title">
      <div><span className="story-eyebrow">GOOD QUESTIONS</span><h2 id="story-faq-title">Before you <em>ask.</em></h2><a className="story-text-link" href="#start-shopping">Ready? Start with what you need <ArrowDown size={16} className="story-return-arrow" /></a></div>
      <div className="story-questions">
        <details><summary>Can I ask for anything?</summary><p>Describe what you need. This demo supports welcome kits or one product type from the connected catalog. If there’s no match, Boli will tell you and let you adjust the request.</p></details>
        <details><summary>Does asking commit me to a purchase?</summary><p>No. You review the requirements, the items and the final total first. Continuing to payment accepts that exact offer; a chat message alone never authorizes a payment.</p></details>
        <details><summary>Are these live purchases?</summary><p>This is a local buildathon demo with test payments only. Prices, inventory checks, merchant rules and order decisions run through the backend. There is no live fulfillment.</p></details>
      </div>
    </section>
  </div>;
}
