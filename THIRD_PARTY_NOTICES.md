# UI component credits

## Magic UI — Border Beam and Blur Fade

The local `app/components/ui/border-beam.tsx` and `.boli-border-beam` styles
adapt the masked, moving-border technique from Magic UI's Border Beam,
discovered through its [21st.dev listing](https://21st.dev/@dillionverma/components/border-beam).

- Source: https://magicui.design/r/border-beam.json
- Documentation: https://magicui.design/docs/components/border-beam
- License: https://github.com/magicuidesign/magicui/blob/main/LICENSE.md

Boli replaces the Motion runtime with CSS keyframes, limits colors to the
existing palette, and connects playback to the preview's pause control.
Reduced-motion preferences disable the decorative beam.

`app/components/ui/blur-fade.tsx` adapts the opacity/offset/blur entrance and
once-in-view behavior of Magic UI's Blur Fade, available through
[21st.dev](https://21st.dev/@dillionverma/components/blur-fade).

- Source: https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/blur-fade.tsx
- Documentation: https://magicui.design/docs/components/blur-fade

Boli uses IntersectionObserver and the browser's animation API instead of Motion.
Content remains visible without JavaScript. Animation plays once, is cancelled
on keyboard focus, and is skipped/cancelled for reduced-motion preferences.
Only landing content is animated, never prices, merchant data or checkout state.

### MIT License

Copyright (c) Magic UI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Aceternity UI — interaction reference

`app/components/ui/spotlight-card.tsx` is an original implementation inspired by
[Aceternity's Card Spotlight](https://ui.aceternity.com/components/card-spotlight).
It does not copy the upstream component, shaders, or Canvas Reveal Effect.
Pointer-local events and CSS provide a restrained card-edge highlight without
adding Motion, Three.js, or canvas dependencies. Touch and reduced-motion users
receive the ordinary, fully readable card.

The optional illustration depth in that component also references
[Aceternity's 3D Card Effect](https://ui.aceternity.com/components/3d-card-effect).
It uses bounded pointer-relative rotation only on the decorative illustration;
the card link and product text never move. No upstream 3D component is copied.

`app/components/ui/text-generate-effect.tsx` is an original, CSS-only implementation
of the staggered-word pattern in
[Aceternity's Text Generate Effect](https://ui.aceternity.com/components/text-generate-effect).
It retains Boli's existing heading text, font, size and line break, with a short
non-looping entrance. No upstream component code or animation dependency is copied.
