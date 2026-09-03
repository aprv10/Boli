const steps = ['Your request', 'Offers', 'Review & pay', 'Confirmation'];

export function BuyerProgress({ step }: { step: 0 | 1 | 2 | 3 }) {
  return <ol className="buyer-progress" aria-label="Buying progress">{steps.map((label, index) =>
    <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step || undefined}>
      <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>{label}
    </li>)}</ol>;
}
