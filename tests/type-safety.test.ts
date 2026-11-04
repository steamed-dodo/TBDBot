import { describe, expect, it } from 'vitest';

import type { WidgetRouter } from '../src/ui/router';
import type { ButtonSpec } from '../src/ui/types';

/**
 * Compile-time regression tests.
 *
 * Two of the defects found in the second pass were hidden by an optional
 * parameter and a cast: a button could be rendered without the style
 * Discord requires, and a widget could be registered without a state. Both
 * are now compile errors.
 *
 * The assertions here run under `npm test` as part of the suite, but the
 * meaningful check is `tsc`: the `@ts-expect-error` comments fail the type
 * check if the corresponding mistake ever becomes legal again. The dummy
 * calls keep the file from being tree-shaken out of the type check.
 */
describe('type safety (checked by the type checker)', () => {
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
