module Api
  class LeakyController < AuthenticatedController
    def show
      # ruleid: unscoped-find-without-hub-authorization
      @note = Note.find(params[:id])
      render json: @note
    end

    def guarded
      # ok: unscoped-find-without-hub-authorization
      @note = Note.find(params[:id])
      return unless require_member!(@note.notebook.hub)
      render json: @note
    end

    def guarded_admin
      # ok: unscoped-find-without-hub-authorization
      hub = Hub.find(params[:hub_id])
      return unless require_admin!(hub)
    end

    def guarded_with_rescue
      # ok: unscoped-find-without-hub-authorization
      hub = Hub.find(params[:hub_id])
      return unless require_member!(hub)
      render json: hub
    rescue StandardError => e
      render json: {error: e.message}
    end

    def guarded_with_bare_rescue
      # ok: unscoped-find-without-hub-authorization
      hub = Hub.find(params[:hub_id])
      return unless require_member!(hub)
      render json: hub
    rescue => e
      render json: {error: e.message}
    end

    def scoped_by_cancan
      # ok: unscoped-find-without-hub-authorization
      @note = Note.accessible_by(current_user).find(params[:id])
    end

    def scoped_by_association
      # ok: unscoped-find-without-hub-authorization
      @user = @hub.external_users.find(params[:id])
    end

    def enumerable_find
      # ok: unscoped-find-without-hub-authorization
      templates.find { |candidate| candidate["name"] == params[:name] }
    end

    def bare_predicate_guard
      # ok: unscoped-find-without-hub-authorization
      notebook = Notebook.find(params[:id])
      return nil unless current_user.can_access_hub?(notebook.hub)
      notebook
    end
  end

  class SuperAdminOnlyController < ApplicationController
    before_action :require_super_admin!

    def show
      # ok: unscoped-find-without-hub-authorization
      hub = Hub.find(params[:id])
      render json: hub
    end
  end
end
