import { canonicalize, freezeDeep, redactArguments, safeClone, validateArguments, validateSchema, valueAtPath } from './json.js';
import type { ArgumentSchema, JsonValue, ValidationIssue } from './json.js';

export type ToolRisk = 'read' | 'write' | 'external' | 'destructive';
export type Decision = 'allow' | 'deny' | 'approval-required';
export type ActionState = Decision | 'approved' | 'rejected' | 'consumed' | 'expired';
/** Must come from authenticated application context, never from model arguments. */
export interface Principal { readonly id: string; readonly tenantId: string; readonly roles: readonly string[] }
export interface ToolDefinition {
  readonly id: string; readonly version: string; readonly label: string; readonly risk: ToolRisk;
  readonly schema: ArgumentSchema;
  readonly requesterRoles: readonly string[]; readonly approverRoles: readonly string[];
  readonly tenantArgumentPath: readonly string[];
  readonly allowedTenants?: readonly string[];
}
export type Condition =
  | { readonly path: readonly string[]; readonly operator: 'equals' | 'not-equals'; readonly value: string | number | boolean }
  | { readonly path: readonly string[]; readonly operator: 'greater-than' | 'array-length-greater-than'; readonly value: number }
  | { readonly path: readonly string[]; readonly operator: 'in' | 'not-in'; readonly value: readonly (string | number | boolean)[] };
export interface PolicyRule {
  readonly id: string; readonly effect: Decision;
  readonly toolIds?: readonly string[]; readonly risks?: readonly ToolRisk[]; readonly rolesAny?: readonly string[];
  readonly conditions?: readonly Condition[];
}
export interface GatePolicy { readonly version: string; readonly ttlMs: number; readonly rules: readonly PolicyRule[] }
export interface ToolCall { readonly toolId: string; readonly args: unknown }
export interface ActionRecord {
  readonly id: string; readonly toolId: string; readonly toolVersion: string | null; readonly risk: ToolRisk | null;
  readonly subject: Principal; readonly policyVersion: string; readonly state: ActionState;
  readonly createdAt: number; readonly expiresAt: number; readonly reasonCodes: readonly string[];
  readonly matchedRuleIds: readonly string[]; readonly preview: JsonValue | null;
  readonly issues: readonly ValidationIssue[];
  readonly approvedBy: string | null; readonly approvedAt: number | null; readonly consumedAt: number | null;
}
export interface AuditEntry {
  readonly sequence: number; readonly at: number; readonly event: string; readonly actionId: string | null;
  readonly toolId: string | null; readonly actorId: string; readonly tenantId: string; readonly policyVersion: string;
  readonly state: ActionState | null; readonly code: string;
}
export interface ExecutionPermit {
  readonly actionId: string; readonly toolId: string; readonly toolVersion: string; readonly policyVersion: string;
  readonly subjectId: string; readonly tenantId: string; readonly consumedAt: number;
  /** Validated immutable snapshot: the adapter must execute these exact arguments. */
  readonly args: JsonValue;
}
export class GateError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'GateError'; }
}
interface StoredAction { record: ActionRecord; canonicalArgs: string | null; binding: string | null }
const mutableStates = new Set<ActionState>(['allow', 'approval-required', 'approved']);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,127}$/;
function checkId(value: string, name: string): void { if (typeof value !== 'string' || !identifier.test(value)) throw new TypeError(`${name}必须为 1—128 位标识符`); }
function normalizePrincipal(principal: Principal): Principal {
  checkId(principal.id, '主体 ID'); checkId(principal.tenantId, '租户 ID');
  if (!Array.isArray(principal.roles) || principal.roles.length > 32) throw new TypeError('角色列表无效');
  for (const role of principal.roles) checkId(role, '角色');
  return freezeDeep({ id: principal.id, tenantId: principal.tenantId, roles: [...new Set(principal.roles)].sort() });
}
function normalizePolicy(policy: GatePolicy, tools: ReadonlyMap<string, ToolDefinition>): GatePolicy {
  const copy = safeClone(policy); checkId(copy.version, '策略版本');
  if (!Number.isSafeInteger(copy.ttlMs) || copy.ttlMs < 1000 || copy.ttlMs > 86_400_000) throw new TypeError('许可有效期必须在 1 秒至 24 小时之间');
  if (!Array.isArray(copy.rules) || copy.rules.length > 1000) throw new TypeError('策略规则数量无效');
  const ids = new Set<string>();
  for (const rule of copy.rules) {
    checkId(rule.id, '规则 ID'); if (ids.has(rule.id)) throw new TypeError('策略规则 ID 重复'); ids.add(rule.id);
    if (!['allow', 'deny', 'approval-required'].includes(rule.effect)) throw new TypeError('策略 effect 无效');
    for (const id of rule.toolIds ?? []) if (!tools.has(id)) throw new TypeError(`规则引用未注册工具：${id}`);
    for (const risk of rule.risks ?? []) if (!['read', 'write', 'external', 'destructive'].includes(risk)) throw new TypeError('规则 risk 无效');
    for (const role of rule.rolesAny ?? []) checkId(role, '规则角色');
    for (const condition of rule.conditions ?? []) {
      if (!condition.path.length || condition.path.some((key: string) => !identifier.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('规则路径无效');
      if (!['equals', 'not-equals', 'greater-than', 'array-length-greater-than', 'in', 'not-in'].includes(condition.operator)) throw new TypeError('规则操作符无效');
      if (condition.operator === 'greater-than' || condition.operator === 'array-length-greater-than') {
        if (!Number.isFinite(condition.value) || condition.operator === 'array-length-greater-than' && (!Number.isInteger(condition.value) || condition.value < 0)) throw new TypeError('规则阈值无效');
      }
      if ((condition.operator === 'in' || condition.operator === 'not-in') && (!Array.isArray(condition.value) || !condition.value.length)) throw new TypeError('规则集合不能为空');
    }
  }
  return freezeDeep(copy);
}
function matchesCondition(args: JsonValue, condition: Condition): boolean {
  const value = valueAtPath(args, condition.path);
  switch (condition.operator) {
    case 'equals': return value === condition.value;
    case 'not-equals': return value !== condition.value;
    case 'greater-than': return typeof value === 'number' && value > condition.value;
    case 'array-length-greater-than': return Array.isArray(value) && value.length > condition.value;
    case 'in': return condition.value.some(item => item === value);
    case 'not-in': return !condition.value.some(item => item === value);
  }
}
interface Assessment { decision: Decision; codes: string[]; rules: string[]; canonical: string | null; args: JsonValue | null; issues: readonly ValidationIssue[]; tool: ToolDefinition | null }
export interface ActionGateOptions {
  readonly tools: readonly ToolDefinition[]; readonly policy: GatePolicy;
  readonly now?: () => number; readonly idFactory?: () => string;
  readonly maxActions?: number;
}
/** Snapshot the call envelope before inspecting arguments; never invoke user-supplied accessors. */
function snapshotCall(input: ToolCall): ToolCall {
  if (input === null || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new GateError('INVALID_CALL', '工具调用必须是普通对象');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length || Object.keys(descriptors).length !== 2 || !descriptors.toolId || !descriptors.args || Object.values(descriptors).some(item => 'get' in item || 'set' in item || !item.enumerable)) throw new GateError('INVALID_CALL', '调用仅支持 toolId 与 args 数据字段，不能包含访问器');
  const toolId: unknown = descriptors.toolId.value;
  if (typeof toolId !== 'string') throw new GateError('INVALID_CALL', 'toolId 必须是字符串');
  checkId(toolId, '工具 ID');
  return { toolId, args: descriptors.args.value };
}
/** In-memory reference gate. Sync consume is atomic only inside this one JS instance. */
export class ActionGate {
  readonly #tools = new Map<string, ToolDefinition>();
  readonly #actions = new Map<string, StoredAction>();
  readonly #audit: AuditEntry[] = [];
  readonly #now: () => number;
  readonly #idFactory: () => string;
  readonly #maxActions: number;
  #policy: GatePolicy;
  #lastTime = Number.NEGATIVE_INFINITY;
  constructor(options: ActionGateOptions) {
    if (!options.tools.length) throw new TypeError('至少注册一个受控工具');
    for (const input of options.tools) {
      const tool = safeClone(input); checkId(tool.id, '工具 ID'); checkId(tool.version, '工具版本');
      if (this.#tools.has(tool.id)) throw new TypeError('工具 ID 重复');
      if (!tool.label || tool.label.length > 100) throw new TypeError('工具名称无效');
      if (!['read', 'write', 'external', 'destructive'].includes(tool.risk)) throw new TypeError('工具风险无效');
      if (!tool.requesterRoles.length || !tool.approverRoles.length) throw new TypeError('工具需明确请求与审批角色');
      for (const role of [...tool.requesterRoles, ...tool.approverRoles]) checkId(role, '工具角色');
      for (const tenant of tool.allowedTenants ?? []) checkId(tenant, '工具租户');
      if (!tool.tenantArgumentPath.length || tool.tenantArgumentPath.some(key => !identifier.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('工具需声明合法租户参数路径');
      if (tool.schema.type !== 'object') throw new TypeError('工具参数顶层必须为对象');
      validateSchema(tool.schema); this.#tools.set(tool.id, freezeDeep(tool));
    }
    this.#policy = normalizePolicy(options.policy, this.#tools);
    this.#now = options.now ?? (() => Date.now());
    this.#idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
    this.#maxActions = options.maxActions ?? 10_000;
    if (!Number.isSafeInteger(this.#maxActions) || this.#maxActions < 1 || this.#maxActions > 100_000) throw new TypeError('maxActions 必须为 1—100000 的整数');
  }
  get policyVersion(): string { return this.#policy.version; }
  get catalog(): readonly ToolDefinition[] { return Object.freeze([...this.#tools.values()]); }
  #clock(): number {
    const time = this.#now();
    if (!Number.isSafeInteger(time) || time < 0 || time > 8.64e15 || time < this.#lastTime) throw new GateError('CLOCK_INVALID', '业务时钟无效或发生回退');
    this.#lastTime = time; return time;
  }
  #log(at: number, event: string, record: ActionRecord | null, actor: Principal, code: string): void {
    this.#audit.push(freezeDeep({ sequence: this.#audit.length + 1, at, event, actionId: record?.id ?? null,
      toolId: record?.toolId ?? null, actorId: actor.id, tenantId: actor.tenantId, policyVersion: this.#policy.version,
      state: record?.state ?? null, code }));
  }
  #assessment(call: ToolCall, subject: Principal): Assessment {
    const tool = this.#tools.get(call.toolId) ?? null;
    const fail = (code: string, issues: readonly ValidationIssue[] = []): Assessment => ({ decision: 'deny', codes: [code], rules: [], canonical: null, args: null, issues, tool });
    if (!tool) return fail('UNKNOWN_TOOL');
    let canonical: string;
    try { canonical = canonicalize(call.args); } catch { return fail('INVALID_JSON'); }
    const args = JSON.parse(canonical) as JsonValue;
    const issues = validateArguments(args, tool.schema);
    if (issues.length) return fail('INVALID_ARGUMENTS', issues);
    if (!tool.requesterRoles.some(role => subject.roles.includes(role))) return fail('REQUESTER_ROLE_DENIED');
    if (tool.allowedTenants && !tool.allowedTenants.includes(subject.tenantId)) return fail('TOOL_TENANT_DENIED');
    if (valueAtPath(args, tool.tenantArgumentPath) !== subject.tenantId) return fail('ARGUMENT_TENANT_MISMATCH');
    const matches = this.#policy.rules.filter(rule =>
      (!rule.toolIds || rule.toolIds.includes(tool.id)) && (!rule.risks || rule.risks.includes(tool.risk)) &&
      (!rule.rolesAny || rule.rolesAny.some(role => subject.roles.includes(role))) &&
      (!rule.conditions || rule.conditions.every(condition => matchesCondition(args, condition))));
    const decisions = matches.map(rule => rule.effect);
    // Write/external/destructive calls always require approval; allow rules cannot lower this baseline.
    decisions.push(tool.risk === 'read' ? 'allow' : 'approval-required');
    const decision: Decision = decisions.includes('deny') ? 'deny' : decisions.includes('approval-required') ? 'approval-required' : 'allow';
    return { decision, codes: [decision === 'deny' ? 'POLICY_DENIED' : decision === 'approval-required' ? 'APPROVAL_NEEDED' : 'READ_ALLOWED'], rules: matches.map(rule => rule.id), canonical, args, issues: [], tool };
  }
  #binding(record: Pick<ActionRecord, 'toolId' | 'toolVersion' | 'policyVersion' | 'subject' | 'expiresAt'>, canonicalArgs: string): string {
    return JSON.stringify({ toolId: record.toolId, toolVersion: record.toolVersion, policyVersion: record.policyVersion,
      subject: record.subject, expiresAt: record.expiresAt, canonicalArgs });
  }
  preflight(input: ToolCall, context: Principal): ActionRecord {
    const call = snapshotCall(input);
    const subject = normalizePrincipal(context), at = this.#clock();
    checkId(call.toolId, '工具 ID');
    if (this.#actions.size >= this.#maxActions) throw new GateError('CAPACITY_EXCEEDED', '达到单实例记录上限，请归档后建立新实例');
    const assessment = this.#assessment(call, subject);
    const id = this.#idFactory(); checkId(id, '请求 ID');
    if (this.#actions.has(id)) throw new GateError('DUPLICATE_ID', '请求 ID 生成器产生重复值');
    const record: ActionRecord = freezeDeep({ id, toolId: call.toolId, toolVersion: assessment.tool?.version ?? null, risk: assessment.tool?.risk ?? null,
      subject, policyVersion: this.#policy.version, state: assessment.decision, createdAt: at, expiresAt: at + this.#policy.ttlMs,
      reasonCodes: assessment.codes, matchedRuleIds: assessment.rules,
      preview: assessment.args !== null && assessment.tool ? redactArguments(assessment.args, assessment.tool.schema) : null,
      issues: assessment.issues, approvedBy: null, approvedAt: null, consumedAt: null });
    this.#actions.set(id, { record, canonicalArgs: assessment.canonical, binding: assessment.canonical !== null ? this.#binding(record, assessment.canonical) : null });
    this.#log(at, 'preflight', record, subject, assessment.codes[0]!); return record;
  }
  #load(id: string, at: number): StoredAction {
    const stored = this.#actions.get(id);
    if (!stored) throw new GateError('ACTION_NOT_FOUND', '找不到此请求，不能跨实例复用许可');
    if (mutableStates.has(stored.record.state) && at >= stored.record.expiresAt) {
      stored.record = freezeDeep({ ...stored.record, state: 'expired', reasonCodes: ['EXPIRED'] });
      this.#log(at, 'expired', stored.record, stored.record.subject, 'EXPIRED');
    }
    return stored;
  }
  #refuse(stored: StoredAction, at: number, actor: Principal, code: string, message: string): never {
    this.#log(at, 'rejected-attempt', stored.record, actor, code); throw new GateError(code, message);
  }
  #approver(stored: StoredAction, actor: Principal, at: number): void {
    const record = stored.record;
    if (record.state !== 'approval-required') this.#refuse(stored, at, actor, 'INVALID_STATE', `当前状态 ${record.state} 不接受审批`);
    if (actor.id === record.subject.id) this.#refuse(stored, at, actor, 'SELF_APPROVAL_DENIED', '申请人与审批人不能相同');
    if (actor.tenantId !== record.subject.tenantId) this.#refuse(stored, at, actor, 'APPROVER_TENANT_MISMATCH', '审批人必须属于同一租户');
    const tool = this.#tools.get(record.toolId)!;
    if (!tool.approverRoles.some(role => actor.roles.includes(role))) this.#refuse(stored, at, actor, 'APPROVER_ROLE_DENIED', '审批人不具备该工具的审批角色');
    if (record.policyVersion !== this.#policy.version) this.#refuse(stored, at, actor, 'POLICY_CHANGED', '策略版本已变更，请重新预检');
  }
  approve(id: string, context: Principal): ActionRecord {
    const actor = normalizePrincipal(context), at = this.#clock(), stored = this.#load(id, at); this.#approver(stored, actor, at);
    stored.record = freezeDeep({ ...stored.record, state: 'approved', approvedBy: actor.id, approvedAt: at, reasonCodes: ['HUMAN_APPROVED'] });
    this.#log(at, 'approved', stored.record, actor, 'HUMAN_APPROVED'); return stored.record;
  }
  reject(id: string, context: Principal): ActionRecord {
    const actor = normalizePrincipal(context), at = this.#clock(), stored = this.#load(id, at); this.#approver(stored, actor, at);
    stored.record = freezeDeep({ ...stored.record, state: 'rejected', reasonCodes: ['HUMAN_REJECTED'] });
    this.#log(at, 'rejected', stored.record, actor, 'HUMAN_REJECTED'); return stored.record;
  }
  consume(id: string, input: ToolCall, context: Principal): ExecutionPermit {
    const call = snapshotCall(input);
    const subject = normalizePrincipal(context), at = this.#clock(), stored = this.#load(id, at), record = stored.record;
    if (record.state === 'consumed') this.#refuse(stored, at, subject, 'ALREADY_CONSUMED', '执行许可已经消费，不能再次使用');
    if (record.state === 'expired') this.#refuse(stored, at, subject, 'EXPIRED', '执行许可已失效，请重新预检');
    if (record.state !== 'allow' && record.state !== 'approved') this.#refuse(stored, at, subject, 'NOT_AUTHORIZED', '请求未获许可，不能消费');
    if (record.policyVersion !== this.#policy.version) this.#refuse(stored, at, subject, 'POLICY_CHANGED', '策略已变更，请重新预检');
    const assessment = this.#assessment(call, subject);
    if (!assessment.canonical || !assessment.tool || assessment.decision === 'deny') this.#refuse(stored, at, subject, 'REVALIDATION_DENIED', '当前工具、参数、租户或角色不再满足授权条件');
    if (assessment.decision === 'approval-required' && record.state !== 'approved') this.#refuse(stored, at, subject, 'APPROVAL_NEEDED', '当前工具需要人工审批，直接放行许可不能替代审批');
    const binding = this.#binding({ ...record, toolId: call.toolId, toolVersion: assessment.tool!.version, subject }, assessment.canonical!);
    if (binding !== stored.binding) this.#refuse(stored, at, subject, 'BINDING_MISMATCH', '主体、角色、工具或参数已改变；原审批不能复用，请重新预检');
    // No await or external side effects occur between checking and marking consumed.
    stored.record = freezeDeep({ ...record, state: 'consumed', consumedAt: at, reasonCodes: ['PERMIT_CONSUMED'] });
    this.#log(at, 'consumed', stored.record, subject, 'PERMIT_CONSUMED');
    return freezeDeep({ actionId: record.id, toolId: record.toolId, toolVersion: record.toolVersion!, policyVersion: record.policyVersion,
      subjectId: subject.id, tenantId: subject.tenantId, consumedAt: at, args: JSON.parse(stored.canonicalArgs!) as JsonValue });
  }
  /** Intended for trusted backend/admin code; does not replace transport-level access control. */
  inspect(id: string): ActionRecord { return this.#load(id, this.#clock()).record; }
  list(): readonly ActionRecord[] { const at = this.#clock(); return Object.freeze([...this.#actions.keys()].map(id => this.#load(id, at).record)); }
  audit(): readonly AuditEntry[] { return Object.freeze([...this.#audit]); }
  replacePolicy(input: GatePolicy): void {
    const next = normalizePolicy(input, this.#tools);
    if (next.version === this.#policy.version) throw new GateError('VERSION_UNCHANGED', '变更策略必须使用新的版本号');
    const at = this.#clock(); this.#policy = next;
    for (const stored of this.#actions.values()) if (mutableStates.has(stored.record.state)) {
      stored.record = freezeDeep({ ...stored.record, state: 'expired', reasonCodes: ['POLICY_CHANGED'] });
      this.#log(at, 'policy-invalidated', stored.record, stored.record.subject, 'POLICY_CHANGED');
    }
  }
}
