import { Fragment, type CSSProperties } from 'react';

/** Original CSS implementation of Aceternity's word-by-word reveal pattern. */
export function TextGenerateEffect({ words, delay = 0 }: { words: string; delay?: number }) {
  return <span className="boli-text-generate">{words.split(' ').map((word, index) =>
    <Fragment key={`${index}-${word}`}>
      {index > 0 ? ' ' : null}<span className="boli-text-word" style={{ '--word-delay': `${delay + index * 45}ms` } as CSSProperties}>{word}</span>
    </Fragment>,
  )}</span>;
}
