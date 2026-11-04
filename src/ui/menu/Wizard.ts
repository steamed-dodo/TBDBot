import { createReservedAction } from '../ids';
import type { ActionContext, ComponentRow } from '../types';
import { Flow } from './Flow';
import type { FlowState, StepContext, WizardOptions } from './types';

/**
 * A branching, choice-driven wizard.
 *
 * A wizard captures an answer per step, follows the `next` pointers of its
 * steps, and can go back — which clears the answers that were abandoned on
 * the way. It is a *different class* from {@link Menu} rather than one class
 * with a mode flag: the difference is in the state transitions, and nothing
 * else.
 */
export class Wizard extends Flow<FlowState> {
    private readonly wizardOptions: WizardOptions;

    /**
     * @param options - Wizard configuration.
     */
    constructor(options: WizardOptions) {
        super(options);

        this.wizardOptions = options;
    }

    /**
     * Computes the state that follows a navigation action.
     *
     * @param state - The state the wizard currently holds.
     * @param action - The reserved action, without the marker.
     * @param context - Context describing the triggering interaction.
     * @returns The next state, or `null` when the action changes nothing.
     */
    protected nextState(
        state: FlowState,
        action: string,
        context: ActionContext<FlowState>,
    ): FlowState | null {
        if (action === 'back') {
            return this.goBack(state);
        }

        if (action === 'select') {
            return this.jumpTo(context.values[0], state);
        }

        if (action === 'next') {
            const step = this.stepOf(state.currentStepId);
            const next = step.next;

            if (next === null) {
                return { ...state, completed: true };
            }

            if (next !== undefined) {
                return this.moveTo(state, next);
            }

            return { ...state, completed: true };
        }

        if (action.startsWith('choice:')) {
            const value = action.slice('choice:'.length);
            const choice = this.findChoice(state, value);

            if (!choice) {
                return null;
            }

            const step = this.stepOf(state.currentStepId);
            const answers = { ...state.answers, [step.id]: choice.value };
            const next = choice.next === undefined ? step.next : choice.next;

            if (next === null || next === undefined) {
                return { ...state, answers, completed: true };
            }

            return this.moveTo({ ...state, answers }, next);
        }

        return null;
    }

    /**
     * Builds the navigation chrome rendered alongside the active step.
     *
     * @param state - The state the wizard currently holds.
     * @returns The chrome rows.
     */
    protected chromeRows(state: FlowState): ComponentRow[] {
        return [
            [
                {
                    type: 'button',
                    action: createReservedAction('back'),
                    label: 'Back',
                    disabled: state.history.length < 2,
                },
            ],
        ];
    }

    /**
     * Called when the wizard completes.
     *
     * @param context - Context describing the completed wizard.
     */
    protected override async onComplete(
        context: StepContext<FlowState>,
    ): Promise<void> {
        await this.wizardOptions.onComplete?.(context);
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
        if (!stepId || stepId === state.currentStepId) {
            return null;
        }

        return this.moveTo(state, stepId);
    }

    private goBack(state: FlowState): FlowState | null {
        const history = [...state.history];
        const abandoned = history.pop();
        const previous = history[history.length - 1];

        if (!previous) {
            return null;
        }

        const answers = { ...state.answers };

        if (abandoned) {
            delete answers[abandoned];
        }

        delete answers[previous];

        return {
            ...state,
            currentStepId: previous,
            history,
            answers,
        };
    }
}
