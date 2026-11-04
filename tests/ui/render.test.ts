import { EmbedBuilder } from '@discordjs/builders';
import { ComponentType } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_ALLOWED_MENTIONS,
    MAX_ACTION_ROWS,
    button,
    navigationSelect,
    renderContent,
    select,
} from '../../src/ui/render';

describe('rendering pipeline', () => {
    it('mints framework owned custom ids', () => {
        const message = renderContent(
            { components: [[button('confirm', 'Confirm')]] },
            'ui',
            'abc123',
        );

        const row = message.components?.[0];

        expect(row?.type).toBe(ComponentType.ActionRow);
        expect(row?.components[0]?.custom_id).toBe('ui:abc123:confirm');
    });

    it('suppresses mentions by default', () => {
        const message = renderContent({ content: 'hello' }, 'ui', 'abc123');

        expect(message.allowed_mentions).toEqual(DEFAULT_ALLOWED_MENTIONS);
    });

    it('honours explicit allowed mentions', () => {
        const message = renderContent(
            { content: 'hello' },
            'ui',
            'abc123',
            { allowedMentions: { parse: ['users'] } },
        );

        expect(message.allowed_mentions).toEqual({ parse: ['users'] });
    });

    it('converts embeds to their API representation', () => {
        const embed = new EmbedBuilder().setTitle('Title').setDescription('Body');
        const message = renderContent({ embeds: [embed] }, 'ui', 'abc123');

        expect(message.embeds).toHaveLength(1);
        expect(message.embeds?.[0]?.title).toBe('Title');
    });

    it('rejects more than five action rows', () => {
        const rows = Array.from({ length: MAX_ACTION_ROWS + 1 }, () => [
            button('a', 'A'),
        ]);

        expect(() => renderContent({ components: rows }, 'ui', 'abc123')).toThrow(
            RangeError,
        );
    });

    it('rejects more than five components in a row', () => {
        const row = Array.from({ length: 6 }, (_, index) =>
            button(`a${index}`, `A${index}`),
        );

        expect(() =>
            renderContent({ components: [row] }, 'ui', 'abc123'),
        ).toThrow(RangeError);
    });

    it('rejects a select menu that shares its row', () => {
        expect(() =>
            renderContent(
                {
                    components: [
                        [
                            select('pick', [{ label: 'A', value: 'a' }]),
                            button('other', 'Other'),
                        ],
                    ],
                },
                'ui',
                'abc123',
            ),
        ).toThrow(TypeError);
    });

    it('rejects a select menu without options', () => {
        expect(() => select('pick', [])).toThrow(TypeError);
    });

    it('mints reserved actions for navigation selects', () => {
        const message = renderContent(
            {
                components: [
                    [
                        navigationSelect('select', [
                            { label: 'One', value: 'one' },
                        ]),
                    ],
                ],
            },
            'ui',
            'abc123',
        );

        const row = message.components?.[0];

        expect(row?.components[0]?.custom_id).toBe('ui:abc123:~select');
    });

    it('normalises a plain emoji name', () => {
        const message = renderContent(
            { components: [[button('a', 'A', { emoji: '🔥' })]] },
            'ui',
            'abc123',
        );

        const row = message.components?.[0];

        expect(row?.components[0]?.emoji).toEqual({ name: '🔥' });
    });

    it('omits empty embeds and components', () => {
        const message = renderContent({ content: 'hi' }, 'ui', 'abc123');

        expect(message.embeds).toBeUndefined();
        expect(message.components).toBeUndefined();
    });
});
