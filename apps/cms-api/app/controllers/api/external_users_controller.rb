module Api
  class ExternalUsersController < AuthenticatedController
    before_action :set_hub
    before_action :set_external_user, only: [:update]

    def index
      return unless require_member!(@hub)
      external_users = @hub.external_users.with_last_conversation_id.order(updated_at: :desc)
      external_users = external_users.where(trusted_user: true) if params[:trusted].to_s == "true"
      render json: external_users, status: :ok
    end

    def create
      return unless require_admin!(@hub)
      external_id = ExternalUser.resolve_external_id(@hub, create_params[:platform], create_params[:external_id])
      external_user = ExternalUser.find_or_initialize_by_identity(@hub, create_params[:platform], external_id)
      # Never reassign external_id: on a known end-user it is the id their messages arrive under.
      external_user.assign_attributes(create_params.except(:external_id).merge(trusted_user: true))
      external_user.save!
      render json: external_user, status: external_user.previously_new_record? ? :created : :ok
    rescue ExternalUser::UnresolvableIdentifier => e
      render json: {errors: [e.message]}, status: :unprocessable_content
    end

    def update
      return unless require_admin!(@hub)
      return unless require_write_super_admin_to_promote!
      @external_user.update!(update_params)
      render json: @external_user, status: :ok
    end

    private

    # Promoting an existing external user exposes their name and phone number to the whole hub
    # without them having shared it, so only write super admins can do it. Hub admins can still
    # demote, and can still create a trusted user from an identifier they were given.
    def require_write_super_admin_to_promote!
      return true unless ActiveModel::Type::Boolean.new.cast(update_params[:trusted_user])
      require_write_super_admin!
    end

    def set_hub
      # Every action guards @hub with require_member! or require_admin! before using it.
      # nosemgrep: unscoped-find-without-hub-authorization
      @hub = Hub.find(params[:hub_id])
    end

    def set_external_user
      @external_user = @hub.external_users.find(params[:id])
    end

    def create_params
      params.require(:external_user).permit(:external_id, :platform, :display_name)
    end

    def update_params
      params.require(:external_user).permit(:trusted_user)
    end
  end
end
