import { describe, expect, it } from 'vitest';

import type { WidgetRouter } from '../src/ui/router';
import type { ButtonSpec } from '../src/ui/types';

/**
 * Compile-time regression tests.
 *
 * Two of the defects found in the second pass were hidden by an optional
 * parameter and a cast: a button could be rendered without the style
 * Discord requires, and a widget could be registered without a state. Both
 * are now compile errors, and `npm run typecheck` checks this file.
 *
 * The functions are never called; asserting that they are functions keeps
 * the file from being tree-shaken out of the type check.
 */
describe('type safety', () => {
    it('requires a button style', () => {
        const build = (): ButtonSpec =>
            // @ts-expect-error Discord requires the `style` field.
            ({ type: 'button', action: 'confirm', label: 'Confirm' });

        expect(build).toBeTypeOf('function');
    });

    it('requires a state at registration', () => {
        const call = (router: WidgetRouter): Promise<void> =>
            // @ts-expect-error The state is required: a widget always has one.
            router.register({
                id: 'widget',
                routingId: 'widget',
                render: () => ({ content: '' }),
            });

        expect(call).toBeTypeOf('function');
    });
});
