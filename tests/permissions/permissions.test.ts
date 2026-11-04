import { describe, expect, it } from 'vitest';

import {
    PermissionsBitField,
    parsePermissions,
    resolvePermissions,
} from '../../src/permissions/index';
import {
    createChannel,
    createGuild,
    createMember,
    createRole,
} from '../../src/testing/factories';

describe('permissions bitfield', () => {
    it('parses the string bitfields Discord sends', () => {
        expect(parsePermissions('2248473465835073')).toBe(
            2248473465835073n,
        );
        expect(parsePermissions(8)).toBe(8n);
        expect(parsePermissions(undefined)).toBe(0n);
        expect(parsePermissions('')).toBe(0n);
    });

    it('keeps 64-bit values intact', () => {
        const value = 1n << 63n;
        const field = new PermissionsBitField(value);

        expect(field.bitfield).toBe(value);
        expect(field.has(value)).toBe(true);
    });

    it('resolves flag names', () => {
        const field = new PermissionsBitField('Administrator');

        expect(field.has(PermissionsBitField.Flags.Administrator)).toBe(true);
        expect(field.has('ManageGuild')).toBe(false);
    });

    it('adds and removes permissions', () => {
        const field = new PermissionsBitField(0n);

        field.add(PermissionsBitField.Flags.SendMessages);
        expect(field.has('SendMessages')).toBe(true);

        field.remove(PermissionsBitField.Flags.SendMessages);
        expect(field.has('SendMessages')).toBe(false);
        expect(field.isEmpty()).toBe(true);
    });

    it('lists the permissions it holds', () => {
        const field = new PermissionsBitField(
            PermissionsBitField.Flags.ViewChannel |
                PermissionsBitField.Flags.SendMessages,
        );

        expect(field.toArray().sort()).toEqual(['SendMessages', 'ViewChannel']);
    });

    it('compares bitfields', () => {
        const field = new PermissionsBitField(8n);

        expect(field.equals(8n)).toBe(true);
        expect(field.equals(16n)).toBe(false);
    });
});

describe('permission resolution', () => {
    const guild = createGuild({ id: 'guild-1', owner_id: 'owner-1' });

    it('grants everything to the guild owner', () => {
        const result = resolvePermissions({
            guild,
            roles: [createRole({ id: 'guild-1', permissions: '0' })],
            member: createMember({
                user: { id: 'owner-1' },
                roles: [],
            }),
        });

        expect(result.administrator).toBe(true);
        expect(result.channel.bitfield).toBe(PermissionsBitField.All);
    });

    it('grants everything to an administrator', () => {
        const result = resolvePermissions({
            guild,
            roles: [
                createRole({
                    id: 'guild-1',
                    permissions: PermissionsBitField.Flags.Administrator.toString(),
                }),
            ],
            member: createMember({ user: { id: 'user-1' }, roles: [] }),
        });

        expect(result.administrator).toBe(true);
    });

    it('adds the permissions of the roles the member holds', () => {
        const result = resolvePermissions({
            guild,
            roles: [
                createRole({ id: 'guild-1', permissions: '1024' }),
                createRole({ id: 'role-1', permissions: '2048' }),
            ],
            member: createMember({ user: { id: 'user-1' }, roles: ['role-1'] }),
        });

        expect(result.guild.has('ViewChannel')).toBe(true);
        expect(result.guild.has('SendMessages')).toBe(true);
        expect(result.guild.has('ManageGuild')).toBe(false);
    });

    it('applies the everyone overwrite first', () => {
        const result = resolvePermissions({
            guild,
            roles: [createRole({ id: 'guild-1', permissions: '2048' })],
            member: createMember({ user: { id: 'user-1' }, roles: [] }),
            channel: createChannel({
                id: 'channel-1',
                permission_overwrites: [
                    {
                        id: 'guild-1',
                        type: 0,
                        allow: '0',
                        deny: '2048',
                    },
                ],
            }),
        });

        expect(result.channel.has('SendMessages')).toBe(false);
    });

    it('unions the role overwrites before the member overwrite', () => {
        const result = resolvePermissions({
            guild,
            roles: [
                createRole({ id: 'guild-1', permissions: '0' }),
                createRole({ id: 'role-1', permissions: '0' }),
            ],
            member: createMember({ user: { id: 'user-1' }, roles: ['role-1'] }),
            channel: createChannel({
                id: 'channel-1',
                permission_overwrites: [
                    { id: 'role-1', type: 0, allow: '2048', deny: '0' },
                    { id: 'user-1', type: 1, allow: '0', deny: '2048' },
                ],
            }),
        });

        expect(result.channel.has('SendMessages')).toBe(false);
    });

    it('lets the member overwrite win over the role overwrites', () => {
        const result = resolvePermissions({
            guild,
            roles: [
                createRole({ id: 'guild-1', permissions: '0' }),
                createRole({ id: 'role-1', permissions: '0' }),
            ],
            member: createMember({ user: { id: 'user-1' }, roles: ['role-1'] }),
            channel: createChannel({
                id: 'channel-1',
                permission_overwrites: [
                    { id: 'role-1', type: 0, allow: '0', deny: '2048' },
                    { id: 'user-1', type: 1, allow: '2048', deny: '0' },
                ],
            }),
        });

        expect(result.channel.has('SendMessages')).toBe(true);
    });

    it('ignores overwrites for roles the member does not hold', () => {
        const result = resolvePermissions({
            guild,
            roles: [createRole({ id: 'guild-1', permissions: '2048' })],
            member: createMember({ user: { id: 'user-1' }, roles: [] }),
            channel: createChannel({
                id: 'channel-1',
                permission_overwrites: [
                    { id: 'role-1', type: 0, allow: '0', deny: '2048' },
                ],
            }),
        });

        expect(result.channel.has('SendMessages')).toBe(true);
    });
});
