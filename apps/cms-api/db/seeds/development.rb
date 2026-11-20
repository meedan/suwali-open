require "yaml"

module Seeds
  extend self

  class DemoHub
    attr_accessor :data, :users, :external_users, :sources, :notebooks, :notes, :messages, :messaging_integrations
    attr_reader :organization, :hub

    def initialize(data)
      @data = data
      @organization = create_organization
      @hub = create_hub
      @users = create_users
      @messages = []
    end

    def create_organization
      attrs = @data["organization"]
      Organization.find_or_create_by!(attrs)
    end

    def create_hub
      profile_picture = @data["hub"].delete("profile_picture")
      contribution_code = @data["hub"].delete("contribution_code")
      allowed_features = @data["hub"].delete("allowed_features")
      attrs = @data["hub"]
      attrs["organization"] = @organization

      hub = Hub.find_by_name(attrs["name"])
      if hub.nil?
        hub = Hub.create!(attrs)
        attach_profile_picture(hub, profile_picture)
        hub.contribution_code = contribution_code if contribution_code.present?
        hub.allowed_features = allowed_features if allowed_features.present?
        hub.save!
      end
      hub
    end

    def attach_profile_picture(entity, filename)
      unless filename.blank? || entity.profile_picture.attached?
        entity.profile_picture.attach(
          io: File.open(Rails.root.join("db/seeds/files/#{filename}")),
          filename: filename,
          content_type: "image/png"
        )
      end
    end

    def confirm(user)
      user.confirm unless user.confirmed?
    end

    def add_to_hub(user, role: nil, approved: true)
      unless @hub.users.include?(user)
        membership = HubMembership.create!(user: user, hub: @hub, approved: approved)
        membership.update!(role: role) if role.present?
      end
    end

    def create_users
      @data["users"].map do |attrs|
        profile_picture = attrs.delete("profile_picture")
        not_confirmed = attrs.delete("not_confirmed")
        admin = attrs.delete("admin")
        approved = attrs.delete("approved")
        inactive_days = attrs.delete("inactive_days")

        user = User.where(email: attrs["email"]).first_or_create!(attrs)
        attach_profile_picture(user, profile_picture)
        confirm(user) unless not_confirmed.present?
        add_to_hub(user, role: (admin ? :admin : nil), approved: approved.nil? || approved)
        seed_activity(user, inactive_days)
        user
      end
    end

    def seed_activity(user, inactive_days)
      return unless user.confirmed?
      return if user.last_active_at.present? && user.last_active_at >= user.created_at

      at = (inactive_days || rand(0..3)).to_i.days.ago
      attrs = {last_login_at: at, last_active_at: at}
      attrs[:created_at] = at - 1.week if user.created_at > at
      user.update_columns(attrs)
    end

    def create_external_users
      @external_users = @data["external_users"].map do |attrs|
        attrs["hub"] = @hub

        ExternalUser.where(external_id: attrs["external_id"]).first_or_create!(attrs)
      end
    end

    def create_sources
      @sources = @data["sources"].map do |attrs|
        attrs["hub"] = @hub
        deleted_documents = attrs.delete("deleted_documents")

        if attrs["source_type"] == "json_api"
          next unless ENV[attrs["config"]["query_params"]["api-key"]].present?
          attrs["config"]["query_params"]["api-key"] = ENV[attrs["config"]["query_params"]["api-key"]]
          attrs["config"]["query_params"]["to-date"] = Time.now.yesterday.strftime("%Y-%m-%d")
        end

        # Seed data skips the ownership check: mint the receipt that verifying the site would return
        if attrs["source_type"] == "wordpress_api"
          site_url = attrs["config"]["site_url"]
          api_base = Source.new(attrs).handler.api_base
          attrs["ownership_receipt"] = SourceIngestors::WordpressOwnership.receipt(hub_id: @hub.id, site_url: site_url, api_base: api_base)
        end

        source = Source.where(hub: attrs["hub"], name: attrs["name"]).first_or_create!(attrs)
        if deleted_documents.present?
          deleted_documents.each do |external_id|
            DeletedDocument.where(source: source, external_id: external_id).first_or_create!
          end
        end
        source
      end
    end

    def create_notebooks
      @notebooks = @data["notebooks"].map do |attrs|
        attrs["hub"] = @hub
        attrs["user"] = @users.find { |user| user.email == attrs["user"] }
        next if attrs["user"].confirmed_at.nil?

        notebook = Notebook.where(name: attrs["name"], user: attrs["user"], hub: attrs["hub"]).first_or_initialize(attrs)
        # Set before the first save: the editor is recorded when the summary changes, and a published summary can't change later
        notebook.summary_updater = attrs["user"] if notebook.summary.present?
        notebook.save!
        notebook
      end
    end

    def create_notes
      @notes = @data["notes"].map do |attrs|
        attrs["user"] = @users.find { |user| user.email == attrs["user"] }
        attrs["notebook"] = @notebooks.find { |notebook| notebook.name == attrs["notebook"] && notebook.user == attrs["user"] }

        Note.where(title: attrs["title"], user: attrs["user"]).first_or_create!(attrs) unless attrs["notebook"].nil?
      end
    end

    def first_conversation(participant_identifier)
      participant = @users.find { |user| user.email == participant_identifier }
      Conversation.find_by(hub: @hub, participant: participant, title: "My First Conversation")
    end

    def add_to_notebook(message, notebook_name, participant_identifier)
      participant = @users.find { |user| user.email == participant_identifier }
      notebook = @notebooks.find { |notebook| notebook.name == notebook_name && notebook.user == participant }

      notebook.messages << message unless notebook.nil? || notebook.messages.exists?(id: message.id)
    end

    def create_internal_messages
      @messages = @data["messages_internal"].map do |attrs|
        participant = attrs.delete("conversation_participant")
        notebook = attrs.delete("notebook_name")
        conversation = first_conversation(participant)
        next if conversation.nil?

        message = Message
          .where(body: attrs["body"], conversation: conversation)
          .first_or_create!(body: attrs["body"], conversation: conversation, direction: "incoming")

        add_to_notebook(message, notebook, participant)
      end
    end

    def create_messaging_integrations
      @messaging_integrations = @data["messaging_integrations"].map do |attrs|
        messaging_integration = attrs["type"].constantize
        attrs["hub"] = @hub

        messaging_integration.create!(attrs) unless messaging_integration.find_by(type: attrs["type"])
      end
    end

    def populate_demo_hub
      create_external_users if data.key?("external_users")
      create_sources if data.key?("sources")
      create_notebooks if data.key?("notebooks")
      create_notes if data.key?("notes")
      create_internal_messages if data.key?("messages_internal")
      create_messaging_integrations if data.key?("messaging_integrations")
    end
  end

  def load_data(entities, dir)
    data = {}
    entities.each do |entity|
      data[entity] = YAML.load_file(Rails.root.join("db/seeds/data/#{dir}/#{entity}.yml"))
    end
    data
  end

  def meedan_hub
    entities = [
      "organization",
      "hub",
      "users",
      "external_users",
      "sources",
      "notebooks",
      "notes",
      "messages_internal",
      "messaging_integrations"
    ]
    meedan_hub_data = load_data(entities, "meedan_hub")

    meedan_hub = DemoHub.new(meedan_hub_data)
    meedan_hub.populate_demo_hub

    {"name" => meedan_hub_data["hub"]["name"], "users" => meedan_hub_data["users"]}
  end

  def guardian_hub
    entities = [
      "organization",
      "hub",
      "users",
      "external_users",
      "sources",
      "notebooks",
      "notes",
      "messages_internal",
      "messaging_integrations"
    ]
    guardian_hub_data = load_data(entities, "guardian_hub")

    guardian_hub = DemoHub.new(guardian_hub_data)
    guardian_hub.populate_demo_hub

    {"name" => guardian_hub_data["hub"]["name"], "users" => guardian_hub_data["users"]}
  end

  def vazio_hub
    minimun_entities = [
      "organization",
      "hub",
      "users"
    ]
    vazio_hub_data = load_data(minimun_entities, "vazio_hub")

    DemoHub.new(vazio_hub_data)

    {"name" => vazio_hub_data["hub"]["name"], "users" => vazio_hub_data["users"]}
  end

  def orphan_user
    # User without hub (for Hub Welcome Onboarding test)
    User.find_or_create_by!(email: "nohub@example.org") do |user|
      user.password = "xyz123@@"
      user.password_confirmation = "xyz123@@"
      user.name = ""
      user.confirmed_at = Time.current
    end
    {"name" => "Orphan user", "users" => [{"email" => "nohub@example.org", "password" => "xyz123@@"}]}
  end

  # The public export ships only some hub data directories; seed the hubs whose data is present.
  def available_hubs
    %w[vazio_hub meedan_hub guardian_hub]
      .select { |dir| Rails.root.join("db/seeds/data", dir).directory? }
      .map { |dir| send(dir) }
  end

  def run
    [*available_hubs, orphan_user].each do |hub|
      puts "#" * 50
      puts hub["name"]
      hub["users"].each { |user| puts "email: #{user["email"]}, password: #{user["password"]}" }
    end
    puts "*" * 50
    puts "*" * 50
    puts "To populate the hubs, run: bundle exec rake populate_hubs"
    puts "*" * 50
    puts "*" * 50
    nil
  end
end

Seeds.run
