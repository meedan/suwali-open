module Api
  class HubMembershipsController < AuthenticatedController
    skip_hub_authorization :create, :leave
    before_action :set_hub, except: [:create, :leave]

    def create
      # Joining a hub cannot require membership in it.
      # nosemgrep: unscoped-find-without-hub-authorization
      @hub = Hub.find(params[:hub_id])
      unless current_user.joinable_hubs.exists?(id: @hub.id)
        render json: {errors: [I18n.t(:error_hub_not_joinable)]}, status: :unprocessable_content and return
      end

      membership = HubMembership.new(user: current_user, hub: @hub, approved: false)
      if membership.save
        render json: membership.as_json, status: :created
      else
        render json: {errors: membership.errors.full_messages}, status: :unprocessable_content
      end
    end

    def index
      memberships = @hub.hub_memberships.includes(:user, user: {profile_picture_attachment: :blob}).joins(:user).order(Arel.sql("NULLIF(users.name, '') ASC NULLS LAST, users.email ASC"))
      render json: memberships.as_json(include_user: true), status: :ok
    end

    def update
      return unless require_admin!(@hub)

      @membership = HubMembership.where(id: params[:id].to_i, hub_id: @hub.id).first
      if @membership.nil?
        render json: {message: I18n.t(:error_not_found)}, status: :not_found and return
      end

      updated = false
      begin
        updated = @membership.update(membership_params)
      rescue ArgumentError # Invalid role
        updated = false
      end
      if updated
        render json: @membership.as_json(include_user: true), status: :ok
      else
        render json: {errors: @membership.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      return unless require_admin!(@hub)

      @membership = HubMembership.where(id: params[:id].to_i, hub_id: @hub.id).first
      if @membership.nil?
        render json: {message: I18n.t(:error_not_found)}, status: :not_found and return
      end
      @membership.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    def leave
      # nosemgrep: unscoped-find-without-hub-authorization
      hub = Hub.find(params[:hub_id])
      membership = current_user.hub_memberships.find_by(hub: hub)
      if membership.nil?
        render json: {message: I18n.t(:error_not_found)}, status: :not_found and return
      end
      membership.destroy!
      render json: {message: I18n.t(:message_deleted), user: current_user.as_json(include_hubs: true)}, status: :ok
    end

    private

    def membership_params
      # nosemgrep: ruby.lang.security.model-attr-accessible.model-attr-accessible -- admin-only endpoint; :role and :approved are intentionally settable by admins
      params.require(:hub_membership).permit(:role, :approved)
    end

    def set_hub
      @hub = Hub.find(params[:hub_id])
      require_member!(@hub)
    end
  end
end
