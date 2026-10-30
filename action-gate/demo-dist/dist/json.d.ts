export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type JsonObject = {
    readonly [key: string]: JsonValue;
};
export declare const JSON_LIMITS: Readonly<{
    depth: 16;
    nodes: 10000;
    bytes: 131072;
}>;
/** Strict JSON canonicalization: sorted object keys, original array order, finite values only. */
export declare function canonicalize(value: unknown): string;
export declare function freezeDeep<T>(value: T): T;
export declare function safeClone<T>(value: T): T;
interface SchemaBase {
    readonly sensitive?: boolean;
}
export type ArgumentSchema = SchemaBase & ({
    readonly type: 'string';
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly enum?: readonly string[];
} | {
    readonly type: 'number' | 'integer';
    readonly minimum?: number;
    readonly maximum?: number;
} | {
    readonly type: 'boolean';
} | {
    readonly type: 'array';
    readonly items: ArgumentSchema;
    readonly minItems?: number;
    readonly maxItems: number;
} | {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, ArgumentSchema>>;
    readonly required: readonly string[];
});
export interface ValidationIssue {
    readonly path: string;
    readonly code: string;
}
/** Deliberately small schema subset. Objects always reject undeclared fields. */
export declare function validateArguments(value: JsonValue, schema: ArgumentSchema): readonly ValidationIssue[];
export declare function validateSchema(schema: ArgumentSchema): void;
export declare function valueAtPath(value: JsonValue, path: readonly string[]): JsonValue | undefined;
/** Preview is useful to a reviewer; audit logs never include this object. */
export declare function redactArguments(value: JsonValue, schema: ArgumentSchema): JsonValue;
export {};
