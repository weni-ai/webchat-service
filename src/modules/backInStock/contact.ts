import { isValidPhoneNumber } from 'libphonenumber-js/max';

export interface BackInStockContactInput {
  name?: string;
  phone?: string;
}

export interface BackInStockContactErrors {
  name?: 'required';
  phone?: 'invalid';
}

export interface BackInStockContactResult {
  isValid: boolean;
  errors: BackInStockContactErrors;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Name must be non-empty after trim. Phone is the international number
 * as typed. Codes are stable so the widget can map them to its own copy.
 */
export function validateBackInStockContact(
  input: BackInStockContactInput = {},
): BackInStockContactResult {
  const errors: BackInStockContactErrors = {};
  const name = String(input.name ?? '').trim();
  const phoneDigits = digits(String(input.phone ?? ''));

  if (name === '') errors.name = 'required';
  if (phoneDigits === '' || !isValidPhoneNumber(`+${phoneDigits}`)) {
    errors.phone = 'invalid';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
