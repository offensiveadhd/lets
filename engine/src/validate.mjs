/**
 * A small JSON-Schema (2020-12 subset) validator — enough for LIP manifests,
 * envelopes and store indexes without pulling a dependency.
 *
 * Supported: type, required, properties, additionalProperties (false|schema),
 * items, minItems, maxItems, enum, const, pattern, minLength, maxLength,
 * minimum, maximum, anyOf, oneOf, allOf, not, $ref (local "#/..." only).
 */
export function validate(schema, value, root = schema, path = '$') {
  const errors = [];
  check(schema, value, root, path, errors);
  return { ok: errors.length === 0, errors };
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`only local refs supported: ${ref}`);
  let cur = root;
  for (const part of ref.slice(2).split('/')) {
    cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (cur === undefined) throw new Error(`unresolved ref: ${ref}`);
  }
  return cur;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(expected, v) {
  const t = typeOf(v);
  if (expected === 'number') return t === 'number' || t === 'integer';
  return expected === t;
}

function check(schema, v, root, path, errors) {
  if (schema === true) return;
  if (schema === false) { errors.push(`${path}: schema forbids value`); return; }
  if (schema.$ref) { check(resolveRef(schema.$ref, root), v, root, path, errors); return; }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, v))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(v)}`);
      return;
    }
  }
  if (schema.const !== undefined && JSON.stringify(v) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof v === 'string') {
    if (schema.minLength !== undefined && v.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && v.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errors.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) v.forEach((item, i) => check(schema.items, item, root, `${path}[${i}]`, errors));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const req of schema.required || []) {
      if (!(req in v)) errors.push(`${path}: missing required "${req}"`);
    }
    const props = schema.properties || {};
    for (const [k, sub] of Object.entries(props)) {
      if (k in v) check(sub, v[k], root, `${path}.${k}`, errors);
    }
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      for (const k of Object.keys(v)) {
        if (k in props) continue;
        if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
        else check(schema.additionalProperties, v[k], root, `${path}.${k}`, errors);
      }
    }
  }
  if (schema.allOf) for (const s of schema.allOf) check(s, v, root, path, errors);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validate(s, v, root, path).ok);
    if (!ok) errors.push(`${path}: matches none of anyOf`);
  }
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validate(s, v, root, path).ok).length;
    if (n !== 1) errors.push(`${path}: matches ${n} of oneOf, need exactly 1`);
  }
  if (schema.not && validate(schema.not, v, root, path).ok) errors.push(`${path}: must not match "not" schema`);
}
