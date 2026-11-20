import { describe, expect, it } from 'vitest';

import { detectResourceType, getResourceIcon, normalizeResourceValue, splitPhone } from './externalResource';

describe('detectResourceType', () => {
  it.each([
    ['support@company.com', 'email'],
    ['+1-555-0100', 'phone'],
    ['https://help.example.com', 'link'],
    ['Help line', undefined],
  ])('guesses %s is %s', (title, type) => {
    expect(detectResourceType(title)).toBe(type);
  });
});

describe('getResourceIcon', () => {
  it('goes by the type when there is one, and by the title when there is not', () => {
    expect(getResourceIcon({ resource_type: 'question', title: 'support@company.com' })).toBe('question');
    expect(getResourceIcon({ title: 'support@company.com' })).toBe('envelope');
    expect(getResourceIcon({ title: 'Help line' })).toBe('question');
  });
});

describe('normalizeResourceValue', () => {
  it('gives what is saved for a value that fits the type, and nothing for one that does not', () => {
    expect(normalizeResourceValue('email', ' help@example.com ', 'US')).toBe('help@example.com');
    expect(normalizeResourceValue('email', 'help@', 'US')).toBeNull();
    expect(normalizeResourceValue('link', 'https://help.example.com', 'US')).toBe('https://help.example.com');
    expect(normalizeResourceValue('link', 'help.example.com', 'US')).toBe('https://help.example.com');
    expect(normalizeResourceValue('link', 'asdf', 'US')).toBeNull();
    expect(normalizeResourceValue('question', ' How? ', 'US')).toBe('How?');
    expect(normalizeResourceValue('question', '  ', 'US')).toBeNull();
    expect(normalizeResourceValue('question', 'a'.repeat(200), 'US', 200)).toBe('a'.repeat(200));
    expect(normalizeResourceValue('question', 'a'.repeat(201), 'US', 200)).toBeNull();
    // Until the limit is known only the server limits a question
    expect(normalizeResourceValue('question', 'a'.repeat(201), 'US')).toBe('a'.repeat(201));
  });

  it('saves a phone number in international form for the country it was typed in', () => {
    expect(normalizeResourceValue('phone', '(202) 555-0100', 'US')).toBe('+12025550100');
    expect(normalizeResourceValue('phone', '20 7946 0958', 'GB')).toBe('+442079460958');
    expect(normalizeResourceValue('phone', '123', 'US')).toBeNull();
  });
});

describe('splitPhone', () => {
  it('splits a saved number into its country and the number typed there', () => {
    expect(splitPhone('+12025550100')).toEqual({ country: 'US', national: '2025550100' });
    expect(splitPhone('not a number')).toBeNull();
  });
});
