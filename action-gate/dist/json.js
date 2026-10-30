export const JSON_LIMITS = Object.freeze({ depth: 16, nodes: 10_000, bytes: 131_072 });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
/** Strict JSON canonicalization: sorted object keys, original array order, finite values only. */
export function canonicalize(value) {
    const ancestors = new Set();
    let nodes = 0;
    function visit(input, depth) {
        if (++nodes > JSON_LIMITS.nodes || depth > JSON_LIMITS.depth)
            throw new TypeError('参数超出 JSON 深度或节点限制');
        if (input === null)
            return 'null';
        if (typeof input === 'string' || typeof input === 'boolean')
            return JSON.stringify(input);
        if (typeof input === 'number') {
            if (!Number.isFinite(input))
                throw new TypeError('参数包含非有限数值');
            return JSON.stringify(input);
        }
        if (typeof input !== 'object')
            throw new TypeError('参数必须是严格 JSON，不能包含 undefined、函数、Symbol 或 BigInt');
        if (ancestors.has(input))
            throw new TypeError('参数包含循环引用');
        if (Object.getOwnPropertySymbols(input).length)
            throw new TypeError('参数不能包含 Symbol 字段');
        const proto = Object.getPrototypeOf(input);
        if (Array.isArray(input) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
            throw new TypeError('参数只接受普通 JSON 对象和数组');
        ancestors.add(input);
        const descriptors = Object.getOwnPropertyDescriptors(input);
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (forbidden.has(key))
                throw new TypeError(`参数含禁止字段：${key}`);
            if ('get' in descriptor || 'set' in descriptor)
                throw new TypeError('参数不能包含访问器');
            if (!descriptor.enumerable && !(Array.isArray(input) && key === 'length'))
                throw new TypeError('参数不能包含不可枚举字段');
        }
        let output;
        if (Array.isArray(input)) {
            if (Object.keys(input).length !== input.length)
                throw new TypeError('参数数组不能稀疏或包含自定义字段');
            const values = [];
            for (let index = 0; index < input.length; index++) {
                const descriptor = descriptors[String(index)];
                if (!descriptor)
                    throw new TypeError('参数数组不能包含空洞');
                values.push(visit(descriptor.value, depth + 1));
            }
            output = `[${values.join(',')}]`;
        }
        else {
            output = `{${Object.keys(descriptors).sort().map(key => `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1)}`).join(',')}}`;
        }
        ancestors.delete(input);
        return output;
    }
    const output = visit(value, 0);
    if (new TextEncoder().encode(output).byteLength > JSON_LIMITS.bytes)
        throw new TypeError('参数超过 128 KiB 上限');
    return output;
}
export function freezeDeep(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}
export function safeClone(value) { return JSON.parse(canonicalize(value)); }
/** Deliberately small schema subset. Objects always reject undeclared fields. */
export function validateArguments(value, schema) {
    const issues = [];
    function visit(input, rule, path) {
        const fail = (code) => { issues.push({ path, code }); };
        if (rule.type === 'object') {
            if (input === null || typeof input !== 'object' || Array.isArray(input)) {
                fail('OBJECT_REQUIRED');
                return;
            }
            const object = input;
            for (const key of rule.required)
                if (!Object.hasOwn(object, key))
                    issues.push({ path: `${path}.${key}`, code: 'REQUIRED' });
            for (const key of Object.keys(object)) {
                if (!Object.hasOwn(rule.properties, key)) {
                    issues.push({ path: `${path}.${key}`, code: 'UNKNOWN_FIELD' });
                    continue;
                }
                visit(object[key], rule.properties[key], `${path}.${key}`);
            }
        }
        else if (rule.type === 'array') {
            if (!Array.isArray(input)) {
                fail('ARRAY_REQUIRED');
                return;
            }
            if (input.length < (rule.minItems ?? 0) || input.length > rule.maxItems)
                fail('ARRAY_LENGTH');
            input.forEach((child, index) => visit(child, rule.items, `${path}[${index}]`));
        }
        else if (rule.type === 'string') {
            if (typeof input !== 'string') {
                fail('STRING_REQUIRED');
                return;
            }
            if (input.length < (rule.minLength ?? 0) || input.length > (rule.maxLength ?? 4096))
                fail('STRING_LENGTH');
            if (rule.enum && !rule.enum.includes(input))
                fail('ENUM');
        }
        else if (rule.type === 'boolean') {
            if (typeof input !== 'boolean')
                fail('BOOLEAN_REQUIRED');
        }
        else {
            if (typeof input !== 'number' || !Number.isFinite(input)) {
                fail('NUMBER_REQUIRED');
                return;
            }
            if (rule.type === 'integer' && !Number.isInteger(input))
                fail('INTEGER_REQUIRED');
            if (rule.minimum !== undefined && input < rule.minimum || rule.maximum !== undefined && input > rule.maximum)
                fail('NUMBER_RANGE');
        }
    }
    visit(value, schema, '$');
    return freezeDeep(issues);
}
export function validateSchema(schema) {
    canonicalize(schema);
    const check = (rule, depth) => {
        if (depth > 12)
            throw new TypeError('工具参数 schema 嵌套过深');
        if (!rule || typeof rule !== 'object' || !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(rule.type))
            throw new TypeError('工具参数 schema 类型不受支持');
        if (rule.type === 'object') {
            if (!rule.properties || !Array.isArray(rule.required))
                throw new TypeError('对象 schema 需 properties 与 required');
            for (const key of rule.required)
                if (!Object.hasOwn(rule.properties, key))
                    throw new TypeError('required 字段未声明');
            for (const child of Object.values(rule.properties))
                check(child, depth + 1);
        }
        else if (rule.type === 'array') {
            if (!Number.isInteger(rule.maxItems) || rule.maxItems < 0 || rule.maxItems > 10_000 || rule.minItems !== undefined && (!Number.isInteger(rule.minItems) || rule.minItems < 0 || rule.minItems > rule.maxItems))
                throw new TypeError('数组 schema 数量上下限无效');
            check(rule.items, depth + 1);
        }
        else if (rule.type === 'string') {
            if (rule.minLength !== undefined && (!Number.isInteger(rule.minLength) || rule.minLength < 0) || rule.maxLength !== undefined && (!Number.isInteger(rule.maxLength) || rule.maxLength < (rule.minLength ?? 0)) || (rule.minLength ?? 0) > (rule.maxLength ?? 4096))
                throw new TypeError('字符串 schema 长度无效');
            if (rule.enum && (!Array.isArray(rule.enum) || rule.enum.some(item => typeof item !== 'string')))
                throw new TypeError('字符串 enum 无效');
        }
        else if (rule.type === 'number' || rule.type === 'integer') {
            if (rule.minimum !== undefined && !Number.isFinite(rule.minimum) || rule.maximum !== undefined && !Number.isFinite(rule.maximum) || rule.minimum !== undefined && rule.maximum !== undefined && rule.minimum > rule.maximum)
                throw new TypeError('数值 schema 上下限无效');
        }
    };
    check(schema, 0);
}
export function valueAtPath(value, path) {
    let cursor = value;
    for (const key of path) {
        if (forbidden.has(key) || cursor === null || typeof cursor !== 'object' || Array.isArray(cursor) || !Object.hasOwn(cursor, key))
            return undefined;
        cursor = cursor[key];
    }
    return cursor;
}
/** Preview is useful to a reviewer; audit logs never include this object. */
export function redactArguments(value, schema) {
    if (schema.sensitive)
        return '[已隐藏]';
    if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            output[key] = /password|token|secret|authorization|credential|api.?key/i.test(key) ? '[已隐藏]' : redactArguments(child, schema.properties[key]);
        }
        return freezeDeep(output);
    }
    if (schema.type === 'array' && Array.isArray(value))
        return freezeDeep(value.map(item => redactArguments(item, schema.items)));
    return value;
}
//# sourceMappingURL=json.js.map