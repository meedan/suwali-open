# Data Model

```mermaid
classDiagram
    class User {
        +string name
        +string email
        +string password
        +date last_login_at
        +date last_active_at
    }

    class Organization {
        +string name
    }

    class Hub {
        +string name
        +string invite_code
        +string contribution_code
        +int organization_id
        +json bot_attributes
        +json custom_limits
        +json allowed_features
        +json trial_emails_sent
        +enum plan
        +enum contribution_workflow_mode
        +boolean deletion_in_progress
        +boolean trial_emails_enabled
        +date trial_started_at
        +date trial_ends_at
        +date deletion_started_at
        +date deletion_requested_at
        +string deletion_requested_by_email
    }

    Organization --> Hub : has

    class HubMembership {
        +int hub_id
        +int user_id
        +enum role
        +boolean approved
    }

    Hub --> HubMembership : has
    User --> HubMembership : has

    class Source {
        +int hub_id
        +string name
        +enum source_type
        +boolean active
        +boolean preloaded
        +json config
        +date last_synced_at
        +date deleted_at
        +int documents_count
    }

    Hub --> Source : has

    class Document {
        +int source_id
        +string external_id
        +string title
        +text content
        +enum document_type
        +json metadata
        +text ai_summary
        +text summary
        +boolean active
        +enum sync_status
        +string last_sync_error_code
        +int priority_tier
        +date published_at
    }

    Source --> Document : has

    class Notebook {
        +int hub_id
        +int user_id
        +string name
        +text summary
        +date summary_updated_at
        +boolean published
        +text ai_summary
        +date ai_summary_update_requested_at
        +date ai_summary_updated_at
        +boolean active
        +enum sync_status
        +string last_sync_error_code
        +int priority_tier
    }

    Hub --> Notebook : has
    User --> Notebook : has

    class Note {
        +int notebook_id
        +int user_id
        +string title
        +text content
        +text ai_summary
    }

    Notebook --> Note : has
    User --> Note : has

    class Conversation {
        +int hub_id
        +int participant_id
        +string participant_type
        +string title
        +string language
        +enum platform
        +enum state
        +text ai_summary
        +jsonb context
        +date deleted_at
    }

    Hub --> Conversation : has
    User --> Conversation : has
    ExternalUser --> Conversation : has

    class Message {
        +int conversation_id
        +int message_cluster_id
        +text body
        +enum direction
        +enum status
        +json payload
        +string external_id
        +enum state
        +json metadata
        +text ai_summary
        +vector embedding
        +int reply_to_id
        +boolean answered
    }

    Conversation --> Message : has

    class MessageCluster {
        +int hub_id
        +int centroid_message_id
        +vector centroid_embedding
        +text original_text
        +int question_count
    }

    Hub --> MessageCluster : has
    MessageCluster --> Message : has

    class NotebookItem {
        +int notebook_id
        +string item_type
        +int item_id
    }

    Notebook --> NotebookItem : has
    NotebookItem --> Message : item (polymorphic)
    NotebookItem --> Conversation : item (polymorphic)
    NotebookItem --> MessageCluster : item (polymorphic)
    NotebookItem --> Note : item (polymorphic)
    NotebookItem --> Document : item (polymorphic)
    NotebookItem --> Contribution : item (polymorphic)

    class Contribution {
        +int hub_id
        +int message_id
        +text content
        +text ai_summary
        +boolean active
        +enum sync_status
        +string last_sync_error_code
        +int priority_tier
        +boolean first_time_contributor
    }

    Hub --> Contribution : has
    Contribution "1" --> "1" Message : comes from

    class ExternalUser {
        +int hub_id
        +enum platform
        +string external_id
        +string display_name
        +json metadata
        +boolean trusted_user
        +date first_message_at
        +date last_message_at
        +int messages_count
        +date first_contribution_at
        +date opted_out_at
    }

    Hub --> ExternalUser : has

    class MessagingIntegration {
        +int hub_id
        +str type
        +json credentials
        +json settings
        +boolean active
    }

    Hub --> MessagingIntegration : has

    class MessageReport {
        +int message_id
        +int reported_by_id
        +text comment
    }

    Message --> MessageReport : has
    User --> MessageReport : has

    class BulkConversationExport {
        +int hub_id
        +int requested_by_id
        +int status
    }

    Hub --> BulkConversationExport : has
    User --> BulkConversationExport : has

    class MessageDataSourceItem {
        +int message_id
        +string item_type
        +int item_id
    }

    Message --> MessageDataSourceItem : has

    class ExternalResource {
        +int hub_id
        +string title
        +string resource_type
        +text description
        +string[] scenarios
    }

    Hub --> ExternalResource : has

    class Topic {
        +int hub_id
        +string name
    }

    Hub --> Topic : has

    class TopicItem {
        +int topic_id
        +string item_type
        +int item_id
        +int added_by_id
    }

    Topic --> TopicItem : has
    User --> TopicItem : added
    TopicItem --> Document : item (polymorphic)
    TopicItem --> Contribution : item (polymorphic)
    TopicItem --> Notebook : item (polymorphic)
    TopicItem --> Message : item (polymorphic)

    class DeletedTopicItem {
        +int topic_id
        +string item_type
        +int item_id
    }

    Topic --> DeletedTopicItem : has
    DeletedTopicItem --> Document : item (polymorphic)
    DeletedTopicItem --> Contribution : item (polymorphic)
    DeletedTopicItem --> Notebook : item (polymorphic)

    class TopicSubscription {
        +int topic_id
        +int external_user_id
    }

    Topic --> TopicSubscription : has
    ExternalUser --> TopicSubscription : has
```

*All classes in this diagram have the attributes id, created_at, and updated_at, but these were omitted for clarity’s sake.*

**User**: A User represents a person with access to the platform, identified by their email and name. Users can be part of many hubs.

**Organization**: An Organization represents a partner entity — such as a civil society organization (CSO), local newsroom, or NGO — that uses the platform to manage one or more community knowledge spaces.

**Hub**: A Hub is a self-contained knowledge environment within the platform, scoped to a specific topic, region, or audience. It's where data sources are connected, community interactions happen, and knowledge is organized. Each Hub belongs to one Organization, but an Organization can have many Hubs. Each Hub references its parent Organization via `organization_id`. A hub can have many users. The `bot_attributes` field stores personalization settings for the bot identity (name, description, tone) that are used when the bot interacts with users.

**Source**: A Source represents an origin or feed of knowledge - not the data itself but where the data comes from. Examples: a Google Drive folder, a website, a WordPress site, a WhatsApp conversation, etc.

**Document**: A Document is an individual piece of knowledge extracted from a source. Examples: a PDF file from a Google Drive folder, a blog post, a relevant WhatsApp message, etc.

**Notebook**: A container that belongs to a hub and groups related notes created by users, and other entities (conversation messages, source documents, etc.) with optional published status. When it's published, its summary is used to feed the knowledge graph.

**Note**: A text-based entry within a notebook, consisting of a title and body, created and timestamped by a user.

**Conversation**: A private 1:1 messaging thread between the system and a participant (typically a `User` for internal conversations, or an external entity for future messaging platforms).

**Message**: A single piece of content exchanged within a `Conversation`, with a direction indicating whether it was incoming from the participant or outgoing from the system.

**Message Data Source Item**: Represents the data source items used by the Knowledge Service for a given message. Data source items can be of type: Document, Contribution and Notebook. *(In the context of the Knowledge service data source items are just called documents)*

**Contribution**: Community knowledge derived from a message sent by a trusted user.

**Bulk Conversation Export**: An export of a hub's latest conversations to a CSV file, requested by a `User` (`requested_by`) and built in the background. A hub has at most one pending export. The file is kept for a few hours; the export stays as an audit trail.

**External User**: Platform-linked contact representing a unique end user from a messaging platform (e.g., WhatsApp, Telegram, SMS or Signal) within a specific hub. For Signal, `external_id` is the user's Signal account UUID, since most users hide their phone number.

**Messaging Integration**: Configuration record that links a hub to a specific external messaging platform (e.g., WhatsApp, Telegram, SMS or Signal), storing the platform type, connection credentials, and activation status.

**Message Report**: A record created by a user (`reported_by`) to report a specific message. It belongs to a `Message` and to a `User`. Only messages with outgoing direction (`bot messages`) can be reported. It may include an optional comment describing the report context.

**External Resource**: A reference to external documentation, guides, or resources that provide additional context for the bot's knowledge. Each external resource belongs to a hub. These resources are included in the bot's personalization context when responding to user queries.

**Message Cluster**: Groups semantically similar messages together using vector embeddings.

**Topic**: A subject of interest within a hub, identified by a name that is unique per hub. Topics are returned by the Knowledge Service when content is ingested or when a chat answer is generated, and they are what end users subscribe to in order to receive notifications about new content.

**Topic Item**: A polymorphic join associating a topic with a piece of content it applies to. The item can be of type Document, Contribution, Notebook (the data source items the topic was found in) or Message (the bot answer the topic was derived from).

**Deleted Topic Item**: Records that a user removed a topic from a data source item, so the Knowledge Service does not add it back when the item is re-ingested.

**Topic Subscription**: An end user's subscription to a topic. It links an `ExternalUser` to a `Topic` (each pair is unique), so the user can be notified when new content arrives for that topic.
