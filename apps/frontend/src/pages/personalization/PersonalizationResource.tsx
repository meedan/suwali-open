import { Navigate } from 'react-router';

import { useCan } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';

import ExternalResourceDisplay from './ExternalResourceDisplay';
import ExternalResourceForm from './ExternalResourceForm';
import { NoPermission } from './PersonalizationAttribute';
import { usePersonalizationHub } from './usePersonalizationHub';
import { usePersonalizationSaved } from './usePersonalizationSaved';

type PersonalizationResourceProps = {
  // The resource to show, or 'new' for adding one
  resourceId: number | 'new';
  // Where to go once it has been saved, deleted or backed out of
  onDone: () => void;
};

// One external resource: a form for those who can manage it, which also deletes it, or the resource as it is
const PersonalizationResource = ({ resourceId, onDone }: PersonalizationResourceProps) => {
  const hubPath = useHubPath();
  const { hub, resources, resourcesLoaded } = usePersonalizationHub();
  const canManage = useCan('MANAGE_EXTERNAL_RESOURCE').allowed;
  const { onSaved, onSaveError } = usePersonalizationSaved(onDone);

  const formProps = { hubId: hub?.id || null, onSuccess: onSaved, onError: onSaveError, onCancel: onDone };

  if (resourceId === 'new') {
    return canManage ? <ExternalResourceForm {...formProps} /> : <NoPermission />;
  }

  const resource = resources.find(({ id }) => id === resourceId);

  // Nothing to show until the resources arrive, and once they have, a resource that is gone goes back to the list
  if (!resource) return resourcesLoaded ? <Navigate replace to={hubPath('/personalization/resources')} /> : null;

  return canManage
    ? <ExternalResourceForm key={resource.id} resource={resource} hasSavedValue {...formProps} />
    : <ExternalResourceDisplay resource={resource} />;
};

export default PersonalizationResource;
