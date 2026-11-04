import { ButtonStyle } from 'discord-api-types/v10';

import { createReservedAction } from '../ids';
import { navigationSelect } from '../render';
import type { ActionContext, ComponentRow } from '../types';
import { Flow } from './Flow';
import type { FlowState, MenuNavigation, MenuOptions } from './types';

/**
 * A linear, paginated menu.
 *
 * The menu traverses its steps in order: the navigation chrome offers a
 * previous and a next step, and the step select jumps straight to one of
 * them. This is deliberately a *different class* from
 * {@link Wizard} rather than one class with a mode flag — the difference is
 * in the state transitions, and nothing else.
 */
export class Menu extends Flow<FlowState> {
    /** Navigation chrome rendered alongside the active step. */
    public readonly navigation: MenuNavigation;

    /**
     * @param options - Menu configuration.
     */
    constructor(options: MenuOptions) {
        super(options);

        this.navigation = options.navigation ?? 'prev-next';
    }

    /**
     * Computes the state that follows a navigation action.
     *
     * @param state - The state the menu currently holds.
     * @param action - The reserved action, without the marker.
     * @param context - Context describing the triggering interaction.
     * @returns The next state, or `null` when the action changes nothing.
     */
    protected nextState(
        state: FlowState,
        action: string,
        context: ActionContext<FlowState>,
    ): FlowState | null {
        if (action === 'select') {
            return this.jumpTo(context.values[0], state);
        }

        if (action === 'next') {
            const next = this.steps[this.indexOf(state.currentStepId) + 1];

            return next ? this.moveTo(state, next.id) : null;
        }

        if (action === 'previous') {
            const previous = this.steps[this.indexOf(state.currentStepId) - 1];

            return previous ? this.moveTo(state, previous.id) : null;
        }

        if (action.startsWith('choice:')) {
            const value = action.slice('choice:'.length);
            const choice = this.findChoice(state, value);

            if (!choice) {
                return null;
            }

            if (choice.next === null) {
                return { ...state, completed: true };
            }

            if (choice.next !== undefined) {
                return this.moveTo(state, choice.next);
            }

            const step = this.stepOf(state.currentStepId);
            const next = step.next;

            if (next === null) {
                return { ...state, completed: true };
            }

            if (next !== undefined) {
                return this.moveTo(state, next);
            }

            const following = this.steps[this.indexOf(state.currentStepId) + 1];

            return following ? this.moveTo(state, following.id) : null;
        }

        return null;
    }

    /**
     * Builds the navigation chrome rendered alongside the active step.
     *
     * @param state - The state the menu currently holds.
     * @returns The chrome rows.
     */
    protected chromeRows(state: FlowState): ComponentRow[] {
        const rows: ComponentRow[] = [];
        const index = this.indexOf(state.currentStepId);
        const isFirst = index <= 0;
        const isLast = index === this.steps.length - 1;

        if (
            this.navigation === 'prev-next' ||
            this.navigation === 'prev-select-next'
        ) {
            rows.push([
                {
                    type: 'button',
                    action: createReservedAction('previous'),
                    reserved: true,
                    label: 'Previous',
                    style: ButtonStyle.Secondary,
                    disabled: isFirst,
                },
                {
                    type: 'button',
                    action: createReservedAction('next'),
                    reserved: true,
                    label: 'Next',
                    style: ButtonStyle.Secondary,
                    disabled: isLast,
                },
            ]);
        }

        if (
            this.navigation === 'select' ||
            this.navigation === 'prev-select-next'
        ) {
            rows.push([
                navigationSelect(
                    'select',
                    this.steps.map((step) => ({
                        label: step.id,
                        value: step.id,
                    })),
                    {
                        placeholder: 'Select a step',
                    },
                ),
            ]);
        }

        return rows;
    }

    private moveTo(state: FlowState, stepId: string): FlowState | null {
        if (!this.stepById.has(stepId)) {
            return null;
        }

        return {
            ...state,
            currentStepId: stepId,
            history: [...state.history, stepId],
        };
    }

    private jumpTo(
        stepId: string | undefined,
        state: FlowState,
    ): FlowState | null {
        if (!stepId) {
            return null;
        }

        if (stepId === state.currentStepId) {
            return null;
        }

        return this.moveTo(state, stepId);
    }
}
