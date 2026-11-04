import { describe, expect, it } from 'vitest';

import {
    FRAMEWORK_NAMESPACE,
    MAX_CUSTOM_ID_LENGTH,
    RESERVED_ACTION_PREFIX,
    RESERVED_NAMESPACES,
    assertUserNamespace,
    assertValidAction,
    assertValidNamespace,
    createCustomId,
    createReservedAction,
    generateRoutingId,
    isReservedAction,
    parseCustomId,
    splitAction,
} from '../../src/ui/ids';

describe('custom ids', () => {
    it('mints ids in the documented shape', () => {
        expect(createCustomId('ui', 'abc123', 'confirm')).toBe(
            'ui:abc123:confirm',
        );
    });

    it('round-trips through the parser', () => {
        const parsed = parseCustomId('ui:abc123:confirm');

        expect(parsed).toEqual({
            namespace: 'ui',
            widgetId: 'abc123',
            action: 'confirm',
        });
    });

    it('keeps separators inside the action segment', () => {
        const parsed = parseCustomId('ui:abc123:choice:apple');

        expect(parsed?.action).toBe('choice:apple');
    });

    it('rejects ids that do not have three segments', () => {
        expect(parseCustomId('ui:abc123')).toBeNull();
        expect(parseCustomId('ui::confirm')).toBeNull();
        expect(parseCustomId('ui:abc123:')).toBeNull();
        expect(parseCustomId('')).toBeNull();
    });

    it('rejects namespaces containing the separator', () => {
        expect(() => assertValidNamespace('a:b')).toThrow(TypeError);
        expect(() => createCustomId('a:b', 'abc', 'confirm')).toThrow(
            TypeError,
        );
    });

    it('rejects actions containing the reserved marker', () => {
        expect(() => assertValidAction(`x${RESERVED_ACTION_PREFIX}`)).toThrow(
            TypeError,
        );
        expect(() => assertValidAction('')).toThrow(TypeError);
    });

    it('allows colons inside user actions', () => {
        expect(() => assertValidAction('choice:apple')).not.toThrow();
    });

    it('rejects custom ids longer than the Discord limit', () => {
        expect(() =>
            createCustomId('ui', 'abc', 'a'.repeat(MAX_CUSTOM_ID_LENGTH)),
        ).toThrow(RangeError);
    });

    it('splits reserved actions from user actions', () => {
        expect(splitAction('confirm')).toEqual({
            reserved: false,
            name: 'confirm',
        });

        expect(splitAction(createReservedAction('next'))).toEqual({
            reserved: true,
            name: 'next',
        });
    });

    it('reports whether an action is reserved', () => {
        expect(isReservedAction('~next')).toBe(true);
        expect(isReservedAction('next')).toBe(false);
    });
});

describe('routing ids', () => {
    it('generates short, lowercase, alphanumeric ids', () => {
        const id = generateRoutingId();

        expect(id).toHaveLength(10);
        expect(id).toMatch(/^[0-9a-z]+$/);
    });

    it('generates ids of the requested length', () => {
        expect(generateRoutingId(12)).toHaveLength(12);
    });

    it('rejects a non-positive length', () => {
        expect(() => generateRoutingId(0)).toThrow(RangeError);
        expect(() => generateRoutingId(1.5)).toThrow(RangeError);
    });

    it('generates different ids', () => {
        const ids = new Set(
            Array.from({ length: 50 }, () => generateRoutingId()),
        );

        expect(ids.size).toBe(50);
    });
});

describe('namespaces', () => {
    it('reserves the framework namespace', () => {
        expect(FRAMEWORK_NAMESPACE).toBe('ui');
        expect(RESERVED_NAMESPACES).toContain('ui');
    });

    it('refuses to let a user take a reserved namespace', () => {
        expect(() => assertUserNamespace('ui')).toThrow(TypeError);
        expect(() => assertUserNamespace('app')).not.toThrow();
    });
});
