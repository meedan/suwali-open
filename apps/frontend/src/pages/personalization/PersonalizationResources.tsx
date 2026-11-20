import { useCan } from '@hooks/useCapabilities';

import ExternalResourceDisplay from './ExternalResourceDisplay';
import ExternalResourcesFooter from './ExternalResourcesFooter';
import styles from './Personalization.module.css';
import { NoPermission } from './PersonalizationAttribute';
import { usePersonalizationHub } from './usePersonalizationHub';

type PersonalizationResourcesProps = {
  onOpen: (resourceId: number) => void;
  onAdd: () => void;
};

// All the external resources of the chatbot, each leading to its own page, and a way to add another
const PersonalizationResources = ({ onOpen, onAdd }: PersonalizationResourcesProps) => {
  const { resources } = usePersonalizationHub();
  const canManage = useCan('MANAGE_EXTERNAL_RESOURCE').allowed;

  if (resources.length === 0 && !canManage) return <NoPermission />;

  return (
    <div className={styles.personalizationCard}>
      <ul className={styles.itemList}>
        {resources.map(resource => (
          <li key={resource.id}>
            <ExternalResourceDisplay resource={resource} onEdit={canManage ? () => onOpen(resource.id) : undefined} />
          </li>
        ))}
      </ul>
      <ExternalResourcesFooter onAdd={onAdd} alwaysOfferAdd />
    </div>
  );
};

export default PersonalizationResources;
