import { validateBackInStockContact } from '../src/modules/backInStock/contact';

describe('validateBackInStockContact', () => {
  it('accepts a Brazilian mobile with separators or a leading plus', () => {
    expect(
      validateBackInStockContact({
        name: 'Ana',
        phone: '+55 (11) 98888-7777',
      }),
    ).toEqual({ isValid: true, errors: {} });

    expect(
      validateBackInStockContact({
        name: 'Ana',
        phone: '5511988887777',
      }).isValid,
    ).toBe(true);
  });

  it('rejects a short number, an empty calling code, and an empty national number', () => {
    expect(
      validateBackInStockContact({ name: 'Ana', phone: '+55 11 988' }).errors
        .phone,
    ).toBe('invalid');

    expect(
      validateBackInStockContact({ name: 'Ana', phone: '988887777' }).errors
        .phone,
    ).toBe('invalid');

    expect(
      validateBackInStockContact({ name: 'Ana', phone: '+55' }).errors.phone,
    ).toBe('invalid');

    expect(
      validateBackInStockContact({ name: 'Ana', phone: '' }).errors.phone,
    ).toBe('invalid');
  });

  it('requires a non-blank name', () => {
    expect(
      validateBackInStockContact({ name: '   ', phone: '5511988887777' }),
    ).toMatchObject({ isValid: false, errors: { name: 'required' } });

    expect(
      validateBackInStockContact({ name: '', phone: '5511988887777' }).errors
        .name,
    ).toBe('required');
  });
});
