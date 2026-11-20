declare module 'node:test' {
    export default function test(name: string, fn: () => void | Promise<void>): void;
    export { test };
}

declare module 'node:assert/strict' {
    const assert: {
        equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
        notEqual(actual: unknown, expected: unknown, message?: string): void;
        deepEqual<T>(actual: unknown, expected: T, message?: string): void;
        ok(value: unknown, message?: string): asserts value;
        match(value: string, regexp: RegExp, message?: string): void;
        throws(fn: () => unknown, error?: unknown, message?: string): void;
    };
    export default assert;
}
