require "rails_helper"

RSpec.describe ApplicationController, type: :controller do
  controller(ApplicationController) do
    def super_admin_action
      return unless require_super_admin!
      head :ok
    end

    def write_super_admin_action
      return unless require_write_super_admin!
      head :ok
    end
  end

  before do
    routes.draw do
      get "application/super_admin_action" => "anonymous#super_admin_action"
      get "application/write_super_admin_action" => "anonymous#write_super_admin_action"
    end
  end

  describe "#require_super_admin!" do
    it "allows a write super admin" do
      write_super_admin = create(:user, email: "super@meedan.com", admin_write_access: true)
      allow(controller).to receive(:current_user).and_return(write_super_admin)

      get :super_admin_action

      expect(response).to have_http_status(:ok)
    end

    it "allows a read-only super admin" do
      read_only_super_admin = create(:user, email: "readonly@meedan.com")
      allow(controller).to receive(:current_user).and_return(read_only_super_admin)

      get :super_admin_action

      expect(response).to have_http_status(:ok)
    end

    it "forbids a hub admin" do
      hub_admin = create(:user)
      create(:hub_membership, user: hub_admin, role: "admin")
      allow(controller).to receive(:current_user).and_return(hub_admin)

      get :super_admin_action

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids a request without a user" do
      allow(controller).to receive(:current_user).and_return(nil)

      get :super_admin_action

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "#require_write_super_admin!" do
    it "allows a write super admin" do
      write_super_admin = create(:user, email: "super@meedan.com", admin_write_access: true)
      allow(controller).to receive(:current_user).and_return(write_super_admin)

      get :write_super_admin_action

      expect(response).to have_http_status(:ok)
    end

    it "forbids a read-only super admin" do
      read_only_super_admin = create(:user, email: "readonly@meedan.com")
      allow(controller).to receive(:current_user).and_return(read_only_super_admin)

      get :write_super_admin_action

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids a hub admin" do
      hub_admin = create(:user)
      create(:hub_membership, user: hub_admin, role: "admin")
      allow(controller).to receive(:current_user).and_return(hub_admin)

      get :write_super_admin_action

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids a request without a user" do
      allow(controller).to receive(:current_user).and_return(nil)

      get :write_super_admin_action

      expect(response).to have_http_status(:forbidden)
    end
  end
end
