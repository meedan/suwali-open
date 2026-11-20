import { describe, expect, it, vi } from 'vitest';

import type { FormValidationRules } from './forms';
import { normalizeUrl, validateEmail, validateField, validateForm } from './forms';

const buildRules = (overrides: Partial<FormValidationRules[number]> = {}): FormValidationRules => [
  {
    id: 'email',
    value: '',
    setter: vi.fn(),
    validator: validateEmail,
    errorMessage: 'Please provide a valid email address',
    requiredMessage: 'Email is required',
    ...overrides,
  },
];

describe('validateForm', () => {
  it('sets and returns the required message when a required value is empty', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: '', setter });

    const errors = validateForm(rules);

    expect(errors).toEqual(['Email is required']);
    expect(setter).toHaveBeenCalledWith('Email is required');
  });

  it('sets and returns the error message when a value fails its validator', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: 'not-an-email', setter });

    const errors = validateForm(rules);

    expect(errors).toEqual(['Please provide a valid email address']);
    expect(setter).toHaveBeenCalledWith('Please provide a valid email address');
  });

  it('clears the error when the value passes its validator', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: 'test@example.com', setter });

    const errors = validateForm(rules);

    expect(errors).toEqual([]);
    expect(setter).toHaveBeenCalledWith('');
  });

  it('does not require a value when validateRequired is false', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: '', setter });

    const errors = validateForm(rules, false);

    expect(errors).toEqual([]);
    expect(setter).not.toHaveBeenCalled();
  });

  it('does not require a value when no requiredMessage is set', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: '', setter, requiredMessage: undefined });

    const errors = validateForm(rules);

    expect(errors).toEqual([]);
    expect(setter).not.toHaveBeenCalled();
  });
});

describe('validateField', () => {
  it('validates only the rule matching the given field id', () => {
    const emailSetter = vi.fn();
    const passwordSetter = vi.fn();
    const rules: FormValidationRules = [
      ...buildRules({ id: 'email', value: 'not-an-email', setter: emailSetter }),
      {
        id: 'password',
        value: '',
        setter: passwordSetter,
        validator: () => true,
        errorMessage: 'Password is invalid',
        requiredMessage: 'Password is required',
      },
    ];

    validateField(rules, 'email');

    expect(emailSetter).toHaveBeenCalledWith('Please provide a valid email address');
    expect(passwordSetter).not.toHaveBeenCalled();
  });

  it('does not report a required error for an empty field on blur', () => {
    const setter = vi.fn();
    const rules = buildRules({ value: '', setter });

    const errors = validateField(rules, 'email');

    expect(errors).toEqual([]);
    expect(setter).not.toHaveBeenCalled();
  });

  it('returns an empty array when no rule matches the field id', () => {
    const rules = buildRules();

    expect(validateField(rules, 'unknown-field')).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it.each([
    ['https://example.com/help', 'https://example.com/help'],
    ['example.com', 'https://example.com'],
    ['  www.example.com/help?a=1 ', 'https://www.example.com/help?a=1'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://192.168.0.1:8080/feed', 'http://192.168.0.1:8080/feed'],
    ['https://bücher.example/', 'https://bücher.example/'],
  ])('gives %s as an address to use', (typed, normalized) => {
    expect(normalizeUrl(typed)).toBe(normalized);
  });

  it.each(['', 'asdf', 'www.google,asdf', 'example.c', 'a..com', '-a.com', 'ftp://example.com', 'mailto:help@example.com', 'exa mple.com'])('does not take %s', (typed) => {
    expect(normalizeUrl(typed)).toBeNull();
  });
});
