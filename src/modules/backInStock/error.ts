export type BackInStockErrorCode =
  | 'VALIDATION'
  | 'HTTP'
  | 'TIMEOUT'
  | 'NETWORK';

export interface BackInStockFieldErrors {
  name?: 'required';
  phone?: 'invalid';
  skuId?: 'required';
}

export interface BackInStockErrorDetails {
  skuId?: string;
  status?: number;
  attempt?: number;
  fields?: BackInStockFieldErrors;
}

/**
 * Failure of a back-in-stock subscribe call.
 * `fields` carries codes only. Name and phone never appear here.
 */
export class BackInStockError extends Error {
  readonly code: BackInStockErrorCode;

  readonly skuId: string;

  readonly status?: number;

  readonly attempt?: number;

  readonly fields?: BackInStockFieldErrors;

  constructor(
    code: BackInStockErrorCode,
    details: BackInStockErrorDetails = {},
  ) {
    super(code);
    this.name = 'BackInStockError';
    this.code = code;
    this.skuId = details.skuId ?? '';
    this.status = details.status;
    this.attempt = details.attempt;
    this.fields = details.fields;
  }
}
