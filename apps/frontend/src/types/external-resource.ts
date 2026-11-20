export type Scenario = 'role_description' | 'unanswerable_question' | 'error_occurred' | 'first_message' | 'speak_to_person' | 'purchase_subscribe' | 'conversation_closed';

export type ResourceType = 'email' | 'phone' | 'link' | 'question';

export type ExternalResource = {
  id: number;
  scenarios: Scenario[];
  // What kind of resource the title is. Resources saved before the API sent this have none, and are told apart by their title
  resource_type?: ResourceType;
  title: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
};
