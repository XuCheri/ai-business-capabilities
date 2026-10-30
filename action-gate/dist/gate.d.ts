import type { ArgumentSchema, JsonValue, ValidationIssue } from './json.js';
export type ToolRisk = 'read' | 'write' | 'external' | 'destructive';
export type Decision = 'allow' | 'deny' | 'approval-required';
export type ActionState = Decision | 'approved' | 'rejected' | 'consumed' | 'expired';
/** Must come from authenticated application context, never from model arguments. */
export interface Principal {
    readonly id: string;
    readonly tenantId: string;
    readonly roles: readonly string[];
}
export interface ToolDefinition {
    readonly id: string;
    readonly version: string;
    readonly label: string;
    readonly risk: ToolRisk;
    readonly schema: ArgumentSchema;
    readonly requesterRoles: readonly string[];
    readonly approverRoles: readonly string[];
    readonly tenantArgumentPath: readonly string[];
    readonly allowedTenants?: readonly string[];
}
export type Condition = {
    readonly path: readonly string[];
    readonly operator: 'equals' | 'not-equals';
    readonly value: string | number | boolean;
} | {
    readonly path: readonly string[];
    readonly operator: 'greater-than' | 'array-length-greater-than';
    readonly value: number;
} | {
    readonly path: readonly string[];
    readonly operator: 'in' | 'not-in';
    readonly value: readonly (string | number | boolean)[];
};
export interface PolicyRule {
    readonly id: string;
    readonly effect: Decision;
    readonly toolIds?: readonly string[];
    readonly risks?: readonly ToolRisk[];
    readonly rolesAny?: readonly string[];
    readonly conditions?: readonly Condition[];
}
export interface GatePolicy {
    readonly version: string;
    readonly ttlMs: number;
    readonly rules: readonly PolicyRule[];
}
export interface ToolCall {
    readonly toolId: string;
    readonly args: unknown;
}
export interface ActionRecord {
    readonly id: string;
    readonly toolId: string;
    readonly toolVersion: string | null;
    readonly risk: ToolRisk | null;
    readonly subject: Principal;
    readonly policyVersion: string;
    readonly state: ActionState;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly reasonCodes: readonly string[];
    readonly matchedRuleIds: readonly string[];
    readonly preview: JsonValue | null;
    readonly issues: readonly ValidationIssue[];
    readonly approvedBy: string | null;
    readonly approvedAt: number | null;
    readonly consumedAt: number | null;
}
export interface AuditEntry {
    readonly sequence: number;
    readonly at: number;
    readonly event: string;
    readonly actionId: string | null;
    readonly toolId: string | null;
    readonly actorId: string;
    readonly tenantId: string;
    readonly policyVersion: string;
    readonly state: ActionState | null;
    readonly code: string;
}
export interface ExecutionPermit {
    readonly actionId: string;
    readonly toolId: string;
    readonly toolVersion: string;
    readonly policyVersion: string;
    readonly subjectId: string;
    readonly tenantId: string;
    readonly consumedAt: number;
    /** Validated immutable snapshot: the adapter must execute these exact arguments. */
    readonly args: JsonValue;
}
export declare class GateError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface ActionGateOptions {
    readonly tools: readonly ToolDefinition[];
    readonly policy: GatePolicy;
    readonly now?: () => number;
    readonly idFactory?: () => string;
    readonly maxActions?: number;
}
/** In-memory reference gate. Sync consume is atomic only inside this one JS instance. */
export declare class ActionGate {
    #private;
    constructor(options: ActionGateOptions);
    get policyVersion(): string;
    get catalog(): readonly ToolDefinition[];
    preflight(input: ToolCall, context: Principal): ActionRecord;
    approve(id: string, context: Principal): ActionRecord;
    reject(id: string, context: Principal): ActionRecord;
    consume(id: string, input: ToolCall, context: Principal): ExecutionPermit;
    /** Intended for trusted backend/admin code; does not replace transport-level access control. */
    inspect(id: string): ActionRecord;
    list(): readonly ActionRecord[];
    audit(): readonly AuditEntry[];
    replacePolicy(input: GatePolicy): void;
}
