import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionGate, canonicalize, validateArguments } from '../dist/index.js';

const user = { id: 'agent-user', tenantId: 'tenant-a', roles: ['operator'] };
const reviewer = { id: 'reviewer', tenantId: 'tenant-a', roles: ['approver'] };
const string = { type: 'string', minLength: 1, maxLength: 200 };
const schema = { type: 'object', required: ['tenantId', 'payload', 'items'], properties: {
  tenantId: string, payload: { type: 'object', required: ['message', 'level'], properties: {
    message: { ...string, sensitive: true }, level: { type: 'integer', minimum: 1, maximum: 3 }
  } }, items: { type: 'array', minItems: 1, maxItems: 100, items: string }, token: string
} };
const tools = ['read', 'write', 'external', 'destructive'].map(risk => ({ id: `tool.${risk}`, version: '1.0', label: risk,
  risk, schema, tenantArgumentPath: ['tenantId'], requesterRoles: ['operator'], approverRoles: ['approver'], allowedTenants: ['tenant-a', 'tenant-b'] }));
const policy = { version: 'policy-v1', ttlMs: 600_000, rules: [
  { id: 'large-deny', toolIds: ['tool.write'], effect: 'deny', conditions: [{ path: ['items'], operator: 'array-length-greater-than', value: 20 }] },
  { id: 'read-sensitive', toolIds: ['tool.read'], effect: 'approval-required', conditions: [{ path: ['payload', 'level'], operator: 'equals', value: 3 }] }
] };
const args = () => ({ tenantId: 'tenant-a', payload: { message: 'private-content', level: 1 }, items: ['item-1'], token: 'secret-token' });
const call = (risk = 'write', value = args()) => ({ toolId: `tool.${risk}`, args: value });
function setup(options = {}) {
  let now = 1_800_000_000_000, id = 0;
  const gate = new ActionGate({ tools, policy, now: () => now, idFactory: () => `action-${++id}`, ...options });
  return { gate, advance: ms => { now += ms; }, setTime: value => { now = value; } };
}
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

test('read is allowed, writes/external/destructive require explicit human approval', () => {
  const { gate } = setup();
  assert.equal(gate.preflight(call('read'), user).state, 'allow');
  for (const risk of ['write', 'external', 'destructive']) assert.equal(gate.preflight(call(risk), user).state, 'approval-required');
});
test('unknown tool denies even if model supplies a harmless risk claim', () => {
  const { gate } = setup(); const result = gate.preflight({ toolId: 'model.unknown', args: { risk: 'read' } }, user);
  assert.equal(result.state, 'deny'); assert.equal(result.reasonCodes[0], 'UNKNOWN_TOOL'); assert.equal(result.risk, null);
});
test('unregistered fields including model-provided risk cannot alter the registry', () => {
  const { gate } = setup(); const result = gate.preflight(call('write', { ...args(), risk: 'read' }), user);
  assert.equal(result.state, 'deny'); assert.equal(result.issues[0].code, 'UNKNOWN_FIELD');
});
test('deny wins over requireApproval and allow independent of order', () => {
  const rules = ['allow', 'approval-required', 'deny'].map((effect, i) => ({ id: `r${i}`, effect }));
  for (const ordered of [rules, [...rules].reverse()]) {
    const { gate } = setup({ policy: { ...policy, rules: ordered } });
    const result = gate.preflight(call('read'), user); assert.equal(result.state, 'deny'); assert.equal(result.matchedRuleIds.length, 3);
  }
});
test('allow rule cannot bypass write baseline; selected reads can require approval', () => {
  const { gate } = setup({ policy: { ...policy, rules: [{ id: 'allow-all', effect: 'allow' }, ...policy.rules] } });
  assert.equal(gate.preflight(call('write'), user).state, 'approval-required');
  const value = args(); value.payload.level = 3;
  assert.equal(gate.preflight(call('read', value), user).state, 'approval-required');
});
test('deep schema rejects wrong type, required fields, unknown fields, numeric and array limits', () => {
  const variants = [
    { ...args(), payload: { message: 'a', level: '1' } },
    { ...args(), payload: { level: 1 } }, { ...args(), payload: { message: 'a', level: 1, hidden: true } },
    { ...args(), payload: { message: 'a', level: 3.5 } }, { ...args(), items: [] }, { ...args(), items: [true] }
  ];
  for (const value of variants) assert.equal(setup().gate.preflight(call('write', value), user).state, 'deny');
});
test('tenant and requester roles are validated before the policy', () => {
  const { gate } = setup();
  assert.equal(gate.preflight(call(), { ...user, roles: ['visitor'] }).reasonCodes[0], 'REQUESTER_ROLE_DENIED');
  assert.equal(gate.preflight(call(), { ...user, tenantId: 'tenant-b' }).reasonCodes[0], 'ARGUMENT_TENANT_MISMATCH');
  assert.equal(gate.preflight(call(), { ...user, tenantId: 'tenant-z' }).reasonCodes[0], 'TOOL_TENANT_DENIED');
});
test('approval + consume succeeds once and returns exact immutable validated args', () => {
  const { gate } = setup(), proposal = call(), action = gate.preflight(proposal, user);
  gate.approve(action.id, reviewer); const permit = gate.consume(action.id, proposal, user);
  assert.deepEqual(permit.args, proposal.args); assert.equal(permit.toolVersion, '1.0'); assert.equal(permit.policyVersion, 'policy-v1');
  assert.ok(Object.isFrozen(permit.args.payload)); assert.equal(gate.inspect(action.id).state, 'consumed');
  rejects(() => gate.consume(action.id, proposal, user), 'ALREADY_CONSUMED');
});
test('self approval denied even when applicant has approver role', () => {
  const { gate } = setup(), actor = { ...user, roles: ['operator', 'approver'] }, action = gate.preflight(call(), actor);
  rejects(() => gate.approve(action.id, actor), 'SELF_APPROVAL_DENIED'); assert.equal(gate.inspect(action.id).state, 'approval-required');
});
test('cross-tenant approval and wrong approver role do not burn a valid request', () => {
  const { gate } = setup(), action = gate.preflight(call(), user);
  rejects(() => gate.approve(action.id, { ...reviewer, tenantId: 'tenant-b' }), 'APPROVER_TENANT_MISMATCH');
  rejects(() => gate.approve(action.id, { ...reviewer, roles: ['operator'] }), 'APPROVER_ROLE_DENIED');
  assert.equal(gate.approve(action.id, reviewer).state, 'approved');
});
test('changing a deeply nested argument invalidates the attempted consumption, not the original', () => {
  const { gate } = setup(), proposal = call(), action = gate.preflight(proposal, user); gate.approve(action.id, reviewer);
  const changed = args(); changed.payload.message = 'different-content';
  rejects(() => gate.consume(action.id, call('write', changed), user), 'BINDING_MISMATCH');
  assert.equal(gate.inspect(action.id).state, 'approved'); assert.equal(gate.consume(action.id, proposal, user).actionId, action.id);
});
test('object key order and role order canonicalize; array order stays meaningful', () => {
  assert.equal(canonicalize({ b: 2, a: { z: 1, k: true } }), canonicalize({ a: { k: true, z: 1 }, b: 2 }));
  assert.notEqual(canonicalize(['a', 'b']), canonicalize(['b', 'a']));
  const { gate } = setup(), actor = { ...user, roles: ['operator', 'viewer'] }, original = args(); original.items = ['a', 'b'];
  const action = gate.preflight(call('write', original), actor); gate.approve(action.id, reviewer);
  const reordered = { token: original.token, items: ['a', 'b'], payload: { level: 1, message: original.payload.message }, tenantId: 'tenant-a' };
  assert.equal(gate.consume(action.id, call('write', reordered), { ...actor, roles: ['viewer', 'operator', 'operator'] }).actionId, action.id);
});
test('changing subject, roles, or tool rejects approved reuse', () => {
  const { gate } = setup(), action = gate.preflight(call(), user); gate.approve(action.id, reviewer);
  rejects(() => gate.consume(action.id, call(), { ...user, id: 'someone-else' }), 'BINDING_MISMATCH');
  rejects(() => gate.consume(action.id, call(), { ...user, roles: ['operator', 'viewer'] }), 'BINDING_MISMATCH');
  rejects(() => gate.consume(action.id, call('external'), user), 'BINDING_MISMATCH');
  assert.equal(gate.inspect(action.id).state, 'approved');
});
test('current role revocation and cross-tenant consume are rejected', () => {
  const { gate } = setup(), action = gate.preflight(call(), user); gate.approve(action.id, reviewer);
  rejects(() => gate.consume(action.id, call(), { ...user, roles: [] }), 'REVALIDATION_DENIED');
  const value = args(); value.tenantId = 'tenant-b';
  rejects(() => gate.consume(action.id, call('write', value), { ...user, tenantId: 'tenant-b' }), 'BINDING_MISMATCH');
});
test('approval does not extend expiry; exact expiry boundary is rejected', () => {
  const { gate, advance } = setup(), action = gate.preflight(call(), user); advance(599_000); gate.approve(action.id, reviewer);
  assert.equal(gate.inspect(action.id).expiresAt, action.expiresAt); advance(1000);
  rejects(() => gate.consume(action.id, call(), user), 'EXPIRED'); assert.equal(gate.inspect(action.id).state, 'expired');
});
test('expired pending cannot approve and allowed read also has a TTL', () => {
  const { gate, advance } = setup(), pending = gate.preflight(call(), user), allowed = gate.preflight(call('read'), user); advance(600_000);
  rejects(() => gate.approve(pending.id, reviewer), 'INVALID_STATE'); rejects(() => gate.consume(allowed.id, call('read'), user), 'EXPIRED');
});
test('rejected, denied, and unapproved calls cannot consume; no decision reversal', () => {
  const { gate } = setup(), action = gate.preflight(call(), user);
  rejects(() => gate.consume(action.id, call(), user), 'NOT_AUTHORIZED'); gate.reject(action.id, reviewer);
  rejects(() => gate.approve(action.id, reviewer), 'INVALID_STATE'); rejects(() => gate.consume(action.id, call(), user), 'NOT_AUTHORIZED');
  const value = args(); value.items = Array.from({ length: 21 }, (_, i) => String(i));
  const denied = gate.preflight(call('write', value), user); assert.equal(denied.state, 'deny');
  rejects(() => gate.approve(denied.id, reviewer), 'INVALID_STATE');
});
test('policy update expires all outstanding permits and cannot retain same version', () => {
  const { gate } = setup(), action = gate.preflight(call(), user); gate.approve(action.id, reviewer);
  const allowed = gate.preflight(call('read'), user);
  rejects(() => gate.replacePolicy(policy), 'VERSION_UNCHANGED'); gate.replacePolicy({ ...policy, version: 'policy-v2' });
  assert.equal(gate.inspect(action.id).state, 'expired'); assert.equal(gate.inspect(allowed.id).state, 'expired');
  rejects(() => gate.consume(action.id, call(), user), 'EXPIRED'); assert.equal(gate.preflight(call(), user).policyVersion, 'policy-v2');
});
test('tool catalog and policy are snapshotted and cannot be mutated after creation', () => {
  const mutableTools = JSON.parse(JSON.stringify(tools)), mutablePolicy = JSON.parse(JSON.stringify(policy));
  const { gate } = setup({ tools: mutableTools, policy: mutablePolicy });
  mutableTools[1].risk = 'read'; mutablePolicy.rules = [];
  assert.equal(gate.preflight(call(), user).state, 'approval-required');
  assert.throws(() => gate.catalog[1].risk = 'read', TypeError);
});
test('canonicalizer rejects prototype pollution and does not invoke getters', () => {
  assert.throws(() => canonicalize(JSON.parse('{"payload":{"__proto__":{"polluted":true}}}')));
  assert.throws(() => canonicalize({ constructor: 'x' }));
  let touched = false; const value = {}; Object.defineProperty(value, 'x', { enumerable: true, get() { touched = true; return 1; } });
  assert.throws(() => canonicalize(value)); assert.equal(touched, false); assert.equal({}.polluted, undefined);
});
test('strict JSON rejects cycles, classes, symbols, sparse arrays, BigInt and non-finite values', () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [cyclic, new Date(), { a: undefined }, { [Symbol('x')]: 1 }, [,,], NaN, Infinity, BigInt(1)]) assert.throws(() => canonicalize(value));
  const array = [1]; array.extra = true; assert.throws(() => canonicalize(array));
  assert.equal(canonicalize(-0), '0');
});
test('strict JSON enforces node, byte and depth resource limits', () => {
  assert.throws(() => canonicalize('x'.repeat(140_000)));
  let nested = {}; for (let i = 0; i < 20; i++) nested = { nested }; assert.throws(() => canonicalize(nested));
  assert.throws(() => canonicalize(Array.from({ length: 10_001 }, () => 1)));
});
test('preview redacts schema-sensitive and credential fields; audit never contains arguments', () => {
  const { gate } = setup(), action = gate.preflight(call(), user);
  assert.equal(action.preview.payload.message, '[已隐藏]'); assert.equal(action.preview.token, '[已隐藏]');
  gate.approve(action.id, reviewer); gate.consume(action.id, call(), user);
  const serialized = JSON.stringify(gate.audit());
  assert.ok(!serialized.includes('private-content')); assert.ok(!serialized.includes('secret-token'));
  assert.deepEqual(gate.audit().map(e => e.event), ['preflight', 'approved', 'consumed']);
  assert.ok(Object.isFrozen(gate.audit()[0]));
});
test('single-instance consume check+mark prevents concurrent promise callers from duplicating permits', async () => {
  const { gate } = setup(), action = gate.preflight(call(), user); gate.approve(action.id, reviewer);
  const results = await Promise.allSettled([0, 1, 2].map(() => Promise.resolve().then(() => gate.consume(action.id, call(), user))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 2);
});
test('instance, ID collisions, capacity and clock rollback are explicit boundaries', () => {
  const first = setup(), second = setup(), action = first.gate.preflight(call(), user); first.gate.approve(action.id, reviewer);
  rejects(() => second.gate.consume(action.id, call(), user), 'ACTION_NOT_FOUND');
  const duplicates = setup({ idFactory: () => 'same' }).gate; duplicates.preflight(call(), user); rejects(() => duplicates.preflight(call(), user), 'DUPLICATE_ID');
  const small = setup({ maxActions: 1 }).gate; small.preflight(call(), user); rejects(() => small.preflight(call(), user), 'CAPACITY_EXCEEDED');
  first.advance(-1); rejects(() => first.gate.inspect(action.id), 'CLOCK_INVALID');
});
test('validation supports enum and boolean without silently coercing values', () => {
  const rule = { type: 'object', required: ['mode', 'active'], properties: { mode: { type: 'string', enum: ['a', 'b'] }, active: { type: 'boolean' } } };
  assert.equal(validateArguments({ mode: 'a', active: false }, rule).length, 0);
  assert.deepEqual(validateArguments({ mode: 'c', active: 'false' }, rule).map(i => i.code), ['ENUM', 'BOOLEAN_REQUIRED']);
});
test('constructor rejects malformed registry or policy references', () => {
  assert.throws(() => setup({ tools: [tools[0], tools[0]] }), /重复/);
  assert.throws(() => setup({ policy: { ...policy, ttlMs: 0 } }), /有效期/);
  assert.throws(() => setup({ policy: { ...policy, rules: [{ id: 'unknown', effect: 'deny', toolIds: ['missing'] }] } }), /未注册/);
});
test('call envelope getters cannot switch tool identity during preflight or consume', () => {
  const { gate } = setup(); let touched = false;
  const malicious = { toolId: 'tool.read', get args() { touched = true; this.toolId = 'tool.destructive'; return args(); } };
  rejects(() => gate.preflight(malicious, user), 'INVALID_CALL'); assert.equal(touched, false);
  const action = gate.preflight(call('read'), user);
  rejects(() => gate.consume(action.id, malicious, user), 'INVALID_CALL'); assert.equal(touched, false);
  assert.equal(gate.consume(action.id, call('read'), user).toolId, 'tool.read');
});
