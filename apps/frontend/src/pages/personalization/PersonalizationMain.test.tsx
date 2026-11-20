import { Tooltip } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ExternalResource } from '@customTypes/external-resource';

import { fetchAbout } from '@services/AboutService';
import { fetchExternalResources } from '@services/ExternalResourcesService';
import { fetchHub } from '@services/HubService';

import PersonalizationMain from './PersonalizationMain';

const toast = vi.fn();
const allowed = { UPDATE_HUB: true, MANAGE_EXTERNAL_RESOURCE: true } as Record<string, boolean>;

vi.mock('@root/SessionContext', () => ({
  useSession: () => ({ currentHubId: () => 1, currentHub: () => undefined }),
}));

vi.mock('@services/AboutService', () => ({ fetchAbout: vi.fn() }));
vi.mock('@services/HubService', () => ({ fetchHub: vi.fn() }));
vi.mock('@services/ExternalResourcesService', () => ({ fetchExternalResources: vi.fn() }));

vi.mock('@hooks/useCapabilities', () => ({
  useCan: (action: string) => ({ allowed: allowed[action] }),
}));

vi.mock('@hooks/useToast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@hooks/usePageTitle', () => ({ default: () => undefined }));

// Layout pulls in the hub, the account menu and the top navigation, which none of this depends on
vi.mock('@ui-components/layout/Layout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Layout.Left = ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>;
  Layout.Main = ({ children }: { children: React.ReactNode }) => <main>{children}</main>;
  return { Layout };
});

vi.mock('./PersonalizationPreview', () => ({ default: () => <div>Preview</div> }));

// The forms are covered on their own, so they stand in as something to save, fail or cancel
type FormStubProps = { attributeType?: string; hasSavedValue?: boolean; resource?: ExternalResource; onSuccess?: () => void; onError?: () => void; onCancel?: () => void };
const FormStub = ({ name, attributeType, hasSavedValue, resource, onSuccess, onError, onCancel }: FormStubProps & { name: string }) => (
  <div data-testid="form">
    <span>{[name, attributeType, resource?.title, hasSavedValue ? 'edit' : 'add'].filter(Boolean).join(' ')}</span>
    <button onClick={onSuccess}>save</button>
    <button onClick={onError}>fail</button>
    <button onClick={onCancel}>cancel</button>
  </div>
);
vi.mock('./BotAttributeForm', () => ({ default: (props: FormStubProps) => <FormStub name="attribute" {...props} /> }));
vi.mock('./AvailableLanguagesForm', () => ({ default: (props: FormStubProps) => <FormStub name="languages" {...props} /> }));
vi.mock('./ExternalResourceForm', () => ({ default: (props: FormStubProps) => <FormStub name="resource" {...props} /> }));

const configuredAttributes = {
  name: 'Evidence Bot',
  description: 'Checks claims.',
  tone: 'journalist',
  default_language: 'en',
  supported_languages: ['en', 'es'],
};

const resource: ExternalResource = { id: 5, title: 'Help line', scenarios: ['speak_to_person'] };

const Path = () => <span data-testid="path">{useLocation().pathname}</span>;

const renderAt = async (path: string, botAttributes?: Record<string, unknown>, resources: ExternalResource[] = []) => {
  vi.mocked(fetchHub).mockResolvedValue({ id: 1, allowed_features: {}, bot_attributes: botAttributes } as Awaited<ReturnType<typeof fetchHub>>);
  vi.mocked(fetchExternalResources).mockResolvedValue(resources);
  vi.mocked(fetchAbout).mockResolvedValue({ languages: [{ code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }] } as Awaited<ReturnType<typeof fetchAbout>>);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        <Tooltip.Provider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/hub/1/personalization" element={<PersonalizationMain />} />
              <Route path="/hub/1/personalization/:section" element={<PersonalizationMain />} />
              <Route path="/hub/1/personalization/resources/:resourceId" element={<PersonalizationMain />} />
            </Routes>
            <Path />
          </MemoryRouter>
        </Tooltip.Provider>
      </IntlProvider>
    </QueryClientProvider>
  );

  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
};

const sidebar = () => within(screen.getByRole('navigation'));
const main = () => within(screen.getByRole('main'));
const path = () => screen.getByTestId('path').textContent;

// The scenarios named in the note about those without a resource, in the order they are listed
const uncoveredScenarios = (title: RegExp) =>
  within(main().getByText(title).closest('[class*="hintBoxContent"]') as HTMLElement).getAllByRole('listitem').map(item => item.textContent);

describe('PersonalizationMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed.UPDATE_HUB = true;
    allowed.MANAGE_EXTERNAL_RESOURCE = true;
  });

  describe('overview', () => {
    it('lands on the overview, with the chatbot preview', async () => {
      await renderAt('/hub/1/personalization');

      expect(main().getByText('Attributes and resources your chatbot will consider when responding to the audience.')).toBeInTheDocument();
      expect(main().getByText('Preview')).toBeInTheDocument();
      expect(screen.queryByTestId('form')).not.toBeInTheDocument();
    });

    describe('scenarios without a resource', () => {
      const covering = (...scenarios: ExternalResource['scenarios']) => ({ ...resource, scenarios });

      it('names the scenarios that no resource is offered in, with a way to add one', async () => {
        await renderAt('/hub/1/personalization', undefined, [covering('speak_to_person')]);

        expect(main().getByText('No resource is offered in these scenarios:')).toBeInTheDocument();
        expect(uncoveredScenarios(/these scenarios/)).toEqual([
          'Welcome / First end-user message',
          'When describing what the chatbot can do',
          'Unanswerable questions',
          'Error occurred',
          'Purchase or subscribe to services',
          'End of conversation',
        ]);

        fireEvent.click(main().getByRole('button', { name: 'Add resource' }));
        expect(path()).toBe('/hub/1/personalization/resources/new');
      });

      it('uses the singular for the one scenario left', async () => {
        await renderAt('/hub/1/personalization', undefined, [
          covering('role_description', 'unanswerable_question', 'error_occurred'),
          { ...resource, id: 6, scenarios: ['first_message', 'speak_to_person', 'conversation_closed'] },
        ]);

        expect(main().getByText('No resource is offered in this scenario:')).toBeInTheDocument();
        expect(uncoveredScenarios(/this scenario/)).toEqual(['Purchase or subscribe to services']);
      });

      it('is left to those who can manage resources, as it is on the list of them', async () => {
        allowed.MANAGE_EXTERNAL_RESOURCE = false;
        await renderAt('/hub/1/personalization', undefined, [covering('speak_to_person')]);

        expect(main().queryByText(/No resource is offered/)).not.toBeInTheDocument();
      });

      it('offers nothing once every scenario has a resource, as adding one is not needed', async () => {
        await renderAt('/hub/1/personalization', undefined, [covering('role_description', 'unanswerable_question', 'error_occurred', 'first_message', 'speak_to_person', 'purchase_subscribe', 'conversation_closed')]);

        expect(main().queryByText(/No resource is offered/)).not.toBeInTheDocument();
        expect(main().queryByRole('button', { name: 'Add resource' })).not.toBeInTheDocument();
      });

      it('says nothing before there is a resource, when the checklist already asks for one', async () => {
        await renderAt('/hub/1/personalization');

        expect(main().queryByText(/No resource is offered/)).not.toBeInTheDocument();
      });
    });

    it('sends an unknown section back to the overview', async () => {
      await renderAt('/hub/1/personalization/nonsense');

      await waitFor(() => expect(path()).toBe('/hub/1/personalization'));
    });
  });

  describe('where each section stands', () => {
    it('marks each attribute as set or not set in the sidebar, and counts resources', async () => {
      await renderAt('/hub/1/personalization', { name: 'Evidence Bot', tone: 'journalist' }, [resource]);

      const status = (item: string) => within(sidebar().getByText(item).closest('[class*="listItem"], li, button, div[role]') ?? sidebar().getByText(item).parentElement!);

      expect(status('Chatbot name').getByText('Added')).toBeInTheDocument();
      expect(status('Response style & tone').getByText('Added')).toBeInTheDocument();
      expect(status('Role & description').getByText('Not set up yet')).toBeInTheDocument();
      // The default of all languages is used until some are chosen, so it counts as added
      expect(status('Available languages').getByText('Added')).toBeInTheDocument();
    });

    it('marks the count of resources on the overview as added once there is one, and as not set up yet until then', async () => {
      const resourcesRow = () => main().getByRole('heading', { name: 'Contacts, links & questions' }).closest('button') as HTMLElement;

      await renderAt('/hub/1/personalization');
      expect(within(resourcesRow()).getByText('Not set up yet')).toBeInTheDocument();
      expect(resourcesRow().querySelector('use[href*="check_circle_filled"]')).not.toBeInTheDocument();
      expect(resourcesRow().querySelector('use[href*="triangle_dashed"]')).toBeInTheDocument();
      cleanup();

      await renderAt('/hub/1/personalization', undefined, [resource]);
      expect(within(resourcesRow()).getByText('1 resource')).toBeInTheDocument();
      expect(resourcesRow().querySelector('use[href*="check_circle_filled"]')).toBeInTheDocument();
    });

    it('shows progress under the overview in the sidebar', async () => {
      await renderAt('/hub/1/personalization', { name: 'Evidence Bot', tone: 'journalist' }, [resource]);

      expect(sidebar().getByText('4 of 5 set up')).toBeInTheDocument();
    });

    it('shows progress on the overview, counting resources once there is one', async () => {
      await renderAt('/hub/1/personalization', { name: 'Evidence Bot', tone: 'journalist' }, [resource]);
      expect(main().getByRole('heading', { name: '4 of 5 personalizations set up' })).toBeInTheDocument();
    });

    it('does not count resources until there is one', async () => {
      await renderAt('/hub/1/personalization', { name: 'Evidence Bot', tone: 'journalist' });
      expect(main().getByRole('heading', { name: '3 of 5 personalizations set up' })).toBeInTheDocument();
    });

    it('lists every setting on the overview, each leading to its section', async () => {
      await renderAt('/hub/1/personalization', { name: 'Evidence Bot' });

      expect(main().getByRole('button', { name: /Chatbot name.*Added/ })).toBeInTheDocument();
      expect(main().getByRole('button', { name: /Role & description.*Not set up yet/ })).toBeInTheDocument();
      expect(main().getByRole('button', { name: /^Contacts, links & questions.*Not set up yet/ })).toBeInTheDocument();

      fireEvent.click(main().getByRole('button', { name: /Role & description/ }));
      expect(path()).toBe('/hub/1/personalization/role');
    });

    it('counts every setting once all are set', async () => {
      await renderAt('/hub/1/personalization', configuredAttributes, [resource]);

      expect(main().getByRole('heading', { name: '5 of 5 personalizations set up' })).toBeInTheDocument();
    });
  });

  describe('sidebar', () => {
    it('lists the overview and every section under its group', async () => {
      await renderAt('/hub/1/personalization');

      for (const heading of ['Identity', 'Behavior', 'Resources (0)']) {
        expect(sidebar().getByText(heading)).toBeInTheDocument();
      }
      for (const item of ['Overview', 'Chatbot name', 'Role & description', 'Response style & tone', 'Available languages']) {
        expect(sidebar().getByText(item)).toBeInTheDocument();
      }
    });

    it('goes to a section, and back to the overview', async () => {
      await renderAt('/hub/1/personalization');

      fireEvent.click(sidebar().getByText('Response style & tone'));
      expect(path()).toBe('/hub/1/personalization/tone');

      fireEvent.click(sidebar().getByText('Overview'));
      expect(path()).toBe('/hub/1/personalization');
    });

    it.each([
      ['Chatbot name', '/hub/1/personalization/name'],
      ['Role & description', '/hub/1/personalization/role'],
      ['Response style & tone', '/hub/1/personalization/tone'],
      ['Available languages', '/hub/1/personalization/languages'],
    ])('links %s to its own URL', async (label, url) => {
      await renderAt('/hub/1/personalization');

      fireEvent.click(sidebar().getByText(label));

      expect(path()).toBe(url);
    });
  });

  describe('a section that is not set', () => {
    it.each([
      ['name', 'attribute chatbotName add'],
      ['role', 'attribute roleDescription add'],
    ])('shows the form to set %s straight away', async (slug, formText) => {
      await renderAt(`/hub/1/personalization/${slug}`);

      expect(await screen.findByTestId('form')).toHaveTextContent(formText);
      expect(main().getByText('Preview')).toBeInTheDocument();
    });

    it('goes back to the overview when setting it is cancelled', async () => {
      await renderAt('/hub/1/personalization/name');

      fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

      expect(path()).toBe('/hub/1/personalization');
    });

    it('says so, and refreshes the hub, when it is saved', async () => {
      await renderAt('/hub/1/personalization/name');
      vi.mocked(fetchHub).mockClear();

      fireEvent.click(screen.getByRole('button', { name: 'save' }));

      expect(toast).toHaveBeenCalledWith('success', 'The personalization settings have been successfully saved.', 'Personalization saved successfully');
      await waitFor(() => expect(fetchHub).toHaveBeenCalled());
    });

    it('says so, and keeps the form, when saving fails', async () => {
      await renderAt('/hub/1/personalization/name');

      fireEvent.click(screen.getByRole('button', { name: 'fail' }));

      expect(toast).toHaveBeenCalledWith('error', 'An error occurred while saving personalization settings.', 'Error saving personalization');
      expect(screen.getByTestId('form')).toBeInTheDocument();
    });

    it('tells someone who cannot manage personalization to ask an admin', async () => {
      allowed.UPDATE_HUB = false;
      await renderAt('/hub/1/personalization/name');

      expect(screen.getByText('An administrator on your team can manage personalization settings.')).toBeInTheDocument();
      expect(screen.queryByTestId('form')).not.toBeInTheDocument();
    });
  });

  describe('a section that is set', () => {
    it.each([
      ['name', 'Evidence Bot', 'attribute chatbotName edit'],
      ['role', 'Checks claims.', 'attribute roleDescription edit'],
      ['tone', 'Journalist', 'attribute responseStyle edit'],
      ['languages', 'English, Spanish', 'languages edit'],
    ])('opens straight to the form for %s, with what was saved', async (slug, shown, formText) => {
      await renderAt(`/hub/1/personalization/${slug}`, configuredAttributes);

      expect(await screen.findByTestId('form')).toHaveTextContent(formText);
      expect(screen.queryByText(shown)).not.toBeInTheDocument();
    });

    it('says so when it is saved, and keeps the form', async () => {
      await renderAt('/hub/1/personalization/name', configuredAttributes);

      fireEvent.click(screen.getByRole('button', { name: 'save' }));

      expect(toast).toHaveBeenCalledWith('success', expect.any(String), expect.any(String));
      expect(screen.getByTestId('form')).toBeInTheDocument();
    });

    it('shows the value, not a form, to someone who cannot edit it', async () => {
      allowed.UPDATE_HUB = false;
      await renderAt('/hub/1/personalization/name', configuredAttributes);

      expect(main().getByText('Evidence Bot')).toBeInTheDocument();
      expect(main().getByText('Evidence Bot').closest('button')).toBeNull();
      expect(screen.queryByTestId('form')).not.toBeInTheDocument();
    });

    it('shows the default tone to someone who cannot edit it while none is chosen', async () => {
      allowed.UPDATE_HUB = false;
      await renderAt('/hub/1/personalization/tone');

      expect(main().getByText('Journalist')).toBeInTheDocument();
      expect(screen.queryByText('An administrator on your team can manage personalization settings.')).not.toBeInTheDocument();
    });
  });

  describe('resources', () => {
    it('lists each resource in the sidebar, with a way to add another', async () => {
      await renderAt('/hub/1/personalization', undefined, [resource, { ...resource, id: 6, title: 'Email us' }]);

      expect(sidebar().getByText('Help line')).toBeInTheDocument();
      expect(sidebar().getByText('Email us')).toBeInTheDocument();

      // One in the Resources heading and one in the footer
      const addButtons = sidebar().getAllByRole('button', { name: 'Add resource' });
      expect(addButtons).toHaveLength(2);

      addButtons.forEach(button => {
        fireEvent.click(button);
        expect(path()).toBe('/hub/1/personalization/resources/new');
      });
    });

    it('says how many scenarios each resource is used in', async () => {
      await renderAt('/hub/1/personalization', undefined, [
        { ...resource, scenarios: ['speak_to_person', 'first_message'] },
        { ...resource, id: 6, title: 'Email us', scenarios: ['error_occurred'] },
        { ...resource, id: 7, title: 'Orphan', scenarios: [] },
      ]);

      expect(sidebar().getByText('Used in 2 scenarios')).toBeInTheDocument();
      expect(sidebar().getByText('Used in 1 scenario')).toBeInTheDocument();
      expect(sidebar().getByText('Not used in any scenario')).toBeInTheDocument();
    });

    it('counts the resources in the Resources heading of the sidebar', async () => {
      await renderAt('/hub/1/personalization', undefined, [resource, { ...resource, id: 6, title: 'Email us' }]);

      expect(sidebar().getByText(/\(2\)/)).toBeInTheDocument();
    });

    it('goes to a resource from the sidebar', async () => {
      await renderAt('/hub/1/personalization', undefined, [resource]);

      fireEvent.click(sidebar().getByText('Help line'));

      expect(path()).toBe('/hub/1/personalization/resources/5');
    });

    it('does not offer someone who cannot manage resources a way to add one', async () => {
      allowed.MANAGE_EXTERNAL_RESOURCE = false;
      await renderAt('/hub/1/personalization', undefined, [resource]);

      expect(sidebar().getByText('Help line')).toBeInTheDocument();
      expect(sidebar().queryByRole('button', { name: 'Add resource' })).not.toBeInTheDocument();
    });

    describe('the list', () => {
      it('shows every resource, each leading to its page, and a way to add another', async () => {
        await renderAt('/hub/1/personalization/resources', undefined, [resource]);

        fireEvent.click(main().getByText('Help line').closest('button')!);
        expect(path()).toBe('/hub/1/personalization/resources/5');
      });

      it('names the scenarios no resource is offered in, with a way to add one', async () => {
        await renderAt('/hub/1/personalization/resources', undefined, [resource]);

        expect(main().getByText(/No resource is offered in these scenarios/)).toBeInTheDocument();
        expect(main().getAllByRole('button', { name: 'Add resource' })).toHaveLength(1);

        fireEvent.click(main().getByRole('button', { name: 'Add resource' }));
        expect(path()).toBe('/hub/1/personalization/resources/new');
      });

      it('offers to add one on its own once every scenario has a resource', async () => {
        await renderAt('/hub/1/personalization/resources', undefined, [{ ...resource, scenarios: ['role_description', 'unanswerable_question', 'error_occurred', 'first_message', 'speak_to_person', 'purchase_subscribe', 'conversation_closed'] }]);

        expect(main().queryByText(/No resource is offered/)).not.toBeInTheDocument();
        expect(main().getByRole('button', { name: 'Add resource' })).toBeInTheDocument();
      });

      it('is titled Contacts, links & questions, as it is on the overview', async () => {
        await renderAt('/hub/1/personalization/resources', undefined, [resource]);

        expect(main().getByRole('heading', { name: 'Contacts, links & questions' })).toBeInTheDocument();
      });

      it('lists the scenarios each resource is used in', async () => {
        await renderAt('/hub/1/personalization/resources', undefined, [{ ...resource, scenarios: ['speak_to_person', 'first_message'] }]);

        const item = main().getByRole('heading', { name: 'Help line' }).closest('button') as HTMLElement;
        expect(within(item).getByText(/Scenarios:/)).toHaveTextContent('2 Scenarios:');
        expect(within(item).getAllByRole('listitem').map(entry => entry.textContent)).toEqual(['Speak to a person', 'Welcome / First end-user message']);
      });

      it('goes to the page to add one', async () => {
        await renderAt('/hub/1/personalization/resources');

        fireEvent.click(main().getByRole('button', { name: /Add resource/ }));

        expect(path()).toBe('/hub/1/personalization/resources/new');
      });

      it('shows them without a way to change them to someone who cannot manage them', async () => {
        allowed.MANAGE_EXTERNAL_RESOURCE = false;
        await renderAt('/hub/1/personalization/resources', undefined, [resource]);

        expect(main().getByText('Help line').closest('button')).toBeNull();
        expect(main().queryByRole('button', { name: /Add resource/ })).not.toBeInTheDocument();
      });

      it('tells someone who cannot manage them to ask an admin, when there are none', async () => {
        allowed.MANAGE_EXTERNAL_RESOURCE = false;
        await renderAt('/hub/1/personalization/resources');

        expect(screen.getByText('An administrator on your team can manage personalization settings.')).toBeInTheDocument();
      });
    });

    describe('one resource', () => {
      it('is a form to edit it, and goes back to the list when saved or cancelled', async () => {
        await renderAt('/hub/1/personalization/resources/5', undefined, [resource]);

        expect(screen.getByTestId('form')).toHaveTextContent('resource Help line edit');
        expect(main().getByText('Help line', { selector: 'h1, h2, h3, span, div' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(path()).toBe('/hub/1/personalization/resources');
      });

      it('says so and goes back to the list when it is saved', async () => {
        await renderAt('/hub/1/personalization/resources/5', undefined, [resource]);

        fireEvent.click(screen.getByRole('button', { name: 'save' }));

        expect(toast).toHaveBeenCalledWith('success', expect.any(String), expect.any(String));
        expect(path()).toBe('/hub/1/personalization/resources');
      });

      it('shows it as it is to someone who cannot manage it', async () => {
        allowed.MANAGE_EXTERNAL_RESOURCE = false;
        await renderAt('/hub/1/personalization/resources/5', undefined, [resource]);

        expect(screen.queryByTestId('form')).not.toBeInTheDocument();
        expect(main().getAllByText('Help line').length).toBeGreaterThan(0);
      });

      it('says when it was added', async () => {
        await renderAt('/hub/1/personalization/resources/5', undefined, [{ ...resource, created_at: '2026-09-03T15:00:00Z', updated_at: '2026-09-03T15:00:20Z' }]);

        expect(main().getByText(/Added:/).closest('li')).toHaveTextContent('Sep 3, 2026');
        expect(main().queryByText(/Updated:/)).not.toBeInTheDocument();
      });

      it('says when it was last updated, once it has been edited', async () => {
        await renderAt('/hub/1/personalization/resources/5', undefined, [{ ...resource, created_at: '2026-09-03T15:00:00Z', updated_at: '2026-09-20T15:00:00Z' }]);

        expect(main().getByText(/Added:/).closest('li')).toHaveTextContent('Sep 3, 2026');
        expect(main().getByText(/Updated:/).closest('li')).toHaveTextContent('Sep 20, 2026');
      });

      it('goes back to the list for a resource that is not there', async () => {
        await renderAt('/hub/1/personalization/resources/99', undefined, [resource]);

        await waitFor(() => expect(path()).toBe('/hub/1/personalization/resources'));
      });

      it('goes back to the list for something that is not a resource id', async () => {
        await renderAt('/hub/1/personalization/resources/nonsense');

        await waitFor(() => expect(path()).toBe('/hub/1/personalization/resources'));
      });
    });

    describe('adding one', () => {
      it('is a form to add it, and goes back to the list when saved or cancelled', async () => {
        await renderAt('/hub/1/personalization/resources/new');

        expect(screen.getByTestId('form')).toHaveTextContent('resource add');

        fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(path()).toBe('/hub/1/personalization/resources');
      });

      it('is titled with the same icon as the resources section', async () => {
        await renderAt('/hub/1/personalization/resources/new');

        const title = main().getByRole('heading', { name: 'Add resource' });
        expect(title.closest('main')!.querySelector('use[href*="arrow_square_out"]')).toBeInTheDocument();
        expect(title.closest('main')!.querySelector('use[href*="personalization_source"]')).not.toBeInTheDocument();
      });

      it('tells someone who cannot manage resources to ask an admin', async () => {
        allowed.MANAGE_EXTERNAL_RESOURCE = false;
        await renderAt('/hub/1/personalization/resources/new');

        expect(screen.getByText('An administrator on your team can manage personalization settings.')).toBeInTheDocument();
        expect(screen.queryByTestId('form')).not.toBeInTheDocument();
      });
    });
  });
});
