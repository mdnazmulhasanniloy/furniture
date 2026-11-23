/**
 * The single resolution target for the bare specifier 'helmet' (tsconfig `paths`, see the
 * comment there). A real module, not a declaration file: tsc and Vercel's mode-less resolver
 * type the relative .mjs import via its sibling index.d.mts (the ESM view that matches runtime),
 * and tsx — which applies `paths` at RUNTIME — executes this re-export and gets the real helmet.
 * Never imported by emitted code: compiled output keeps the bare 'helmet' specifier, which Node
 * resolves through the package's own exports map.
 */
export { default } from '../../node_modules/helmet/index.mjs';
