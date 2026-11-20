import { describe, expect, it } from 'vitest';

import type { Hub } from '@customTypes/hub';

import { availablePersonalizationSections, isSectionSetUp, personalizationSections } from './personalizationSections';

const hub = (overrides: Partial<Hub> = {}) => ({ id: 1, allowed_features: {}, ...overrides }) as Hub;

describe('personalizationSections', () => {
  it('gives every section its own id and its own URL slug', () => {
    expect(new Set(personalizationSections.map(({ id }) => id)).size).toBe(personalizationSections.length);
    expect(new Set(personalizationSections.map(({ slug }) => slug)).size).toBe(personalizationSections.length);
  });

  it('lists the sections in the groups and order they are offered', () => {
    expect(personalizationSections.map(({ slug, group }) => `${group}/${slug}`)).toEqual([
      'identity/name',
      'identity/role',
      'behavior/tone',
      'behavior/languages',
      'resources/resources',
    ]);
  });

  it('knows which attributes a hub has set', () => {
    const configured = (id: string, h?: Hub) => personalizationSections.find(section => section.id === id)!.isConfigured?.(h);

    expect(configured('chatbotName', hub())).toBe(false);
    expect(configured('chatbotName', hub({ bot_attributes: { name: 'Bot' } }))).toBe(true);
    expect(configured('roleDescription', hub({ bot_attributes: { description: 'Helps.' } }))).toBe(true);
    // The default tone is used until one is chosen, so it counts as set up either way
    expect(configured('responseStyle', hub())).toBe(true);
    expect(configured('responseStyle', hub({ bot_attributes: { tone: 'advocate' } }))).toBe(true);
    expect(configured('availableLanguages', hub({ bot_attributes: { default_language: 'en' } }))).toBe(true);
    expect(configured('availableLanguages', hub({ bot_attributes: { supported_languages: ['en'] } }))).toBe(true);
    // All languages are used until some are chosen, so it counts as set up either way
    expect(configured('availableLanguages', hub())).toBe(true);
    expect(configured('externalResource')).toBeUndefined();
  });

  it('knows when a setting with a default has a value saved, which it counts as set up without', () => {
    const hasValue = (id: string, h?: Hub) => personalizationSections.find(section => section.id === id)!.hasValue?.(h);

    expect(hasValue('responseStyle', hub())).toBe(false);
    expect(hasValue('responseStyle', hub({ bot_attributes: { tone: 'advocate' } }))).toBe(true);
    expect(hasValue('availableLanguages', hub())).toBe(false);
    expect(hasValue('availableLanguages', hub({ bot_attributes: { supported_languages: [] } }))).toBe(true);
    expect(hasValue('chatbotName', hub())).toBeUndefined();
  });

  it('counts resources as set up once there is one', () => {
    const resources = personalizationSections.find(({ id }) => id === 'externalResource')!;

    expect(isSectionSetUp(resources, hub(), 0)).toBe(false);
    expect(isSectionSetUp(resources, hub(), 1)).toBe(true);
    expect(isSectionSetUp(personalizationSections[0], hub({ bot_attributes: { name: 'Bot' } }), 0)).toBe(true);
  });

  describe('availablePersonalizationSections', () => {
    it('has every section that needs no feature flag', () => {
      expect(availablePersonalizationSections(hub()).map(({ id }) => id)).toEqual(personalizationSections.map(({ id }) => id));
    });

    it('holds back a section until the hub has its feature flag', () => {
      personalizationSections.push({ ...personalizationSections[0], id: 'chatbotName', slug: 'future', flag: 'FUTURE_SETTING' });

      try {
        expect(availablePersonalizationSections(hub()).map(({ slug }) => slug)).not.toContain('future');
        expect(availablePersonalizationSections(hub({ allowed_features: { FUTURE_SETTING: false } })).map(({ slug }) => slug)).not.toContain('future');
        expect(availablePersonalizationSections(hub({ allowed_features: { FUTURE_SETTING: true } })).map(({ slug }) => slug)).toContain('future');
        expect(availablePersonalizationSections(undefined).map(({ slug }) => slug)).not.toContain('future');
      } finally {
        personalizationSections.pop();
      }
    });
  });
});
