import assert from 'node:assert/strict';
import { ActionGate } from '../dist/index.js';
import { tools, policy, subject, reviewers, scenarios } from '../demo/config.js';

let now = Date.parse('2026-10-30T09:30:00+08:00');
let serial = 0;
const gate = new ActionGate({ tools, policy, now: () => now, idFactory: () => `example-${++serial}` });
const sample = scenarios.find(item => item.id === 'mail');
const call = { toolId: sample.toolId, args: structuredClone(sample.args) };
const request = gate.preflight(call, subject);
assert.equal(request.state, 'approval-required');
gate.approve(request.id, reviewers.normal);
const changed = { toolId: call.toolId, args: { ...call.args, body: '审批后的另一段内容' } };
assert.throws(() => gate.consume(request.id, changed, subject), error => error.code === 'BINDING_MISMATCH');
assert.equal(gate.inspect(request.id).state, 'approved');
const permit = gate.consume(request.id, call, subject);
assert.equal(permit.toolId, 'mail.send');
assert.throws(() => gate.consume(request.id, call, subject), error => error.code === 'ALREADY_CONSUMED');
const expired = gate.preflight(call, subject);
now += 600_000;
assert.equal(gate.inspect(expired.id).state, 'expired');
console.log('Example passed: approval binding, modified arguments, single consume, and exact expiry.');
console.log(JSON.stringify({ actionId: permit.actionId, toolId: permit.toolId, state: gate.inspect(request.id).state, auditEvents: gate.audit().length }, null, 2));
// This example intentionally does not send email or execute any external operation.
