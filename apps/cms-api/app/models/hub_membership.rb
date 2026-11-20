class HubMembership < ApplicationRecord
  belongs_to :user
  belongs_to :hub

  enum role: {admin: 0, editor: 1}

  scope :approved, -> { where(approved: true) }
  scope :pending_approval, -> { where(approved: false) }

  validates :user_id, uniqueness: {scope: :hub_id}

  before_validation :set_admin_for_first_member, on: :create
  after_commit :create_default_data, on: :create
  after_commit :refresh_hub_invite_code, on: :destroy
  after_commit :notify_hub_admins, on: :create
  after_commit :notify_new_member, on: :update, if: -> { saved_change_to_approved? && approved? }

  def as_json(options = {})
    membership = {
      id: id,
      hub_id: hub_id,
      user_id: user_id,
      role: role,
      approved: approved
    }
    membership[:user] = user if options[:include_user]
    membership[:onboarding_tasks] = onboarding_tasks if options[:include_onboarding_tasks]
    membership[:capabilities] = CapabilitiesEvaluator.new(hub_membership: self).evaluate_all if options[:include_capabilities]
    membership
  end

  def onboarding_tasks
    {
      profile_filled: user.name.present?,
      internal_conversation_started: Message.joins(conversation: :hub).where("hubs.id" => hub_id, "conversations.participant" => user).where(direction: :incoming).exists?,
      multiple_notebooks_created: (Notebook.where(hub: hub, user: user).count > 1),
      notebook_published: Notebook.where(hub: hub, user: user, published: true).exists?
    }
  end

  private

  def create_default_data
    Notebook.create! hub: hub, user: user, name: I18n.t(:default_notebook_name)
    Conversation.create! hub: hub, participant: user, title: I18n.t(:default_conversation_title), platform: "internal"
  rescue => e
    LogService.log(:error, "HubMembership", "Failed to create default data for HubMembership id=#{id}, user_id=#{user_id}, hub_id=#{hub_id}: #{e.message}")
    LogService.log(:error, "HubMembership", e.backtrace.join("\n"))
    Sentry.capture_exception(e, extra: {hub_membership_id: id, user_id: user_id, hub_id: hub_id}) if defined?(Sentry)
    # Don't re-raise - HubMembership is already committed
  end

  def refresh_hub_invite_code
    # Skip if hub is being destroyed (frozen) or membership destroyed via cascade
    return if hub.frozen? || hub.destroyed? || destroyed_by_association

    hub.refresh_invite_code!
  end

  def notify_hub_admins
    return if admin?

    if approved?
      HubMailer.join_with_invite_code(hub, user).deliver_later
    else
      HubMailer.join_request(hub, user).deliver_later
    end
  end

  def notify_new_member
    HubMailer.welcome_new_member(hub, user).deliver_later
  end

  def set_admin_for_first_member
    self.role = :admin if hub.hub_memberships.count.zero?
  end
end
