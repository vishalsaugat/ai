import { z } from 'zod';

/**
 * Used to mark validator functions so we can support both Zod and custom schemas.
 */
export const validatorSymbol = Symbol('vercel.ai.validator');

export type Validator<OBJECT = unknown> = {
  /**
   * Used to mark validator functions so we can support both Zod and custom schemas.
   */
  [validatorSymbol]: true;

  /**
   * Optional. Validates that the structure of a value matches this schema,
   * and returns a typed version of the value if it does.
   */
  readonly validate?: (
    value: unknown,
  ) => { success: true; value: OBJECT } | { success: false; error: Error };
};

/**
 * Create a validator.
 *
 * @param validate A validation function for the schema.
 */
export function validator<OBJECT>(
  validate: (
    value: unknown,
  ) => { success: true; value: OBJECT } | { success: false; error: Error },
): Validator<OBJECT> {
  return { [validatorSymbol]: true, validate };
}

export function isValidator(value: unknown): value is Validator {
  return (
    typeof value === 'object' &&
    value !== null &&
    validatorSymbol in value &&
    value[validatorSymbol] === true &&
    'validate' in value
  );
}

export function zodValidator<OBJECT>(
  zodSchema: z.Schema<OBJECT>,
): Validator<OBJECT> {
  return validator(value => {
    const result = zodSchema.safeParse(value);
    return result.success
      ? { success: true, value: result.data }
      : { success: false, error: result.error };
  });
}
