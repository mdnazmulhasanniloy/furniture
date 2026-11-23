import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

// ajv-formats is CJS; depending on the loader the default import is the plugin or the module object.
const addFormats = ((addFormatsModule as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
import type { Response } from 'supertest';
import { parse } from 'yaml';

/**
 * OpenAPI 3.1 response-conformance harness (T-019, NFR-01).
 *
 * The task sheet suggests `jest-openapi` / `openapi-response-validator`, but both only understand
 * OpenAPI 2/3.0 and our spec is 3.1 — whose schemas are plain JSON Schema 2020-12, so Ajv's 2020
 * dialect validates them directly (approved on plan review).
 */

const SPEC_PATH = path.resolve(
  import.meta.dirname,
  '../../../project-docs/04-architecture/api-spec.yaml',
);
const SPEC_ID = 'api-spec.yaml';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SpecDoc extends Dict {
  paths: Record<string, Dict>;
}

export function loadSpec(): SpecDoc {
  const doc = parse(readFileSync(SPEC_PATH, 'utf8')) as unknown;
  if (!isDict(doc) || !isDict(doc.paths)) throw new Error('api-spec.yaml has no paths object');
  return doc as SpecDoc;
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** Every documented operation as `METHOD /path` (spec-relative, e.g. `POST /auth/login`). */
export function specOperations(spec: SpecDoc): string[] {
  const ops: string[] = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of HTTP_METHODS) {
      if (isDict(item[m])) ops.push(`${m.toUpperCase()} ${p}`);
    }
  }
  return ops.sort();
}

/**
 * The concrete Express path a spec path is served at: the spec's base URL is `/api/v1`, while
 * `/health` and `/internal/...` declare their own root-level servers.
 */
export function mountedPath(specPath: string): string {
  return specPath === '/health' || specPath.startsWith('/internal/')
    ? specPath
    : `/api/v1${specPath}`;
}

/** JSON-pointer escaping per RFC 6901. */
const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

function pointerGet(doc: unknown, pointer: string): unknown {
  let node: unknown = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isDict(node)) return undefined;
    node = node[key];
  }
  return node;
}

export class ConformanceError extends Error {}

export class Conformance {
  private readonly spec: SpecDoc;
  private readonly ajv: Ajv2020;
  private readonly covered = new Set<string>();
  private readonly validators = new Map<string, ValidateFunction | null>();

  constructor(spec: SpecDoc = loadSpec()) {
    this.spec = spec;
    // strict off: OpenAPI documents carry non-schema keywords (`x-canonical-pattern`, `example`).
    this.ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(this.ajv);
    this.ajv.addSchema(spec as never, SPEC_ID);
  }

  /** `null` when the documented response has no JSON body (e.g. 204). */
  private validatorFor(specPath: string, method: string, status: number): ValidateFunction | null {
    const opPointer = `/paths/${esc(specPath)}/${method}`;
    const op = pointerGet(this.spec, opPointer);
    if (!isDict(op)) {
      throw new ConformanceError(
        `${method.toUpperCase()} ${specPath} is not documented in api-spec.yaml`,
      );
    }
    const responses = isDict(op.responses) ? op.responses : {};
    const resp = responses[String(status)];
    if (resp === undefined) {
      throw new ConformanceError(
        `${method.toUpperCase()} ${specPath} answered ${status}, which api-spec.yaml does not document ` +
          `(documented: ${Object.keys(responses).join(', ')})`,
      );
    }
    // Resolve a response-object $ref ('#/components/responses/X') so the schema pointer stays inside the spec.
    let respPointer = `${opPointer}/responses/${status}`;
    if (isDict(resp) && typeof resp.$ref === 'string') respPointer = resp.$ref.slice(1);
    const key = `${respPointer}`;
    const cached = this.validators.get(key);
    if (cached !== undefined) return cached;
    const respObj = pointerGet(this.spec, respPointer);
    const content = isDict(respObj) && isDict(respObj.content) ? respObj.content : undefined;
    const media =
      content && isDict(content['application/json']) ? content['application/json'] : undefined;
    let validator: ValidateFunction | null = null;
    if (media && media.schema !== undefined) {
      const schemaRef = `${SPEC_ID}#${respPointer}/content/${esc('application/json')}/schema`;
      validator = this.ajv.getSchema(schemaRef) ?? null;
      if (!validator) throw new ConformanceError(`could not compile schema at ${schemaRef}`);
    }
    this.validators.set(key, validator);
    return validator;
  }

  /**
   * Validates one received response against the spec and records coverage. Fails (throws) when:
   * the operation or the received status is undocumented, the status is a 5xx, the body does not
   * match the documented schema, or a 4xx body is missing the `Error` fields / a string `requestId`.
   */
  check(method: string, specPath: string, res: Response): Response {
    const m = method.toLowerCase();
    const label = `${method.toUpperCase()} ${specPath}`;
    // Fail on any 5xx before the documentation lookup: a 500 is never acceptable here (owner, T-019).
    if (res.status >= 500) {
      throw new ConformanceError(`${label} answered ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const validator = this.validatorFor(specPath, m, res.status);
    this.covered.add(`${method.toUpperCase()} ${specPath}`);
    if (validator) {
      const body: unknown = res.body;
      if (!validator(body)) {
        throw new ConformanceError(
          `${label} ${res.status} body does not match api-spec.yaml:\n` +
            `${this.ajv.errorsText(validator.errors, { separator: '\n' })}\n` +
            `body: ${JSON.stringify(body).slice(0, 2000)}`,
        );
      }
    }
    if (res.status >= 400) {
      // Owner addition (T-019 c): every error response carries the Error shape with a requestId.
      const body = res.body as { code?: unknown; message?: unknown; requestId?: unknown };
      if (typeof body.code !== 'string' || typeof body.message !== 'string') {
        throw new ConformanceError(
          `${label} ${res.status} error body is not the Error schema: ${res.text}`,
        );
      }
      if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
        throw new ConformanceError(
          `${label} ${res.status} error body has no requestId: ${res.text}`,
        );
      }
    }
    return res;
  }

  /** Operations documented in the spec that no `check` call exercised. */
  uncovered(): string[] {
    return specOperations(this.spec).filter((op) => !this.covered.has(op));
  }
}

/** `METHOD /path` for every route registered in an Express 5 app, `:param` rewritten to `{param}`. */
export function expressRoutes(app: unknown): string[] {
  const out = new Set<string>();
  interface Layer {
    name?: string;
    rawPath?: string;
    route?: { path: string | string[]; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  }
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) {
          const full = (prefix + p).replace(/\/+$/, '') || '/';
          for (const method of Object.keys(layer.route.methods)) {
            out.add(`${method.toUpperCase()} ${full.replace(/:([^/]+)/g, '{$1}')}`);
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + (layer.rawPath ?? ''));
      }
    }
  };
  const router = (app as { router?: { stack?: Layer[] } }).router;
  if (!router?.stack) throw new Error('not an Express 5 app (no router.stack)');
  walk(router.stack, '');
  return [...out].sort();
}
